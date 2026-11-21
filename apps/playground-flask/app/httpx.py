"""HTTP plumbing shared by the application and the SelfAuth adapter: request ids, the spec's
error envelope, a JSON body with a size limit (SEC-HTTP-003) and request logging."""

from __future__ import annotations

import json
import time
from typing import Any

from flask import Flask, Response, g, jsonify, request
from werkzeug.exceptions import HTTPException

from .auth import errors
from .auth.crypto import new_id
from .auth.errors import AuthError
from .auth.logger import Logger


def request_id() -> str:
    """Shared by responses, logs and security events (SEC-LOG-003)."""
    return getattr(g, "selfauth_request_id", "unknown")


def envelope(code: str, message: str, details: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """The spec error body (ERR-FORMAT-001)."""
    body: dict[str, Any] = {"code": code, "message": message, "requestId": request_id()}
    if details:
        body["details"] = details
    return {"error": body}


def error_response(code: str, message: str, details: list[dict[str, str]] | None = None) -> Response:
    response = jsonify(envelope(code, message, details))
    response.status_code = errors.HTTP_STATUS[code]
    return response


def body() -> dict[str, Any]:
    """The parsed JSON object, or an empty one."""
    return getattr(g, "selfauth_body", None) or {}


def _is_json(content_type: str) -> bool:
    media = content_type.split(";", 1)[0].strip().lower()
    return media == "application/json" or (media.startswith("application/") and media.endswith("+json"))


def _reject_constant(name: str) -> Any:
    raise ValueError(f"{name} is not valid JSON")


def parse_json_body() -> Response | None:
    """Parses a JSON object body (an oversized one is 413 through MAX_CONTENT_LENGTH). Requests
    without a JSON body get an empty object. Malformed JSON is 400 VALIDATION_FAILED."""
    has_body = (request.content_length or 0) > 0 or request.headers.get("Transfer-Encoding")
    if not has_body or not _is_json(request.headers.get("Content-Type", "")):
        return None
    raw = request.get_data(cache=True).strip()  # raises RequestEntityTooLarge past the limit
    if not raw:
        return None
    # Like a strict JSON parser: only objects and arrays are accepted at the top level.
    if raw[:1] not in (b"{", b"["):
        return error_response(errors.VALIDATION_FAILED, "Malformed JSON body.")
    try:
        decoded = json.loads(raw, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        return error_response(errors.VALIDATION_FAILED, "Malformed JSON body.")
    if isinstance(decoded, dict):
        g.selfauth_body = decoded
    return None


def install(app: Flask, logger: Logger | None, body_limit_bytes: int) -> None:
    """Adds request ids, the body limit, request logging and the error handlers."""
    app.json.sort_keys = False  # type: ignore[attr-defined]
    app.config["MAX_CONTENT_LENGTH"] = body_limit_bytes

    @app.before_request
    def _begin() -> Response | None:
        g.selfauth_request_id = new_id()
        g.selfauth_started = time.perf_counter()
        return parse_json_body()

    @app.after_request
    def _finish(response: Response) -> Response:
        response.headers["X-Request-Id"] = request_id()
        if logger is not None:
            logger.log(
                "info",
                "request",
                {
                    "method": request.method,
                    "path": request.path,
                    "status": response.status_code,
                    "requestId": request_id(),
                    "ip": request.remote_addr,
                    "durationMs": round((time.perf_counter() - getattr(g, "selfauth_started", time.perf_counter())) * 1000),
                },
            )
        return response

    @app.errorhandler(HTTPException)
    def _http_error(exc: HTTPException) -> Response:
        # Routes and methods that do not exist are one answer: 404 (nothing leaks about what does).
        if exc.code in (404, 405):
            return error_response(errors.NOT_FOUND, errors.MESSAGES[errors.NOT_FOUND])
        if exc.code == 413:
            return error_response(errors.PAYLOAD_TOO_LARGE, "Request body too large.")
        if exc.code and 400 <= exc.code < 500:
            return error_response(errors.VALIDATION_FAILED, "Malformed request.")
        return internal_error(exc, logger)

    @app.errorhandler(AuthError)
    def _auth_error(exc: AuthError) -> Response:
        response = error_response(exc.code, exc.message, exc.details)
        if exc.retry_after_seconds > 0:
            response.headers["Retry-After"] = str(exc.retry_after_seconds)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(Exception)
    def _unexpected(exc: Exception) -> Response:
        return internal_error(exc, logger)


def internal_error(cause: BaseException, logger: Logger | None) -> Response:
    """Answers 500 without exposing internals (SEC-LOG-002); the cause goes to the server log
    only, redacted."""
    if logger is not None:
        logger.log("error", "unhandled error", {"requestId": request_id(), "error": cause})
    return error_response(errors.INTERNAL_ERROR, "Internal server error.")
