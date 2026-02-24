import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema/index";

/**
 * Create a Drizzle ORM database instance backed by bun:sqlite.
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
