package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Tunnel represents a WireGuard peer in the database.
type Tunnel struct {
	ID                      string
	PublicKey               string
	VpnIP                   string
	PSKHash                 string
	Endpoint                string
	Domains                 []string
	Enabled                 bool
	LastHandshake           *time.Time
	TxBytes                 int64
	RxBytes                 int64
	AutoRotatePSK           bool
	PSKRotationIntervalDays int
	AutoRevokeInactive      bool
	InactiveExpiryDays      int
	GracePeriodMinutes      int
	LastRotationAt          *time.Time
	PendingRotationID       string
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

// TunnelStore provides CRUD operations for wg_peers.
type TunnelStore struct {
	db *sql.DB
}

// NewTunnelStore creates a TunnelStore using the given DB.
func NewTunnelStore(db *DB) *TunnelStore {
	return &TunnelStore{db: db.Conn()}
}

// Create inserts a new tunnel into the database.
func (s *TunnelStore) Create(t *Tunnel) error {
	domainsJSON, err := json.Marshal(t.Domains)
	if err != nil {
		return fmt.Errorf("marshal domains: %w", err)
	}

	now := time.Now().Unix()
	var lastHandshake *int64
	if t.LastHandshake != nil {
		v := t.LastHandshake.Unix()
		lastHandshake = &v
	}
	var lastRotation *int64
	if t.LastRotationAt != nil {
		v := t.LastRotationAt.Unix()
		lastRotation = &v
	}

	_, err = s.db.Exec(`INSERT INTO wg_peers (
		id, public_key, vpn_ip, psk_hash, endpoint, domains, enabled,
		last_handshake, tx_bytes, rx_bytes,
		auto_rotate_psk, psk_rotation_interval_days,
		auto_revoke_inactive, inactive_expiry_days, grace_period_minutes,
		last_rotation_at, pending_rotation_id, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.PublicKey, t.VpnIP, nullString(t.PSKHash), nullString(t.Endpoint),
		string(domainsJSON), boolToInt(t.Enabled),
		lastHandshake, t.TxBytes, t.RxBytes,
		boolToInt(t.AutoRotatePSK), t.PSKRotationIntervalDays,
		boolToInt(t.AutoRevokeInactive), t.InactiveExpiryDays, t.GracePeriodMinutes,
		lastRotation, nullString(t.PendingRotationID),
		now, now,
	)
	if err != nil {
		return fmt.Errorf("insert tunnel: %w", err)
	}
	t.CreatedAt = time.Unix(now, 0)
	t.UpdatedAt = time.Unix(now, 0)
	return nil
}

// Get retrieves a tunnel by ID.
func (s *TunnelStore) Get(id string) (*Tunnel, error) {
	row := s.db.QueryRow(`SELECT
		id, public_key, vpn_ip, psk_hash, endpoint, domains, enabled,
		last_handshake, tx_bytes, rx_bytes,
		auto_rotate_psk, psk_rotation_interval_days,
		auto_revoke_inactive, inactive_expiry_days, grace_period_minutes,
		last_rotation_at, pending_rotation_id, created_at, updated_at
	FROM wg_peers WHERE id = ?`, id)
	return scanTunnel(row)
}

// GetByPublicKey retrieves a tunnel by its WireGuard public key.
func (s *TunnelStore) GetByPublicKey(pubkey string) (*Tunnel, error) {
	row := s.db.QueryRow(`SELECT
		id, public_key, vpn_ip, psk_hash, endpoint, domains, enabled,
		last_handshake, tx_bytes, rx_bytes,
		auto_rotate_psk, psk_rotation_interval_days,
		auto_revoke_inactive, inactive_expiry_days, grace_period_minutes,
		last_rotation_at, pending_rotation_id, created_at, updated_at
	FROM wg_peers WHERE public_key = ?`, pubkey)
	return scanTunnel(row)
}

// List returns all tunnels.
func (s *TunnelStore) List() ([]*Tunnel, error) {
	rows, err := s.db.Query(`SELECT
		id, public_key, vpn_ip, psk_hash, endpoint, domains, enabled,
		last_handshake, tx_bytes, rx_bytes,
		auto_rotate_psk, psk_rotation_interval_days,
		auto_revoke_inactive, inactive_expiry_days, grace_period_minutes,
		last_rotation_at, pending_rotation_id, created_at, updated_at
	FROM wg_peers ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list tunnels: %w", err)
	}
	defer rows.Close()

	var tunnels []*Tunnel
	for rows.Next() {
		t, err := scanTunnelRows(rows)
		if err != nil {
			return nil, err
		}
		tunnels = append(tunnels, t)
	}
	return tunnels, rows.Err()
}

// ListEnabled returns only enabled tunnels.
func (s *TunnelStore) ListEnabled() ([]*Tunnel, error) {
	rows, err := s.db.Query(`SELECT
		id, public_key, vpn_ip, psk_hash, endpoint, domains, enabled,
		last_handshake, tx_bytes, rx_bytes,
		auto_rotate_psk, psk_rotation_interval_days,
		auto_revoke_inactive, inactive_expiry_days, grace_period_minutes,
		last_rotation_at, pending_rotation_id, created_at, updated_at
	FROM wg_peers WHERE enabled = 1 ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list enabled tunnels: %w", err)
	}
	defer rows.Close()

	var tunnels []*Tunnel
	for rows.Next() {
		t, err := scanTunnelRows(rows)
		if err != nil {
			return nil, err
		}
		tunnels = append(tunnels, t)
	}
	return tunnels, rows.Err()
}

// Delete removes a tunnel by ID.
func (s *TunnelStore) Delete(id string) error {
	res, err := s.db.Exec(`DELETE FROM wg_peers WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete tunnel: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("tunnel not found: %s", id)
	}
	return nil
}

// UpdateRotationPolicy updates rotation policy fields for a tunnel.
func (s *TunnelStore) UpdateRotationPolicy(id string, autoRotatePSK *bool, intervalDays *int, autoRevokeInactive *bool, expiryDays *int, graceMins *int) (*Tunnel, error) {
	t, err := s.Get(id)
	if err != nil {
		return nil, err
	}

	if autoRotatePSK != nil {
		t.AutoRotatePSK = *autoRotatePSK
	}
	if intervalDays != nil {
		t.PSKRotationIntervalDays = *intervalDays
	}
	if autoRevokeInactive != nil {
		t.AutoRevokeInactive = *autoRevokeInactive
	}
	if expiryDays != nil {
		t.InactiveExpiryDays = *expiryDays
	}
	if graceMins != nil {
		t.GracePeriodMinutes = *graceMins
	}

	now := time.Now().Unix()
	_, err = s.db.Exec(`UPDATE wg_peers SET
		auto_rotate_psk = ?, psk_rotation_interval_days = ?,
		auto_revoke_inactive = ?, inactive_expiry_days = ?,
		grace_period_minutes = ?, updated_at = ?
	WHERE id = ?`,
		boolToInt(t.AutoRotatePSK), t.PSKRotationIntervalDays,
		boolToInt(t.AutoRevokeInactive), t.InactiveExpiryDays,
		t.GracePeriodMinutes, now, id,
	)
	if err != nil {
		return nil, fmt.Errorf("update rotation policy: %w", err)
	}
	t.UpdatedAt = time.Unix(now, 0)
	return t, nil
}

// UpdatePeerStats updates the handshake and traffic stats for a peer by public key.
func (s *TunnelStore) UpdatePeerStats(publicKey string, lastHandshake *time.Time, rxBytes, txBytes int64) error {
	var hs *int64
	if lastHandshake != nil && !lastHandshake.IsZero() {
		v := lastHandshake.Unix()
		hs = &v
	}
	now := time.Now().Unix()
	_, err := s.db.Exec(`UPDATE wg_peers SET
		last_handshake = COALESCE(?, last_handshake),
		rx_bytes = ?, tx_bytes = ?, updated_at = ?
	WHERE public_key = ?`, hs, rxBytes, txBytes, now, publicKey)
	return err
}

// SetPendingRotation sets the pending rotation ID and last rotation time.
func (s *TunnelStore) SetPendingRotation(id, pendingID string) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`UPDATE wg_peers SET
		pending_rotation_id = ?, last_rotation_at = ?, updated_at = ?
	WHERE id = ?`, pendingID, now, now, id)
	return err
}

// ClearPendingRotation clears the pending rotation ID.
func (s *TunnelStore) ClearPendingRotation(id string) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`UPDATE wg_peers SET
		pending_rotation_id = NULL, updated_at = ?
	WHERE id = ?`, now, id)
	return err
}

// AllocateIP finds the next available IP in the subnet.
// It queries existing VPN IPs and finds the lowest available one in 10.0.0.2..10.0.0.254.
func (s *TunnelStore) AllocateIP(serverIP string, subnetPrefix string) (string, error) {
	rows, err := s.db.Query(`SELECT vpn_ip FROM wg_peers ORDER BY vpn_ip`)
	if err != nil {
		return "", fmt.Errorf("query vpn_ips: %w", err)
	}
	defer rows.Close()

	usedIPs := make(map[string]bool)
	for rows.Next() {
		var ip string
		if err := rows.Scan(&ip); err != nil {
			return "", err
		}
		usedIPs[ip] = true
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	// Try IPs from .2 to .254 in the subnet prefix (e.g., "10.0.0")
	for i := 2; i <= 254; i++ {
		candidate := fmt.Sprintf("%s.%d", subnetPrefix, i)
		if candidate == serverIP {
			continue
		}
		if !usedIPs[candidate] {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("no available IP addresses in subnet %s.0/24", subnetPrefix)
}

// Helper scanner for a single row
func scanTunnel(row *sql.Row) (*Tunnel, error) {
	t := &Tunnel{}
	var (
		pskHash, endpoint, domainsJSON, pendingRotID sql.NullString
		enabled, autoRotate, autoRevoke              int
		lastHS, lastRotation                         sql.NullInt64
		createdAt, updatedAt                         int64
	)

	err := row.Scan(
		&t.ID, &t.PublicKey, &t.VpnIP, &pskHash, &endpoint, &domainsJSON,
		&enabled, &lastHS, &t.TxBytes, &t.RxBytes,
		&autoRotate, &t.PSKRotationIntervalDays,
		&autoRevoke, &t.InactiveExpiryDays, &t.GracePeriodMinutes,
		&lastRotation, &pendingRotID, &createdAt, &updatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("tunnel not found")
		}
		return nil, fmt.Errorf("scan tunnel: %w", err)
	}

	fillTunnel(t, pskHash, endpoint, domainsJSON, pendingRotID,
		enabled, autoRotate, autoRevoke, lastHS, lastRotation, createdAt, updatedAt)
	return t, nil
}

// scanTunnelRows scans a tunnel from rows.
func scanTunnelRows(rows *sql.Rows) (*Tunnel, error) {
	t := &Tunnel{}
	var (
		pskHash, endpoint, domainsJSON, pendingRotID sql.NullString
		enabled, autoRotate, autoRevoke              int
		lastHS, lastRotation                         sql.NullInt64
		createdAt, updatedAt                         int64
	)

	err := rows.Scan(
		&t.ID, &t.PublicKey, &t.VpnIP, &pskHash, &endpoint, &domainsJSON,
		&enabled, &lastHS, &t.TxBytes, &t.RxBytes,
		&autoRotate, &t.PSKRotationIntervalDays,
		&autoRevoke, &t.InactiveExpiryDays, &t.GracePeriodMinutes,
		&lastRotation, &pendingRotID, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan tunnel row: %w", err)
	}

	fillTunnel(t, pskHash, endpoint, domainsJSON, pendingRotID,
		enabled, autoRotate, autoRevoke, lastHS, lastRotation, createdAt, updatedAt)
	return t, nil
}

func fillTunnel(t *Tunnel, pskHash, endpoint, domainsJSON, pendingRotID sql.NullString,
	enabled, autoRotate, autoRevoke int, lastHS, lastRotation sql.NullInt64,
	createdAt, updatedAt int64) {

	if pskHash.Valid {
		t.PSKHash = pskHash.String
	}
	if endpoint.Valid {
		t.Endpoint = endpoint.String
	}
	if domainsJSON.Valid && domainsJSON.String != "" {
		_ = json.Unmarshal([]byte(domainsJSON.String), &t.Domains)
	}
	if t.Domains == nil {
		t.Domains = []string{}
	}
	if pendingRotID.Valid {
		t.PendingRotationID = pendingRotID.String
	}
	t.Enabled = enabled == 1
	t.AutoRotatePSK = autoRotate == 1
	t.AutoRevokeInactive = autoRevoke == 1
	if lastHS.Valid {
		hs := time.Unix(lastHS.Int64, 0)
		t.LastHandshake = &hs
	}
	if lastRotation.Valid {
		rot := time.Unix(lastRotation.Int64, 0)
		t.LastRotationAt = &rot
	}
	t.CreatedAt = time.Unix(createdAt, 0)
	t.UpdatedAt = time.Unix(updatedAt, 0)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
