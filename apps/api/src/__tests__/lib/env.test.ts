import { describe, it, expect } from "bun:test";
import { parseEnv } from "../../lib/env";

const VALID_ENV = {
  PORT: "3000",
  DATABASE_PATH: "./test.db",
  JWT_SECRET: "a".repeat(32),
  GITHUB_CLIENT_ID: "gh-client-id",
  GITHUB_CLIENT_SECRET: "gh-client-secret",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  PASSKEY_RP_ID: "localhost",
  PASSKEY_ORIGIN: "http://localhost:3000",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  CORS_ORIGIN: "http://localhost:5173",
  NODE_ENV: "test" as const,
};

describe("env", () => {
  describe("parseEnv", () => {
    it("should parse a valid environment", () => {
      const env = parseEnv(VALID_ENV);
      expect(env.PORT).toBe(3000);
      expect(env.DATABASE_PATH).toBe("./test.db");
      expect(env.JWT_SECRET).toBe("a".repeat(32));
      expect(env.GITHUB_CLIENT_ID).toBe("gh-client-id");
      expect(env.NODE_ENV).toBe("test");
    });

    it("should use defaults for optional fields", () => {
      const { PORT: _, CORS_ORIGIN: __, NODE_ENV: ___, DATABASE_PATH: ____, ...required } = VALID_ENV;
      const env = parseEnv(required);
      expect(env.PORT).toBe(3000);
      expect(env.CORS_ORIGIN).toBe("http://localhost:5173");
      expect(env.NODE_ENV).toBe("development");
      expect(env.DATABASE_PATH).toBe("./data/proxy-manager.db");
    });

    it("should accept a custom port", () => {
      const env = parseEnv({ ...VALID_ENV, PORT: "8080" });
      expect(env.PORT).toBe(8080);
    });

    it("should reject a missing JWT_SECRET", () => {
      const { JWT_SECRET: _, ...rest } = VALID_ENV;
      expect(() => parseEnv(rest)).toThrow("Environment validation failed");
    });

    it("should reject a JWT_SECRET shorter than 32 characters", () => {
      expect(() => parseEnv({ ...VALID_ENV, JWT_SECRET: "short" })).toThrow(
        "Environment validation failed"
      );
    });

    it("should reject a missing GITHUB_CLIENT_ID", () => {
      const { GITHUB_CLIENT_ID: _, ...rest } = VALID_ENV;
      expect(() => parseEnv(rest)).toThrow("Environment validation failed");
    });

    it("should reject a missing GOOGLE_CLIENT_ID", () => {
      const { GOOGLE_CLIENT_ID: _, ...rest } = VALID_ENV;
      expect(() => parseEnv(rest)).toThrow("Environment validation failed");
    });

    it("should reject an invalid PASSKEY_ORIGIN (not a URL)", () => {
      expect(() => parseEnv({ ...VALID_ENV, PASSKEY_ORIGIN: "not-a-url" })).toThrow(
        "Environment validation failed"
      );
    });

    it("should reject an ENCRYPTION_KEY that is not 64 hex characters", () => {
      expect(() => parseEnv({ ...VALID_ENV, ENCRYPTION_KEY: "too-short" })).toThrow(
        "Environment validation failed"
      );
    });

    it("should reject an ENCRYPTION_KEY with non-hex characters", () => {
      expect(() =>
        parseEnv({ ...VALID_ENV, ENCRYPTION_KEY: "g".repeat(64) })
      ).toThrow("Environment validation failed");
    });

    it("should reject an invalid NODE_ENV", () => {
      expect(() => parseEnv({ ...VALID_ENV, NODE_ENV: "staging" })).toThrow(
        "Environment validation failed"
      );
    });

    it("should reject an invalid PORT (out of range)", () => {
      expect(() => parseEnv({ ...VALID_ENV, PORT: "99999" })).toThrow(
        "Environment validation failed"
      );
    });
  });
});
