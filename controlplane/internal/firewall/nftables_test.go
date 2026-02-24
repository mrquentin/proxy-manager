package firewall

import (
	"fmt"
	"strings"
	"testing"
)

// MockNFTConn implements NFTConn for testing.
type MockNFTConn struct {
	rules      map[string]Rule
	initialized bool
	initErr    error
	addErr     error
	deleteErr  error
	listErr    error
}

func NewMockNFTConn() *MockNFTConn {
	return &MockNFTConn{
		rules: make(map[string]Rule),
	}
}

func (m *MockNFTConn) Init() error {
	if m.initErr != nil {
		return m.initErr
	}
	m.initialized = true
	return nil
}

func (m *MockNFTConn) AddRule(rule Rule) error {
	if m.addErr != nil {
		return m.addErr
	}
	m.rules[rule.ID] = rule
	return nil
}

func (m *MockNFTConn) DeleteRule(id string) error {
	if m.deleteErr != nil {
		return m.deleteErr
	}
	if _, ok := m.rules[id]; !ok {
		return fmt.Errorf("rule not found: %s", id)
	}
	delete(m.rules, id)
	return nil
}

func (m *MockNFTConn) ListRules() ([]Rule, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	var rules []Rule
	for _, r := range m.rules {
		rules = append(rules, r)
	}
	return rules, nil
}

func TestManagerInit(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	err := mgr.Init()
	if err != nil {
		t.Fatalf("init: %v", err)
	}
	if !mock.initialized {
		t.Error("expected initialized=true")
	}
}

func TestManagerInitError(t *testing.T) {
	mock := NewMockNFTConn()
	mock.initErr = fmt.Errorf("netlink error")
	mgr := NewManager(mock)

	err := mgr.Init()
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestManagerAddRule(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	rule := Rule{
		ID:         "fw_001",
		Port:       8080,
		Proto:      "tcp",
		Direction:  "in",
		SourceCIDR: "0.0.0.0/0",
		Action:     "allow",
	}

	err := mgr.AddRule(rule)
	if err != nil {
		t.Fatalf("add rule: %v", err)
	}

	if len(mock.rules) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(mock.rules))
	}
}

func TestManagerAddRuleInvalidPort(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	rule := Rule{ID: "fw_bad", Port: 0, Proto: "tcp", SourceCIDR: "0.0.0.0/0", Action: "allow"}
	err := mgr.AddRule(rule)
	if err == nil {
		t.Fatal("expected error for port 0")
	}
}

func TestManagerAddRuleReservedPort(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	for _, port := range []int{22, 2019, 7443, 51820} {
		rule := Rule{ID: "fw_res", Port: port, Proto: "tcp", SourceCIDR: "0.0.0.0/0", Action: "allow"}
		err := mgr.AddRule(rule)
		if err == nil {
			t.Fatalf("expected error for reserved port %d", port)
		}
		if !strings.Contains(err.Error(), "reserved") {
			t.Errorf("expected reserved error, got %v", err)
		}
	}
}

func TestManagerAddRuleInvalidProto(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	rule := Rule{ID: "fw_bad", Port: 8080, Proto: "icmp", SourceCIDR: "0.0.0.0/0", Action: "allow"}
	err := mgr.AddRule(rule)
	if err == nil {
		t.Fatal("expected error for invalid protocol")
	}
}

func TestManagerAddRuleInvalidCIDR(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	rule := Rule{ID: "fw_bad", Port: 8080, Proto: "tcp", SourceCIDR: "not-a-cidr", Action: "allow"}
	err := mgr.AddRule(rule)
	if err == nil {
		t.Fatal("expected error for invalid CIDR")
	}
}

func TestManagerAddRuleInvalidAction(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	rule := Rule{ID: "fw_bad", Port: 8080, Proto: "tcp", SourceCIDR: "0.0.0.0/0", Action: "reject"}
	err := mgr.AddRule(rule)
	if err == nil {
		t.Fatal("expected error for invalid action")
	}
}

func TestManagerDeleteRule(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	mock.rules["fw_001"] = Rule{ID: "fw_001", Port: 8080, Proto: "tcp"}

	err := mgr.DeleteRule("fw_001")
	if err != nil {
		t.Fatalf("delete rule: %v", err)
	}
	if len(mock.rules) != 0 {
		t.Errorf("expected 0 rules, got %d", len(mock.rules))
	}
}

func TestManagerDeleteRuleNotFound(t *testing.T) {
	mock := NewMockNFTConn()
	mgr := NewManager(mock)

	err := mgr.DeleteRule("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent rule")
	}
}

func TestManagerListRules(t *testing.T) {
	mock := NewMockNFTConn()
	mock.rules["fw_001"] = Rule{ID: "fw_001", Port: 8080, Proto: "tcp"}
	mock.rules["fw_002"] = Rule{ID: "fw_002", Port: 9090, Proto: "udp"}

	mgr := NewManager(mock)

	rules, err := mgr.ListRules()
	if err != nil {
		t.Fatalf("list rules: %v", err)
	}
	if len(rules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(rules))
	}
}

func TestManagerListRulesError(t *testing.T) {
	mock := NewMockNFTConn()
	mock.listErr = fmt.Errorf("netlink error")
	mgr := NewManager(mock)

	_, err := mgr.ListRules()
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestValidateRule(t *testing.T) {
	tests := []struct {
		name    string
		rule    Rule
		wantErr bool
	}{
		{"valid", Rule{Port: 8080, Proto: "tcp", SourceCIDR: "0.0.0.0/0", Action: "allow"}, false},
		{"valid udp", Rule{Port: 5000, Proto: "udp", SourceCIDR: "10.0.0.0/8", Action: "deny"}, false},
		{"port too low", Rule{Port: 0, Proto: "tcp"}, true},
		{"port too high", Rule{Port: 70000, Proto: "tcp"}, true},
		{"reserved 22", Rule{Port: 22, Proto: "tcp"}, true},
		{"reserved 2019", Rule{Port: 2019, Proto: "tcp"}, true},
		{"reserved 7443", Rule{Port: 7443, Proto: "tcp"}, true},
		{"reserved 51820", Rule{Port: 51820, Proto: "udp"}, true},
		{"bad proto", Rule{Port: 8080, Proto: "icmp"}, true},
		{"bad cidr", Rule{Port: 8080, Proto: "tcp", SourceCIDR: "bad"}, true},
		{"bad action", Rule{Port: 8080, Proto: "tcp", Action: "reject"}, true},
		{"bad direction", Rule{Port: 8080, Proto: "tcp", Direction: "both"}, true},
		{"empty cidr ok", Rule{Port: 8080, Proto: "tcp", SourceCIDR: ""}, false},
		{"empty action ok", Rule{Port: 8080, Proto: "tcp", Action: ""}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateRule(tt.rule)
			if tt.wantErr && err == nil {
				t.Error("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
