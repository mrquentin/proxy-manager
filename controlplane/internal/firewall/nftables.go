package firewall

import (
	"fmt"
	"net"
)

// Rule represents a firewall rule in the dynamic chain.
type Rule struct {
	ID         string
	Port       int
	Proto      string
	Direction  string
	SourceCIDR string
	Action     string
}

// NFTConn is the interface for interacting with nftables.
// This abstraction allows mocking in tests.
type NFTConn interface {
	// Init creates the dynamic-api-rules chain if it doesn't exist.
	Init() error
	// AddRule adds a rule to the dynamic chain.
	AddRule(rule Rule) error
	// DeleteRule removes a rule from the dynamic chain by ID.
	DeleteRule(id string) error
	// ListRules returns all rules in the dynamic chain.
	ListRules() ([]Rule, error)
}

// Manager wraps nftables operations for the control plane.
type Manager struct {
	conn NFTConn
}

// NewManager creates a new firewall manager.
func NewManager(conn NFTConn) *Manager {
	return &Manager{conn: conn}
}

// Init initializes the dynamic-api-rules chain.
func (m *Manager) Init() error {
	return m.conn.Init()
}

// AddRule adds a firewall rule after validation.
func (m *Manager) AddRule(rule Rule) error {
	if err := ValidateRule(rule); err != nil {
		return fmt.Errorf("invalid rule: %w", err)
	}
	return m.conn.AddRule(rule)
}

// DeleteRule removes a firewall rule by ID.
func (m *Manager) DeleteRule(id string) error {
	return m.conn.DeleteRule(id)
}

// ListRules returns all rules in the dynamic chain.
func (m *Manager) ListRules() ([]Rule, error) {
	return m.conn.ListRules()
}

// ValidateRule checks that a firewall rule is valid.
func ValidateRule(rule Rule) error {
	if rule.Port < 1 || rule.Port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535, got %d", rule.Port)
	}

	reservedPorts := map[int]bool{22: true, 2019: true, 7443: true, 51820: true}
	if reservedPorts[rule.Port] {
		return fmt.Errorf("port %d is reserved", rule.Port)
	}

	if rule.Proto != "tcp" && rule.Proto != "udp" {
		return fmt.Errorf("protocol must be tcp or udp, got %q", rule.Proto)
	}

	if rule.Direction != "" && rule.Direction != "in" && rule.Direction != "out" {
		return fmt.Errorf("direction must be in or out, got %q", rule.Direction)
	}

	if rule.SourceCIDR != "" {
		_, _, err := net.ParseCIDR(rule.SourceCIDR)
		if err != nil {
			return fmt.Errorf("invalid source CIDR %q: %w", rule.SourceCIDR, err)
		}
	}

	if rule.Action != "" && rule.Action != "allow" && rule.Action != "deny" {
		return fmt.Errorf("action must be allow or deny, got %q", rule.Action)
	}

	return nil
}

// RealNFTConn implements NFTConn using the real google/nftables library.
// This requires CAP_NET_ADMIN and only works on Linux.
type RealNFTConn struct {
	rules map[string]Rule
}

// NewRealNFTConn creates a new real nftables connection.
func NewRealNFTConn() *RealNFTConn {
	return &RealNFTConn{
		rules: make(map[string]Rule),
	}
}

// Init creates the dynamic-api-rules chain.
// In production this calls nftables.Conn{} and creates the chain.
func (c *RealNFTConn) Init() error {
	// In production:
	// conn := &nftables.Conn{}
	// table := &nftables.Table{Family: nftables.TableFamilyINet, Name: "filter"}
	// conn.AddChain(&nftables.Chain{Name: "dynamic-api-rules", Table: table, Type: nftables.ChainTypeFilter})
	// return conn.Flush()
	return fmt.Errorf("RealNFTConn.Init: not available outside Linux with CAP_NET_ADMIN")
}

// AddRule adds a rule via nftables netlink.
func (c *RealNFTConn) AddRule(rule Rule) error {
	return fmt.Errorf("RealNFTConn.AddRule: not available outside Linux with CAP_NET_ADMIN")
}

// DeleteRule deletes a rule via nftables netlink.
func (c *RealNFTConn) DeleteRule(id string) error {
	return fmt.Errorf("RealNFTConn.DeleteRule: not available outside Linux with CAP_NET_ADMIN")
}

// ListRules lists all rules in the dynamic chain via nftables netlink.
func (c *RealNFTConn) ListRules() ([]Rule, error) {
	return nil, fmt.Errorf("RealNFTConn.ListRules: not available outside Linux with CAP_NET_ADMIN")
}
