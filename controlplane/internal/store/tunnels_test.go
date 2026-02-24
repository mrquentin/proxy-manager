package store

import (
	"testing"
	"time"
)

func setupTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := New(":memory:")
	if err != nil {
		t.Fatalf("failed to create test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestTunnelCRUD(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)

	tunnel := &Tunnel{
		ID:                 "tun_001",
		PublicKey:           "pubkey1base64=",
		VpnIP:              "10.0.0.2",
		PSKHash:            "somehash",
		Domains:            []string{"app.example.com"},
		Enabled:            true,
		AutoRevokeInactive: true,
		InactiveExpiryDays: 90,
		GracePeriodMinutes: 30,
	}

	// Create
	if err := ts.Create(tunnel); err != nil {
		t.Fatalf("create tunnel: %v", err)
	}

	// Get
	got, err := ts.Get("tun_001")
	if err != nil {
		t.Fatalf("get tunnel: %v", err)
	}
	if got.PublicKey != "pubkey1base64=" {
		t.Errorf("expected pubkey pubkey1base64=, got %s", got.PublicKey)
	}
	if got.VpnIP != "10.0.0.2" {
		t.Errorf("expected vpn ip 10.0.0.2, got %s", got.VpnIP)
	}
	if len(got.Domains) != 1 || got.Domains[0] != "app.example.com" {
		t.Errorf("expected domains [app.example.com], got %v", got.Domains)
	}
	if !got.Enabled {
		t.Error("expected enabled=true")
	}
	if !got.AutoRevokeInactive {
		t.Error("expected auto_revoke_inactive=true")
	}

	// List
	all, err := ts.List()
	if err != nil {
		t.Fatalf("list tunnels: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("expected 1 tunnel, got %d", len(all))
	}

	// GetByPublicKey
	got2, err := ts.GetByPublicKey("pubkey1base64=")
	if err != nil {
		t.Fatalf("get by pubkey: %v", err)
	}
	if got2.ID != "tun_001" {
		t.Errorf("expected tun_001, got %s", got2.ID)
	}

	// Delete
	if err := ts.Delete("tun_001"); err != nil {
		t.Fatalf("delete tunnel: %v", err)
	}
	all, _ = ts.List()
	if len(all) != 0 {
		t.Errorf("expected 0 tunnels after delete, got %d", len(all))
	}
}

func TestTunnelDeleteNotFound(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)

	err := ts.Delete("nonexistent")
	if err == nil {
		t.Fatal("expected error deleting nonexistent tunnel")
	}
}

func TestTunnelListEnabled(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)

	ts.Create(&Tunnel{ID: "tun_e1", PublicKey: "pk1", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})
	ts.Create(&Tunnel{ID: "tun_e2", PublicKey: "pk2", VpnIP: "10.0.0.3", Enabled: false, Domains: []string{}})

	enabled, err := ts.ListEnabled()
	if err != nil {
		t.Fatalf("list enabled: %v", err)
	}
	if len(enabled) != 1 {
		t.Fatalf("expected 1 enabled, got %d", len(enabled))
	}
	if enabled[0].ID != "tun_e1" {
		t.Errorf("expected tun_e1, got %s", enabled[0].ID)
	}
}

func TestTunnelUpdateRotationPolicy(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)

	ts.Create(&Tunnel{ID: "tun_rot", PublicKey: "pkrot", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})

	autoRotate := true
	interval := 90
	updated, err := ts.UpdateRotationPolicy("tun_rot", &autoRotate, &interval, nil, nil, nil)
	if err != nil {
		t.Fatalf("update rotation policy: %v", err)
	}
	if !updated.AutoRotatePSK {
		t.Error("expected auto_rotate_psk=true")
	}
	if updated.PSKRotationIntervalDays != 90 {
		t.Errorf("expected 90 days, got %d", updated.PSKRotationIntervalDays)
	}
}

func TestTunnelUpdatePeerStats(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)

	ts.Create(&Tunnel{ID: "tun_stats", PublicKey: "pkstats", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})

	hs := time.Now()
	err := ts.UpdatePeerStats("pkstats", &hs, 1000, 2000)
	if err != nil {
		t.Fatalf("update peer stats: %v", err)
	}

	got, _ := ts.Get("tun_stats")
	if got.RxBytes != 1000 {
		t.Errorf("expected rx_bytes 1000, got %d", got.RxBytes)
	}
	if got.TxBytes != 2000 {
		t.Errorf("expected tx_bytes 2000, got %d", got.TxBytes)
	}
}

func TestAllocateIP(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)

	// First allocation should be .2
	ip, err := ts.AllocateIP("10.0.0.1", "10.0.0")
	if err != nil {
		t.Fatalf("allocate ip: %v", err)
	}
	if ip != "10.0.0.2" {
		t.Errorf("expected 10.0.0.2, got %s", ip)
	}

	// Create a peer with .2, next should be .3
	ts.Create(&Tunnel{ID: "tun_ip1", PublicKey: "pk_ip1", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})
	ip, err = ts.AllocateIP("10.0.0.1", "10.0.0")
	if err != nil {
		t.Fatalf("allocate ip: %v", err)
	}
	if ip != "10.0.0.3" {
		t.Errorf("expected 10.0.0.3, got %s", ip)
	}
}

func TestSetAndClearPendingRotation(t *testing.T) {
	db := setupTestDB(t)
	ts := NewTunnelStore(db)

	ts.Create(&Tunnel{ID: "tun_pr", PublicKey: "pkpr", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})

	err := ts.SetPendingRotation("tun_pr", "tun_pr_new")
	if err != nil {
		t.Fatalf("set pending rotation: %v", err)
	}

	got, _ := ts.Get("tun_pr")
	if got.PendingRotationID != "tun_pr_new" {
		t.Errorf("expected pending_rotation_id tun_pr_new, got %s", got.PendingRotationID)
	}
	if got.LastRotationAt == nil {
		t.Error("expected last_rotation_at to be set")
	}

	err = ts.ClearPendingRotation("tun_pr")
	if err != nil {
		t.Fatalf("clear pending rotation: %v", err)
	}
	got, _ = ts.Get("tun_pr")
	if got.PendingRotationID != "" {
		t.Errorf("expected empty pending_rotation_id, got %s", got.PendingRotationID)
	}
}
