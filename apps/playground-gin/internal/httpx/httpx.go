// Package httpx holds the HTTP plumbing shared by the application and the
// SelfAuth adapter: request IDs, the spec's error envelope, JSON body parsing
// with a size limit (SEC-HTTP-003), request logging and panic recovery.
package httpx

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"example.com/app/internal/auth"
	"github.com/gin-gonic/gin"
)

const (
	requestIDKey = "selfauth.requestId"
	bodyKey      = "selfauth.body"
)

// RequestID is shared by responses, logs and security events (SEC-LOG-003).
func RequestID(c *gin.Context) string {
	if id, ok := c.Get(requestIDKey); ok {
		return id.(string)
	}
	return "unknown"
}

// AssignRequestID gives every request an ID and returns it as X-Request-Id.
func AssignRequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := auth.NewID()
		c.Set(requestIDKey, id)
		c.Header("X-Request-Id", id)
		c.Next()
	}
}

// Envelope is the spec error body (ERR-FORMAT-001).
type Envelope struct {
	Error EnvelopeError `json:"error"`
}

type EnvelopeError struct {
	Code      auth.Code     `json:"code"`
	Message   string        `json:"message"`
	RequestID string        `json:"requestId,omitempty"`
	Details   []auth.Detail `json:"details,omitempty"`
}

// WriteError renders the error envelope and stops the handler chain.
func WriteError(c *gin.Context, status int, code auth.Code, message string, details []auth.Detail) {
	c.AbortWithStatusJSON(status, Envelope{Error: EnvelopeError{
		Code: code, Message: message, RequestID: RequestID(c), Details: details,
	}})
}

// Internal answers 500 without exposing internals (SEC-LOG-002); the cause goes
// to the server log only, redacted.
func Internal(c *gin.Context, logger *auth.Logger, cause any) {
	if logger != nil {
		logger.Log("error", "unhandled error", map[string]any{"requestId": RequestID(c), "error": cause})
	}
	WriteError(c, http.StatusInternalServerError, auth.InternalError, "Internal server error.", nil)
}

// Recovery turns a panic into a 500 envelope.
func Recovery(logger *auth.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				if err, ok := r.(error); ok {
					Internal(c, logger, err)
				} else {
					Internal(c, logger, "panic")
				}
			}
		}()
		c.Next()
	}
}

// HandlerErrors answers 500 for a handler that reported an error with c.Error and wrote nothing,
// so a failed database query never becomes an empty 200. The error goes to the server log only,
// redacted (SEC-LOG-002).
func HandlerErrors(logger *auth.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if len(c.Errors) > 0 && !c.Writer.Written() {
			Internal(c, logger, c.Errors.Last().Err)
		}
	}
}

// RequestLog logs one line per request. Path only: query strings and bodies are
// never logged (SEC-LOG-001).
func RequestLog(logger *auth.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		c.Next()
		logger.Log("info", "request", map[string]any{
			"method": c.Request.Method, "path": c.Request.URL.Path, "status": c.Writer.Status(),
			"requestId": RequestID(c), "ip": c.ClientIP(), "durationMs": time.Since(started).Milliseconds(),
		})
	}
}

func isJSON(contentType string) bool {
	mediaType := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	return mediaType == "application/json" || (strings.HasPrefix(mediaType, "application/") && strings.HasSuffix(mediaType, "+json"))
}

// JSONBody parses a JSON object body of at most limit bytes (SEC-HTTP-003).
// Requests without a JSON body get an empty object. Malformed JSON is 400
// VALIDATION_FAILED and an oversized body is 413 PAYLOAD_TOO_LARGE.
func JSONBody(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		req := c.Request
		hasBody := req.ContentLength > 0 || len(req.TransferEncoding) > 0
		if !hasBody || !isJSON(req.Header.Get("Content-Type")) {
			c.Next()
			return
		}
		tooLarge := func() {
			WriteError(c, http.StatusRequestEntityTooLarge, auth.PayloadTooLarge, "Request body too large.", nil)
		}
		if req.ContentLength > limit {
			tooLarge()
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(c.Writer, req.Body, limit))
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				tooLarge()
				return
			}
			WriteError(c, http.StatusBadRequest, auth.ValidationFailed, "Malformed JSON body.", nil)
			return
		}
		raw = bytes.TrimSpace(raw)
		if len(raw) == 0 {
			c.Next()
			return
		}
		// Like a strict JSON parser: only objects and arrays are accepted at the top level.
		if raw[0] != '{' && raw[0] != '[' {
			WriteError(c, http.StatusBadRequest, auth.ValidationFailed, "Malformed JSON body.", nil)
			return
		}
		var decoded any
		if err := json.Unmarshal(raw, &decoded); err != nil {
			WriteError(c, http.StatusBadRequest, auth.ValidationFailed, "Malformed JSON body.", nil)
			return
		}
		if obj, ok := decoded.(map[string]any); ok {
			c.Set(bodyKey, obj)
		}
		c.Next()
	}
}

// Body returns the parsed JSON object, or an empty one.
func Body(c *gin.Context) auth.Input {
	if v, ok := c.Get(bodyKey); ok {
		return auth.Input(v.(map[string]any))
	}
	return auth.Input{}
}
