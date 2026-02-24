import { z } from "zod";

const envSchema = z.object({
  /** Port the Hono server listens on. */
  PORT: z
    .string()
    .default("3000")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(65535)),

  /** Path to the SQLite database file. */
  DATABASE_PATH: z.string().default("./data/proxy-manager.db"),

  /** Secret used by better-auth for signing session tokens. */
  JWT_SECRET: z.string().min(32),

  /** GitHub OAuth application client ID (optional — omit to disable). */
  GITHUB_CLIENT_ID: z.string().min(1).optional(),

  /** GitHub OAuth application client secret (optional — omit to disable). */
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),

  /** Google OAuth application client ID (optional — omit to disable). */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),

  /** Google OAuth application client secret (optional — omit to disable). */
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  /** WebAuthn Relying Party ID (e.g., "proxy-manager.example.com"). */
  PASSKEY_RP_ID: z.string().min(1),

  /** WebAuthn origin URL (e.g., "https://proxy-manager.example.com"). */
  PASSKEY_ORIGIN: z.string().url(),

  /**
   * AES-256 encryption key for VPS credential encryption.
   * Must be a 64-character hex string (32 bytes).
   */
  ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[0-9a-fA-F]+$/, "ENCRYPTION_KEY must be a 64-character hex string"),

  /** CORS origin for the frontend (defaults to Vite dev server). */
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  /** Node environment. */
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables.
 * Throws a descriptive ZodError if validation fails.
 */
export function parseEnv(raw: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data;
}
