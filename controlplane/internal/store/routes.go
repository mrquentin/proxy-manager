package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Route represents an L4 forwarding route in the database.
type Route struct {
	ID         string
	TunnelID   string
	ListenPort int
	Protocol   string // "tcp" or "udp"
	MatchType  string // "sni" or "port_forward"
	MatchValue []string
	Upstream   string
	CaddyID    string
	Enabled    bool
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// RouteStore provides CRUD operations for l4_routes.
type RouteStore struct {
	db *sql.DB
}

// NewRouteStore creates a RouteStore using the given DB.
func NewRouteStore(db *DB) *RouteStore {
	return &RouteStore{db: db.Conn()}
}

// Create inserts a new route.
func (s *RouteStore) Create(r *Route) error {
	matchJSON, err := json.Marshal(r.MatchValue)
	if err != nil {
		return fmt.Errorf("marshal match_value: %w", err)
	}

	if r.Protocol == "" {
		r.Protocol = "tcp"
	}

	now := time.Now().Unix()
	_, err = s.db.Exec(`INSERT INTO l4_routes (
		id, tunnel_id, listen_port, protocol, match_type, match_value,
		upstream, caddy_id, enabled, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.TunnelID, r.ListenPort, r.Protocol, r.MatchType,
		string(matchJSON), r.Upstream, r.CaddyID,
		boolToInt(r.Enabled), now, now,
	)
	if err != nil {
		return fmt.Errorf("insert route: %w", err)
	}
	r.CreatedAt = time.Unix(now, 0)
	r.UpdatedAt = time.Unix(now, 0)
	return nil
}

// Get retrieves a route by ID.
func (s *RouteStore) Get(id string) (*Route, error) {
	row := s.db.QueryRow(`SELECT
		id, tunnel_id, listen_port, protocol, match_type, match_value,
		upstream, caddy_id, enabled, created_at, updated_at
	FROM l4_routes WHERE id = ?`, id)
	return scanRoute(row)
}

// List returns all routes.
func (s *RouteStore) List() ([]*Route, error) {
	rows, err := s.db.Query(`SELECT
		id, tunnel_id, listen_port, protocol, match_type, match_value,
		upstream, caddy_id, enabled, created_at, updated_at
	FROM l4_routes ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list routes: %w", err)
	}
	defer rows.Close()

	var routes []*Route
	for rows.Next() {
		r, err := scanRouteRows(rows)
		if err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	return routes, rows.Err()
}

// ListEnabled returns only enabled routes.
func (s *RouteStore) ListEnabled() ([]*Route, error) {
	rows, err := s.db.Query(`SELECT
		id, tunnel_id, listen_port, protocol, match_type, match_value,
		upstream, caddy_id, enabled, created_at, updated_at
	FROM l4_routes WHERE enabled = 1 ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list enabled routes: %w", err)
	}
	defer rows.Close()

	var routes []*Route
	for rows.Next() {
		r, err := scanRouteRows(rows)
		if err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	return routes, rows.Err()
}

// ListByTunnelID returns all routes for a given tunnel.
func (s *RouteStore) ListByTunnelID(tunnelID string) ([]*Route, error) {
	rows, err := s.db.Query(`SELECT
		id, tunnel_id, listen_port, protocol, match_type, match_value,
		upstream, caddy_id, enabled, created_at, updated_at
	FROM l4_routes WHERE tunnel_id = ? ORDER BY created_at ASC`, tunnelID)
	if err != nil {
		return nil, fmt.Errorf("list routes by tunnel: %w", err)
	}
	defer rows.Close()

	var routes []*Route
	for rows.Next() {
		r, err := scanRouteRows(rows)
		if err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	return routes, rows.Err()
}

// Delete removes a route by ID.
func (s *RouteStore) Delete(id string) error {
	res, err := s.db.Exec(`DELETE FROM l4_routes WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete route: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("route not found: %s", id)
	}
	return nil
}

// FindByPortAndProtocol checks if a route already uses a given listen_port + protocol.
func (s *RouteStore) FindByPortAndProtocol(port int, protocol string) (*Route, error) {
	row := s.db.QueryRow(`SELECT
		id, tunnel_id, listen_port, protocol, match_type, match_value,
		upstream, caddy_id, enabled, created_at, updated_at
	FROM l4_routes WHERE listen_port = ? AND protocol = ? AND enabled = 1 LIMIT 1`, port, protocol)
	r, err := scanRoute(row)
	if err != nil {
		if err.Error() == "route not found" {
			return nil, nil
		}
		return nil, err
	}
	return r, nil
}

// DeleteByTunnelID removes all routes for a given tunnel.
func (s *RouteStore) DeleteByTunnelID(tunnelID string) error {
	_, err := s.db.Exec(`DELETE FROM l4_routes WHERE tunnel_id = ?`, tunnelID)
	return err
}

func scanRoute(row *sql.Row) (*Route, error) {
	r := &Route{}
	var (
		matchJSON            string
		enabled              int
		createdAt, updatedAt int64
	)

	err := row.Scan(
		&r.ID, &r.TunnelID, &r.ListenPort, &r.Protocol, &r.MatchType, &matchJSON,
		&r.Upstream, &r.CaddyID, &enabled, &createdAt, &updatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("route not found")
		}
		return nil, fmt.Errorf("scan route: %w", err)
	}

	fillRoute(r, matchJSON, enabled, createdAt, updatedAt)
	return r, nil
}

func scanRouteRows(rows *sql.Rows) (*Route, error) {
	r := &Route{}
	var (
		matchJSON            string
		enabled              int
		createdAt, updatedAt int64
	)

	err := rows.Scan(
		&r.ID, &r.TunnelID, &r.ListenPort, &r.Protocol, &r.MatchType, &matchJSON,
		&r.Upstream, &r.CaddyID, &enabled, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan route row: %w", err)
	}

	fillRoute(r, matchJSON, enabled, createdAt, updatedAt)
	return r, nil
}

func fillRoute(r *Route, matchJSON string, enabled int, createdAt, updatedAt int64) {
	_ = json.Unmarshal([]byte(matchJSON), &r.MatchValue)
	if r.MatchValue == nil {
		r.MatchValue = []string{}
	}
	r.Enabled = enabled == 1
	r.CreatedAt = time.Unix(createdAt, 0)
	r.UpdatedAt = time.Unix(updatedAt, 0)
}
