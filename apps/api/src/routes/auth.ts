import { Hono } from "hono";
import type { Auth } from "../lib/auth";

/**
 * Create the auth routes that mount better-auth's handler.
 *
 * better-auth handles all authentication endpoints under /api/auth/*:
 * - POST /api/auth/sign-up/email
 * - POST /api/auth/sign-in/email
 * - POST /api/auth/sign-in/social
 * - POST /api/auth/sign-out
 * - GET/POST /api/auth/session
 * - POST /api/auth/passkey/register
 * - POST /api/auth/passkey/authenticate
 * - And all organization/member endpoints
 *
 * @param auth - The better-auth instance.
 */
export function createAuthRoutes(auth: Auth) {
  const app = new Hono();

  // Mount better-auth handler for all GET and POST requests under /api/auth/*
  app.on(["GET", "POST"], "/api/auth/**", (c) => {
    return auth.handler(c.req.raw);
  });

  return app;
}
