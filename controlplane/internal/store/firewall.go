package store

import (
	"database/sql"
	"fmt"
	"time"
)

// FirewallRule represents a dynamic firewall rule in the database.
type FirewallRule struct {
	ID         string
	Port       int
	Proto      string
	Direction  string
	SourceCIDR string
	Action     string
	Enabled    bool
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// FirewallStore provides CRUD operations for firewall_rules.
type FirewallStore struct {
	db *sql.DB
}

// DB returns the underlying *sql.DB. Used by the reconciler test for direct access.
func (s *FirewallStore) DB() *DB {
	return &DB{conn: s.db}
}

// NewFirewallStore creates a FirewallStore using the given DB.
func NewFirewallStore(db *DB) *FirewallStore {
	return &FirewallStore{db: db.Conn()}
}

// Create inserts a new firewall rule.
func (s *FirewallStore) Create(r *FirewallRule) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`INSERT INTO firewall_rules (
		id, port, proto, direction, source_cidr, action, enabled, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.Port, r.Proto, r.Direction, r.SourceCIDR, r.Action,
		boolToInt(r.Enabled), now, now,
	)
	if err != nil {
		return fmt.Errorf("insert firewall rule: %w", err)
	}
	r.CreatedAt = time.Unix(now, 0)
	r.UpdatedAt = time.Unix(now, 0)
	return nil
}

// Get retrieves a firewall rule by ID.
func (s *FirewallStore) Get(id string) (*FirewallRule, error) {
	row := s.db.QueryRow(`SELECT
		id, port, proto, direction, source_cidr, action, enabled, created_at, updated_at
	FROM firewall_rules WHERE id = ?`, id)
	return scanFirewallRule(row)
}

// List returns all firewall rules.
func (s *FirewallStore) List() ([]*FirewallRule, error) {
	rows, err := s.db.Query(`SELECT
		id, port, proto, direction, source_cidr, action, enabled, created_at, updated_at
	FROM firewall_rules ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list firewall rules: %w", err)
	}
	defer rows.Close()

	var rules []*FirewallRule
	for rows.Next() {
		r, err := scanFirewallRuleRows(rows)
		if err != nil {
			return nil, err
		}
		rules = append(rules, r)
	}
	return rules, rows.Err()
}

// ListEnabled returns only enabled firewall rules.
func (s *FirewallStore) ListEnabled() ([]*FirewallRule, error) {
	rows, err := s.db.Query(`SELECT
		id, port, proto, direction, source_cidr, action, enabled, created_at, updated_at
	FROM firewall_rules WHERE enabled = 1 ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list enabled firewall rules: %w", err)
	}
	defer rows.Close()

	var rules []*FirewallRule
	for rows.Next() {
		r, err := scanFirewallRuleRows(rows)
		if err != nil {
			return nil, err
		}
		rules = append(rules, r)
	}
	return rules, rows.Err()
}

// Delete removes a firewall rule by ID.
func (s *FirewallStore) Delete(id string) error {
	res, err := s.db.Exec(`DELETE FROM firewall_rules WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete firewall rule: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("firewall rule not found: %s", id)
	}
	return nil
}

func scanFirewallRule(row *sql.Row) (*FirewallRule, error) {
	r := &FirewallRule{}
	var (
		enabled              int
		createdAt, updatedAt int64
	)

	err := row.Scan(
		&r.ID, &r.Port, &r.Proto, &r.Direction, &r.SourceCIDR,
		&r.Action, &enabled, &createdAt, &updatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("firewall rule not found")
		}
		return nil, fmt.Errorf("scan firewall rule: %w", err)
	}

	r.Enabled = enabled == 1
	r.CreatedAt = time.Unix(createdAt, 0)
	r.UpdatedAt = time.Unix(updatedAt, 0)
	return r, nil
}

func scanFirewallRuleRows(rows *sql.Rows) (*FirewallRule, error) {
	r := &FirewallRule{}
	var (
		enabled              int
		createdAt, updatedAt int64
	)

	err := rows.Scan(
		&r.ID, &r.Port, &r.Proto, &r.Direction, &r.SourceCIDR,
		&r.Action, &enabled, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan firewall rule row: %w", err)
	}

	r.Enabled = enabled == 1
	r.CreatedAt = time.Unix(createdAt, 0)
	r.UpdatedAt = time.Unix(updatedAt, 0)
	return r, nil
}

// ReconciliationState represents the singleton reconciliation status row.
type ReconciliationState struct {
	IntervalSeconds  int
	LastRunAt        *time.Time
	LastStatus       string
	LastError        string
	DriftCorrections int
}

// GetReconciliationState reads the singleton reconciliation state.
func (s *FirewallStore) GetReconciliationState() (*ReconciliationState, error) {
	row := s.db.QueryRow(`SELECT interval_seconds, last_run_at, last_status, last_error, drift_corrections
		FROM reconciliation_state WHERE id = 1`)

	rs := &ReconciliationState{}
	var lastRunAt sql.NullInt64
	var lastError sql.NullString

	err := row.Scan(&rs.IntervalSeconds, &lastRunAt, &rs.LastStatus, &lastError, &rs.DriftCorrections)
	if err != nil {
		return nil, fmt.Errorf("scan reconciliation state: %w", err)
	}

	if lastRunAt.Valid {
		t := time.Unix(lastRunAt.Int64, 0)
		rs.LastRunAt = &t
	}
	if lastError.Valid {
		rs.LastError = lastError.String
	}
	return rs, nil
}

// UpdateReconciliationState updates the reconciliation state.
func (s *FirewallStore) UpdateReconciliationState(status string, errMsg *string, driftOps int) error {
	now := time.Now().Unix()
	var errStr sql.NullString
	if errMsg != nil {
		errStr = sql.NullString{String: *errMsg, Valid: true}
	}

	_, err := s.db.Exec(`UPDATE reconciliation_state SET
		last_run_at = ?, last_status = ?, last_error = ?,
		drift_corrections = drift_corrections + ?
	WHERE id = 1`, now, status, errStr, driftOps)
	return err
}

// WriteAuditLog writes an entry to the audit log.
func (s *FirewallStore) WriteAuditLog(clientCN, sourceIP, method, path, bodyHash, result string, errMsg string) error {
	now := time.Now().Unix()
	var errStr sql.NullString
	if errMsg != "" {
		errStr = sql.NullString{String: errMsg, Valid: true}
	}
	_, err := s.db.Exec(`INSERT INTO audit_log (timestamp, client_cn, source_ip, method, path, body_hash, result, error_msg)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		now, nullString(clientCN), nullString(sourceIP), method, path, nullString(bodyHash), result, errStr)
	return err
}
