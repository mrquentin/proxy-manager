import { cors } from "hono/cors";
import type { Env } from "../lib/env";

/**
 * Create CORS middleware configured for the frontend origin.
 *
 * In development, this allows the Vite dev server (typically http://localhost:5173).
 * In production, this should be set to the actual frontend domain.
 *
 * @param env - Validated environment variables.
 */
export function createCorsMiddleware(env: Env) {
  return cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    exposeHeaders: ["Set-Cookie"],
    maxAge: 86400,
  });
}
