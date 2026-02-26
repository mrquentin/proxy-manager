package store

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"

	_ "modernc.org/sqlite"
)

// DB wraps the SQLite database connection and provides access to all stores.
type DB struct {
	conn *sql.DB
}

// New opens a SQLite database at the given path (use ":memory:" for tests),
// enables WAL mode and foreign keys, and runs all migrations.
func New(path string) (*DB, error) {
	dsn := path
	if path == ":memory:" {
		dsn = ":memory:?_pragma=journal_mode(wal)&_pragma=foreign_keys(on)"
	} else {
		dsn = path + "?_pragma=journal_mode(wal)&_pragma=foreign_keys(on)"
	}

	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	conn.SetMaxOpenConns(1) // SQLite doesn't do well with concurrent writes

	db := &DB{conn: conn}
	if err := db.migrate(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return db, nil
}

// Close closes the underlying database connection.
func (db *DB) Close() error {
	return db.conn.Close()
}

// Conn returns the raw *sql.DB connection for direct use.
func (db *DB) Conn() *sql.DB {
	return db.conn
}

func (db *DB) migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS wg_peers (
			id                          TEXT PRIMARY KEY,
			public_key                  TEXT NOT NULL UNIQUE,
			vpn_ip                      TEXT NOT NULL UNIQUE,
			psk_hash                    TEXT,
			endpoint                    TEXT,
			domains                     TEXT,
			enabled                     INTEGER NOT NULL DEFAULT 1,
			last_handshake              INTEGER,
			tx_bytes                    INTEGER DEFAULT 0,
			rx_bytes                    INTEGER DEFAULT 0,
			auto_rotate_psk             INTEGER NOT NULL DEFAULT 0,
			psk_rotation_interval_days  INTEGER NOT NULL DEFAULT 0,
			auto_revoke_inactive        INTEGER NOT NULL DEFAULT 1,
			inactive_expiry_days        INTEGER NOT NULL DEFAULT 90,
			grace_period_minutes        INTEGER NOT NULL DEFAULT 30,
			last_rotation_at            INTEGER,
			pending_rotation_id         TEXT,
			created_at                  INTEGER NOT NULL,
			updated_at                  INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS l4_routes (
			id          TEXT PRIMARY KEY,
			tunnel_id   TEXT NOT NULL REFERENCES wg_peers(id),
			listen_port INTEGER NOT NULL DEFAULT 443,
			match_type  TEXT NOT NULL DEFAULT 'sni',
			match_value TEXT NOT NULL,
			upstream    TEXT NOT NULL,
			caddy_id    TEXT NOT NULL,
			enabled     INTEGER NOT NULL DEFAULT 1,
			created_at  INTEGER NOT NULL,
			updated_at  INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS firewall_rules (
			id          TEXT PRIMARY KEY,
			port        INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
			proto       TEXT NOT NULL CHECK (proto IN ('tcp', 'udp')),
			direction   TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out')),
			source_cidr TEXT NOT NULL DEFAULT '0.0.0.0/0',
			action      TEXT NOT NULL DEFAULT 'allow' CHECK (action IN ('allow', 'deny')),
			enabled     INTEGER NOT NULL DEFAULT 1,
			created_at  INTEGER NOT NULL,
			updated_at  INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS reconciliation_state (
			id                  INTEGER PRIMARY KEY DEFAULT 1,
			interval_seconds    INTEGER NOT NULL DEFAULT 30,
			last_run_at         INTEGER,
			last_status         TEXT DEFAULT 'pending',
			last_error          TEXT,
			drift_corrections   INTEGER DEFAULT 0,
			CHECK (id = 1)
		)`,
		`INSERT OR IGNORE INTO reconciliation_state (id, interval_seconds, last_status, drift_corrections) VALUES (1, 30, 'pending', 0)`,
		// Migration: add protocol column for port-forward routes
		`ALTER TABLE l4_routes ADD COLUMN protocol TEXT NOT NULL DEFAULT 'tcp' CHECK (protocol IN ('tcp', 'udp'))`,
		`CREATE TABLE IF NOT EXISTS audit_log (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp   INTEGER NOT NULL,
			client_cn   TEXT,
			source_ip   TEXT,
			method      TEXT NOT NULL,
			path        TEXT NOT NULL,
			body_hash   TEXT,
			result      TEXT NOT NULL,
			error_msg   TEXT
		)`,
	}

	for i, m := range migrations {
		if _, err := db.conn.Exec(m); err != nil {
			// ALTER TABLE fails if column already exists — skip gracefully
			if strings.Contains(m, "ALTER TABLE") && strings.Contains(err.Error(), "duplicate column") {
				continue
			}
			return fmt.Errorf("migration %d: %w", i, err)
		}
	}

	slog.Info("database migrations applied successfully")
	return nil
}
