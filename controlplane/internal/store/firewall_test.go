package store

import (
	"testing"
)

func TestFirewallRuleCRUD(t *testing.T) {
	db := setupTestDB(t)
	fs := NewFirewallStore(db)

	rule := &FirewallRule{
		ID:         "fw_001",
		Port:       8080,
		Proto:      "tcp",
		Direction:  "in",
		SourceCIDR: "0.0.0.0/0",
		Action:     "allow",
		Enabled:    true,
	}

	// Create
	if err := fs.Create(rule); err != nil {
		t.Fatalf("create firewall rule: %v", err)
	}

	// Get
	got, err := fs.Get("fw_001")
	if err != nil {
		t.Fatalf("get firewall rule: %v", err)
	}
	if got.Port != 8080 {
		t.Errorf("expected port 8080, got %d", got.Port)
	}
	if got.Proto != "tcp" {
		t.Errorf("expected proto tcp, got %s", got.Proto)
	}
	if got.SourceCIDR != "0.0.0.0/0" {
		t.Errorf("expected source_cidr 0.0.0.0/0, got %s", got.SourceCIDR)
	}
	if got.Action != "allow" {
		t.Errorf("expected action allow, got %s", got.Action)
	}

	// List
	all, err := fs.List()
	if err != nil {
		t.Fatalf("list firewall rules: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(all))
	}

	// Delete
	if err := fs.Delete("fw_001"); err != nil {
		t.Fatalf("delete firewall rule: %v", err)
	}
	all, _ = fs.List()
	if len(all) != 0 {
		t.Errorf("expected 0 rules after delete, got %d", len(all))
	}
}

func TestFirewallRuleDeleteNotFound(t *testing.T) {
	db := setupTestDB(t)
	fs := NewFirewallStore(db)

	err := fs.Delete("nonexistent")
	if err == nil {
		t.Fatal("expected error deleting nonexistent rule")
	}
}

func TestFirewallRuleListEnabled(t *testing.T) {
	db := setupTestDB(t)
	fs := NewFirewallStore(db)

	fs.Create(&FirewallRule{ID: "fw_e1", Port: 8080, Proto: "tcp", Direction: "in", SourceCIDR: "0.0.0.0/0", Action: "allow", Enabled: true})
	fs.Create(&FirewallRule{ID: "fw_e2", Port: 9090, Proto: "udp", Direction: "in", SourceCIDR: "0.0.0.0/0", Action: "allow", Enabled: false})

	enabled, err := fs.ListEnabled()
	if err != nil {
		t.Fatalf("list enabled: %v", err)
	}
	if len(enabled) != 1 {
		t.Fatalf("expected 1 enabled rule, got %d", len(enabled))
	}
	if enabled[0].ID != "fw_e1" {
		t.Errorf("expected fw_e1, got %s", enabled[0].ID)
	}
}

func TestReconciliationState(t *testing.T) {
	db := setupTestDB(t)
	fs := NewFirewallStore(db)

	// Read initial state
	state, err := fs.GetReconciliationState()
	if err != nil {
		t.Fatalf("get reconciliation state: %v", err)
	}
	if state.LastStatus != "pending" {
		t.Errorf("expected pending, got %s", state.LastStatus)
	}
	if state.DriftCorrections != 0 {
		t.Errorf("expected 0 corrections, got %d", state.DriftCorrections)
	}

	// Update
	err = fs.UpdateReconciliationState("ok", nil, 0)
	if err != nil {
		t.Fatalf("update state: %v", err)
	}

	state, _ = fs.GetReconciliationState()
	if state.LastStatus != "ok" {
		t.Errorf("expected ok, got %s", state.LastStatus)
	}
	if state.LastRunAt == nil {
		t.Error("expected last_run_at to be set")
	}

	// Update with error
	errMsg := "caddy socket down"
	err = fs.UpdateReconciliationState("error", &errMsg, 3)
	if err != nil {
		t.Fatalf("update state with error: %v", err)
	}

	state, _ = fs.GetReconciliationState()
	if state.LastStatus != "error" {
		t.Errorf("expected error, got %s", state.LastStatus)
	}
	if state.LastError != "caddy socket down" {
		t.Errorf("expected 'caddy socket down', got %q", state.LastError)
	}
	if state.DriftCorrections != 3 {
		t.Errorf("expected 3 drift corrections, got %d", state.DriftCorrections)
	}
}

func TestAuditLog(t *testing.T) {
	db := setupTestDB(t)
	fs := NewFirewallStore(db)

	err := fs.WriteAuditLog("admin", "127.0.0.1", "POST", "/api/v1/tunnels", "abc123", "ok", "")
	if err != nil {
		t.Fatalf("write audit log: %v", err)
	}

	err = fs.WriteAuditLog("admin", "127.0.0.1", "DELETE", "/api/v1/tunnels/tun_1", "", "error", "not found")
	if err != nil {
		t.Fatalf("write audit log with error: %v", err)
	}

	// Verify via direct query
	var count int
	err = db.Conn().QueryRow(`SELECT COUNT(*) FROM audit_log`).Scan(&count)
	if err != nil {
		t.Fatalf("count audit log: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 audit log entries, got %d", count)
	}
}
