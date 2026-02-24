import type { AuthVariables } from "../middleware/auth";

/**
 * Hono environment type for this application.
 * Declares the context variables set by auth middleware.
 */
export type AppEnv = {
  Variables: AuthVariables;
};
