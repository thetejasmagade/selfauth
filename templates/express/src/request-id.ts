import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";

/** Request ID shared by responses, logs and security events (SEC-LOG-003). */
export function getRequestId(res: Response): string {
  return (res.locals as { requestId?: string }).requestId ?? "unknown";
}

export const assignRequestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals["requestId"] = id;
  res.setHeader("X-Request-Id", id);
  next();
};
