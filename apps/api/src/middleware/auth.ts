import type { MiddlewareHandler } from "hono";
import type { Auth } from "../lib/auth";

/**
 * Hono context variable types set by auth middleware.
 */
export interface AuthVariables {
  user: { id: string; name: string; email: string; image: string | null };
  session: { id: string; userId: string; activeOrganizationId: string | null };
}

/**
 * Create a requireAuth middleware that validates the session using better-auth.
 * Sets `user` and `session` on the Hono context.
 *
 * @param auth - The better-auth instance.
 */
export function createRequireAuth(auth: Auth): MiddlewareHandler {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", session.user);
    c.set("session", session.session);
    await next();
  };
}

/**
 * Create a requirePermission middleware that checks org-level RBAC via better-auth.
 * Must be used after requireAuth.
 *
 * @param auth - The better-auth instance.
 * @param resource - The resource to check (e.g., "vps", "tunnel").
 * @param action - The action to check (e.g., "create", "read", "delete").
 */
export function createRequirePermission(
  auth: Auth,
  resource: string,
  action: string
): MiddlewareHandler {
  return async (c, next) => {
    const hasPermission = await auth.api.hasPermission({
      headers: c.req.raw.headers,
      body: {
        permission: { [resource]: [action] },
      },
    });

    if (!hasPermission?.success) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  };
}

/**
 * Middleware that requires the session to have an active organization.
 * Must be used after requireAuth. Returns 400 if no org is set.
 */
export const requireActiveOrg: MiddlewareHandler = async (c, next) => {
  const session = c.get("session") as AuthVariables["session"] | undefined;

  if (!session?.activeOrganizationId) {
    return c.json({ error: "No active organization selected" }, 400);
  }

  await next();
};
