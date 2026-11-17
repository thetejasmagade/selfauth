import type { FastifyRequest } from "fastify";

/**
 * Request ID shared by responses, logs and security events (SEC-LOG-003). Fastify generates it
 * (see `genReqId` in app.ts); it is never taken from a request header.
 */
export function getRequestId(req: FastifyRequest): string {
  return req.id;
}
