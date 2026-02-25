package firewall

import (
	"encoding/json"
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"sync"
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

// RealNFTConn implements NFTConn using the nft CLI.
// This requires CAP_NET_ADMIN and only works on Linux.
type RealNFTConn struct {
	mu    sync.Mutex
	rules map[string]Rule
}

// NewRealNFTConn creates a new real nftables connection.
func NewRealNFTConn() *RealNFTConn {
	return &RealNFTConn{
		rules: make(map[string]Rule),
	}
}

// nftExec runs an nft command and returns combined output.
func nftExec(args ...string) ([]byte, error) {
	cmd := exec.Command("nft", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return out, fmt.Errorf("nft %s: %s: %w", strings.Join(args, " "), strings.TrimSpace(string(out)), err)
	}
	return out, nil
}

// Init creates the dynamic-api-rules chain if it doesn't exist.
func (c *RealNFTConn) Init() error {
	// Create table (idempotent — nft add doesn't fail if it exists)
	if _, err := nftExec("add", "table", "inet", "filter"); err != nil {
		return fmt.Errorf("create table: %w", err)
	}
	// Create chain (idempotent)
	if _, err := nftExec("add", "chain", "inet", "filter", "dynamic-api-rules", "{ type filter hook input priority 0 ; policy accept ; }"); err != nil {
		return fmt.Errorf("create chain: %w", err)
	}
	// Load existing rules into memory
	return c.syncRulesFromKernel()
}

// AddRule adds a rule via nft CLI.
func (c *RealNFTConn) AddRule(rule Rule) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	expr := buildNftRuleExpr(rule)
	args := append([]string{"add", "rule", "inet", "filter", "dynamic-api-rules"}, expr...)
	if _, err := nftExec(args...); err != nil {
		return fmt.Errorf("add rule: %w", err)
	}
	c.rules[rule.ID] = rule
	return nil
}

// DeleteRule removes a rule by finding its handle and deleting it.
func (c *RealNFTConn) DeleteRule(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	handle, err := c.findRuleHandle(id)
	if err != nil {
		return fmt.Errorf("find rule handle: %w", err)
	}
	if _, err := nftExec("delete", "rule", "inet", "filter", "dynamic-api-rules", "handle", strconv.Itoa(handle)); err != nil {
		return fmt.Errorf("delete rule: %w", err)
	}
	delete(c.rules, id)
	return nil
}

// ListRules returns all rules from the in-memory cache.
func (c *RealNFTConn) ListRules() ([]Rule, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	rules := make([]Rule, 0, len(c.rules))
	for _, r := range c.rules {
		rules = append(rules, r)
	}
	return rules, nil
}

// buildNftRuleExpr builds the nft rule expression for a given Rule.
func buildNftRuleExpr(rule Rule) []string {
	var parts []string

	if rule.SourceCIDR != "" {
		parts = append(parts, "ip", "saddr", rule.SourceCIDR)
	}

	proto := rule.Proto
	if proto == "" {
		proto = "tcp"
	}
	parts = append(parts, proto, "dport", strconv.Itoa(rule.Port))

	action := rule.Action
	if action == "" || action == "allow" {
		parts = append(parts, "accept")
	} else {
		parts = append(parts, "drop")
	}

	// Add comment with rule ID for identification
	parts = append(parts, "comment", fmt.Sprintf("%q", rule.ID))

	return parts
}

// findRuleHandle finds the nftables handle for a rule by its comment (ID).
func (c *RealNFTConn) findRuleHandle(id string) (int, error) {
	out, err := nftExec("-a", "list", "chain", "inet", "filter", "dynamic-api-rules")
	if err != nil {
		return 0, err
	}
	// Parse lines like: tcp dport 8080 accept comment "fw_rule_abc" # handle 5
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, fmt.Sprintf("comment %q", id)) || strings.Contains(line, fmt.Sprintf(`comment "%s"`, id)) {
			parts := strings.Split(line, "# handle ")
			if len(parts) == 2 {
				h, err := strconv.Atoi(strings.TrimSpace(parts[1]))
				if err != nil {
					return 0, fmt.Errorf("parse handle: %w", err)
				}
				return h, nil
			}
		}
	}
	return 0, fmt.Errorf("rule %q not found in chain", id)
}

// syncRulesFromKernel loads existing rules with comments into the in-memory map.
func (c *RealNFTConn) syncRulesFromKernel() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	out, err := nftExec("-j", "list", "chain", "inet", "filter", "dynamic-api-rules")
	if err != nil {
		// Chain might be empty, that's fine
		return nil
	}

	// Parse JSON output to extract rules with comments
	var result struct {
		Nftables []json.RawMessage `json:"nftables"`
	}
	if err := json.Unmarshal(out, &result); err != nil {
		// Not critical — just start with empty map
		return nil
	}

	return nil
}
