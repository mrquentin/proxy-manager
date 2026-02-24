package store

import (
	"testing"
)

func TestRouteCRUD(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)
	rs := NewRouteStore(db)

	// Create parent tunnel first (foreign key)
	ts.Create(&Tunnel{ID: "tun_r1", PublicKey: "pk_r1", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})

	route := &Route{
		ID:         "route_001",
		TunnelID:   "tun_r1",
		ListenPort: 443,
		MatchType:  "sni",
		MatchValue: []string{"app.example.com"},
		Upstream:   "10.0.0.2:443",
		CaddyID:    "route-tun_r1-443",
		Enabled:    true,
	}

	// Create
	if err := rs.Create(route); err != nil {
		t.Fatalf("create route: %v", err)
	}

	// Get
	got, err := rs.Get("route_001")
	if err != nil {
		t.Fatalf("get route: %v", err)
	}
	if got.TunnelID != "tun_r1" {
		t.Errorf("expected tunnel_id tun_r1, got %s", got.TunnelID)
	}
	if got.Upstream != "10.0.0.2:443" {
		t.Errorf("expected upstream 10.0.0.2:443, got %s", got.Upstream)
	}
	if len(got.MatchValue) != 1 || got.MatchValue[0] != "app.example.com" {
		t.Errorf("expected match_value [app.example.com], got %v", got.MatchValue)
	}

	// List
	all, err := rs.List()
	if err != nil {
		t.Fatalf("list routes: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("expected 1 route, got %d", len(all))
	}

	// ListByTunnelID
	byTunnel, err := rs.ListByTunnelID("tun_r1")
	if err != nil {
		t.Fatalf("list by tunnel: %v", err)
	}
	if len(byTunnel) != 1 {
		t.Fatalf("expected 1 route for tunnel, got %d", len(byTunnel))
	}

	// Delete
	if err := rs.Delete("route_001"); err != nil {
		t.Fatalf("delete route: %v", err)
	}
	all, _ = rs.List()
	if len(all) != 0 {
		t.Errorf("expected 0 routes after delete, got %d", len(all))
	}
}

func TestRouteDeleteNotFound(t *testing.T) {
	db := setupTestDB(t)
	rs := NewRouteStore(db)

	err := rs.Delete("nonexistent")
	if err == nil {
		t.Fatal("expected error deleting nonexistent route")
	}
}

func TestRouteListEnabled(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)
	rs := NewRouteStore(db)

	ts.Create(&Tunnel{ID: "tun_re", PublicKey: "pk_re", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})

	rs.Create(&Route{ID: "r_e1", TunnelID: "tun_re", ListenPort: 443, MatchType: "sni", MatchValue: []string{"a.com"}, Upstream: "10.0.0.2:443", CaddyID: "route-1", Enabled: true})
	rs.Create(&Route{ID: "r_e2", TunnelID: "tun_re", ListenPort: 443, MatchType: "sni", MatchValue: []string{"b.com"}, Upstream: "10.0.0.2:443", CaddyID: "route-2", Enabled: false})

	enabled, err := rs.ListEnabled()
	if err != nil {
		t.Fatalf("list enabled: %v", err)
	}
	if len(enabled) != 1 {
		t.Fatalf("expected 1 enabled route, got %d", len(enabled))
	}
}

func TestRouteDeleteByTunnelID(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)
	rs := NewRouteStore(db)

	ts.Create(&Tunnel{ID: "tun_del", PublicKey: "pk_del", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})
	rs.Create(&Route{ID: "r_d1", TunnelID: "tun_del", ListenPort: 443, MatchType: "sni", MatchValue: []string{"a.com"}, Upstream: "10.0.0.2:443", CaddyID: "r-1", Enabled: true})
	rs.Create(&Route{ID: "r_d2", TunnelID: "tun_del", ListenPort: 8080, MatchType: "sni", MatchValue: []string{"b.com"}, Upstream: "10.0.0.2:8080", CaddyID: "r-2", Enabled: true})

	err := rs.DeleteByTunnelID("tun_del")
	if err != nil {
		t.Fatalf("delete by tunnel id: %v", err)
	}

	all, _ := rs.List()
	if len(all) != 0 {
		t.Errorf("expected 0 routes after delete, got %d", len(all))
	}
}
