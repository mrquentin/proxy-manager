import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { sql } from "drizzle-orm";
import * as schema from "./schema/index";

/** SQL statements to create all tables (idempotent). */
const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS \`user\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`email\` text NOT NULL,
  \`email_verified\` integer DEFAULT 0 NOT NULL,
  \`image\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS \`user_email_unique\` ON \`user\` (\`email\`);

CREATE TABLE IF NOT EXISTS \`session\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`token\` text NOT NULL,
  \`user_id\` text NOT NULL,
  \`active_organization_id\` text,
  \`expires_at\` integer NOT NULL,
  \`ip_address\` text,
  \`user_agent\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS \`session_token_unique\` ON \`session\` (\`token\`);

CREATE TABLE IF NOT EXISTS \`account\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`user_id\` text NOT NULL,
  \`account_id\` text NOT NULL,
  \`provider_id\` text NOT NULL,
  \`access_token\` text,
  \`refresh_token\` text,
  \`access_token_expires_at\` integer,
  \`refresh_token_expires_at\` integer,
  \`scope\` text,
  \`id_token\` text,
  \`password\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS \`verification\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`identifier\` text NOT NULL,
  \`value\` text NOT NULL,
  \`expires_at\` integer NOT NULL,
  \`created_at\` integer,
  \`updated_at\` integer
);

CREATE TABLE IF NOT EXISTS \`passkey\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text,
  \`user_id\` text NOT NULL,
  \`credential_id\` text NOT NULL,
  \`public_key\` text NOT NULL,
  \`counter\` integer DEFAULT 0 NOT NULL,
  \`device_type\` text,
  \`backed_up\` integer,
  \`transports\` text,
  \`created_at\` integer,
  FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS \`passkey_credential_id_unique\` ON \`passkey\` (\`credential_id\`);

CREATE TABLE IF NOT EXISTS \`organization\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`slug\` text NOT NULL,
  \`logo\` text,
  \`metadata\` text,
  \`created_at\` integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS \`organization_slug_unique\` ON \`organization\` (\`slug\`);

CREATE TABLE IF NOT EXISTS \`member\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`user_id\` text NOT NULL,
  \`organization_id\` text NOT NULL,
  \`role\` text DEFAULT 'viewer' NOT NULL,
  \`created_at\` integer NOT NULL,
  FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE,
  FOREIGN KEY (\`organization_id\`) REFERENCES \`organization\`(\`id\`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS \`invitation\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`email\` text NOT NULL,
  \`organization_id\` text NOT NULL,
  \`role\` text DEFAULT 'viewer' NOT NULL,
  \`inviter_id\` text NOT NULL,
  \`status\` text DEFAULT 'pending' NOT NULL,
  \`expires_at\` integer NOT NULL,
  \`created_at\` integer NOT NULL,
  FOREIGN KEY (\`organization_id\`) REFERENCES \`organization\`(\`id\`) ON DELETE CASCADE,
  FOREIGN KEY (\`inviter_id\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS \`vps_instances\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`organization_id\` text NOT NULL,
  \`name\` text NOT NULL,
  \`api_url\` text NOT NULL,
  \`encrypted_client_key\` text NOT NULL,
  \`client_cert\` text NOT NULL,
  \`server_ca\` text NOT NULL,
  \`status\` text DEFAULT 'unknown' NOT NULL,
  \`last_seen_at\` integer,
  \`created_at\` integer NOT NULL,
  FOREIGN KEY (\`organization_id\`) REFERENCES \`organization\`(\`id\`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS \`audit_log\` (
  \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  \`organization_id\` text NOT NULL,
  \`user_id\` text NOT NULL,
  \`action\` text NOT NULL,
  \`resource_type\` text NOT NULL,
  \`resource_id\` text,
  \`metadata\` text,
  \`created_at\` integer NOT NULL,
  FOREIGN KEY (\`organization_id\`) REFERENCES \`organization\`(\`id\`) ON DELETE CASCADE
);
`;

/**
 * Create a Drizzle ORM database instance backed by bun:sqlite.
 * Automatically creates tables if they don't exist.
 *
 * @param url - Path to the SQLite database file. Defaults to DATABASE_URL env var.
 * @returns A Drizzle ORM instance with the full schema.
 */
export function createDatabase(url?: string) {
  const dbPath = url ?? process.env.DATABASE_PATH ?? "./data/proxy-manager.db";
  const sqlite = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrent read performance
  sqlite.exec("PRAGMA journal_mode = WAL;");
  // Enable foreign key enforcement
  sqlite.exec("PRAGMA foreign_keys = ON;");

  // Auto-create tables (idempotent — uses IF NOT EXISTS)
  sqlite.exec(MIGRATIONS);

  return drizzle(sqlite, { schema });
}

/**
 * Lazily-initialized singleton database instance.
 * Uses the default path or DATABASE_PATH env var when first accessed.
 * For explicit path control, call createDatabase(path) directly instead.
 */
let _db: ReturnType<typeof createDatabase> | null = null;
export function getDb() {
  if (!_db) {
    _db = createDatabase();
  }
  return _db;
}

// Re-export all schema definitions
export * from "./schema/index";
