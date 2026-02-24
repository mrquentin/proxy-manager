package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/proxy-manager/controlplane/internal/caddy"
	"github.com/proxy-manager/controlplane/internal/config"
	"github.com/proxy-manager/controlplane/internal/firewall"
	"github.com/proxy-manager/controlplane/internal/store"
	"github.com/proxy-manager/controlplane/internal/wireguard"
)

// --- Mock implementations ---

type mockCaddyClient struct {
	routes  []caddy.CaddyRoute
	addErr  error
	delErr  error
	getErr  error
}

func (m *mockCaddyClient) GetL4Config(ctx context.Context) (*caddy.L4Config, error) {
	if m.getErr != nil {
		return nil, m.getErr
	}
	return &caddy.L4Config{Servers: map[string]*caddy.L4Server{}}, nil
}

func (m *mockCaddyClient) AddRoute(ctx context.Context, route caddy.CaddyRoute) error {
	if m.addErr != nil {
		return m.addErr
	}
	m.routes = append(m.routes, route)
	return nil
}

func (m *mockCaddyClient) DeleteRoute(ctx context.Context, caddyID string) error {
	return m.delErr
}

func (m *mockCaddyClient) CreateServer(ctx context.Context) error {
	return nil
}

type mockWGClient struct {
	peers     map[string]wireguard.PeerInfo
	publicKey string
}

func newMockWGClient() *mockWGClient {
	return &mockWGClient{
		peers:     make(map[string]wireguard.PeerInfo),
		publicKey: "c2VydmVyLXB1Yi1rZXktMzItYnl0ZXMtaGVyZQ==",
	}
}

func (m *mockWGClient) AddPeer(iface string, pubkey, psk, vpnIP string) error {
	m.peers[pubkey] = wireguard.PeerInfo{PublicKey: pubkey, AllowedIPs: []string{vpnIP + "/32"}}
	return nil
}

func (m *mockWGClient) RemovePeer(iface string, pubkey string) error {
	delete(m.peers, pubkey)
	return nil
}

func (m *mockWGClient) GetDevice(iface string) (*wireguard.DeviceInfo, error) {
	var peers []wireguard.PeerInfo
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	return &wireguard.DeviceInfo{PublicKey: m.publicKey, ListenPort: 51820, Peers: peers}, nil
}

type mockNFTConn struct {
	rules map[string]firewall.Rule
}

func newMockNFTConn() *mockNFTConn {
	return &mockNFTConn{rules: make(map[string]firewall.Rule)}
}

func (m *mockNFTConn) Init() error { return nil }

func (m *mockNFTConn) AddRule(rule firewall.Rule) error {
	m.rules[rule.ID] = rule
	return nil
}

func (m *mockNFTConn) DeleteRule(id string) error {
	delete(m.rules, id)
	return nil
}

func (m *mockNFTConn) ListRules() ([]firewall.Rule, error) {
	var rules []firewall.Rule
	for _, r := range m.rules {
		rules = append(rules, r)
	}
	return rules, nil
}

// --- Test setup ---

func setupTestServer(t *testing.T) (*Server, *store.DB) {
	t.Helper()

	db, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("create test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	cfg := &config.Config{
		ListenAddr:     ":7443",
		WGInterface:    "wg0",
		WGSubnet:       "10.0.0.0/24",
		WGServerIP:     "10.0.0.1",
		ServerEndpoint: "203.0.113.1:51820",
	}

	tunnelStore := store.NewTunnelStore(db)
	routeStore := store.NewRouteStore(db)
	fwStore := store.NewFirewallStore(db)

	mockWG := newMockWGClient()
	wgMgr := wireguard.NewManager("wg0", mockWG)

	mockNFT := newMockNFTConn()
	fwMgr := firewall.NewManager(mockNFT)

	mockCaddy := &mockCaddyClient{}

	srv := NewServer(cfg, tunnelStore, routeStore, fwStore, mockCaddy, wgMgr, fwMgr, nil)
	return srv, db
}

func doRequest(srv *Server, method, path string, body interface{}) *httptest.ResponseRecorder {
	var bodyReader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	srv.mux.ServeHTTP(rr, req)
	return rr
}

func parseJSON(t *testing.T, rr *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var result map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to parse JSON response: %v\nbody: %s", err, rr.Body.String())
	}
	return result
}

// --- Health endpoint tests ---

func TestHealthEndpoint(t *testing.T) {
	srv, _ := setupTestServer(t)
	rr := doRequest(srv, "GET", "/api/v1/health", nil)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	body := parseJSON(t, rr)
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %v", body["status"])
	}
}

// --- Server pubkey tests ---

func TestGetServerPubkey(t *testing.T) {
	srv, _ := setupTestServer(t)
	rr := doRequest(srv, "GET", "/api/v1/server/pubkey", nil)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	body := parseJSON(t, rr)
	if body["public_key"] == nil || body["public_key"] == "" {
		t.Error("expected non-empty public key")
	}
}

// --- Tunnel endpoint tests ---

func TestCreateTunnelFlowA(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains":       []string{"app.example.com"},
		"upstream_port": 443,
	})

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	body := parseJSON(t, rr)
	if body["id"] == nil || body["id"] == "" {
		t.Error("expected tunnel id")
	}
	if body["vpn_ip"] == nil {
		t.Error("expected vpn_ip")
	}
	if body["config"] == nil || body["config"] == "" {
		t.Error("expected config in Flow A response")
	}
	if body["server_public_key"] == nil {
		t.Error("expected server_public_key")
	}
	if body["warning"] == nil {
		t.Error("expected warning")
	}
}

func TestCreateTunnelFlowB(t *testing.T) {
	srv, _ := setupTestServer(t)

	// Valid 32-byte key in base64
	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"public_key":    "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=",
		"domains":       []string{"app.example.com"},
		"upstream_port": 443,
	})

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	body := parseJSON(t, rr)
	if body["preshared_key"] == nil {
		t.Error("expected preshared_key in Flow B response")
	}
	if body["config"] != nil {
		t.Error("did not expect config in Flow B response")
	}
}

func TestCreateTunnelInvalidPubkey(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"public_key": "not-valid-base64!!!",
	})

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateTunnelInvalidDomain(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains": []string{"invalid domain with spaces"},
	})

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateTunnelReservedPort(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"upstream_port": 22,
	})

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestListTunnels(t *testing.T) {
	srv, _ := setupTestServer(t)

	// Create a tunnel first
	doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains":       []string{"a.com"},
		"upstream_port": 443,
	})

	rr := doRequest(srv, "GET", "/api/v1/tunnels", nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	body := parseJSON(t, rr)
	data, ok := body["data"].([]interface{})
	if !ok {
		t.Fatal("expected data array")
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 tunnel, got %d", len(data))
	}
}

func TestDeleteTunnel(t *testing.T) {
	srv, _ := setupTestServer(t)

	// Create
	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains":       []string{"a.com"},
		"upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	// Delete
	rr = doRequest(srv, "DELETE", "/api/v1/tunnels/"+tunnelID, nil)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify gone
	rr = doRequest(srv, "GET", "/api/v1/tunnels", nil)
	body = parseJSON(t, rr)
	data := body["data"].([]interface{})
	if len(data) != 0 {
		t.Errorf("expected 0 tunnels after delete, got %d", len(data))
	}
}

func TestDeleteTunnelNotFound(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "DELETE", "/api/v1/tunnels/nonexistent", nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestGetTunnelConfig(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains": []string{"a.com"}, "upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "GET", fmt.Sprintf("/api/v1/tunnels/%s/config", tunnelID), nil)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if rr.Header().Get("Content-Type") != "text/plain" {
		t.Errorf("expected text/plain, got %s", rr.Header().Get("Content-Type"))
	}
}

func TestGetTunnelConfigNotFound(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "GET", "/api/v1/tunnels/nonexistent/config", nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestGetTunnelQR(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains": []string{"a.com"}, "upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "GET", fmt.Sprintf("/api/v1/tunnels/%s/qr", tunnelID), nil)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if rr.Header().Get("Content-Type") != "image/png" {
		t.Errorf("expected image/png, got %s", rr.Header().Get("Content-Type"))
	}
	if rr.Body.Len() == 0 {
		t.Error("expected non-empty QR code PNG")
	}
}

func TestRotateTunnel(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains": []string{"a.com"}, "upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "POST", fmt.Sprintf("/api/v1/tunnels/%s/rotate", tunnelID), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	body = parseJSON(t, rr)
	if body["config"] == nil {
		t.Error("expected config in rotation response")
	}
	if body["grace_period_minutes"] == nil {
		t.Error("expected grace_period_minutes")
	}
	if body["warning"] == nil {
		t.Error("expected warning")
	}
}

func TestRotateTunnelNotFound(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels/nonexistent/rotate", nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestUpdateRotationPolicy(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains": []string{"a.com"}, "upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "PATCH", fmt.Sprintf("/api/v1/tunnels/%s/rotation-policy", tunnelID), map[string]interface{}{
		"auto_rotate_psk":            true,
		"psk_rotation_interval_days": 90,
		"grace_period_minutes":       60,
	})

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	body = parseJSON(t, rr)
	if body["auto_rotate_psk"] != true {
		t.Error("expected auto_rotate_psk=true")
	}
	if body["psk_rotation_interval_days"] != float64(90) {
		t.Errorf("expected 90, got %v", body["psk_rotation_interval_days"])
	}
}

func TestUpdateRotationPolicyInvalid(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains": []string{"a.com"}, "upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	// Negative interval
	rr = doRequest(srv, "PATCH", fmt.Sprintf("/api/v1/tunnels/%s/rotation-policy", tunnelID), map[string]interface{}{
		"psk_rotation_interval_days": -1,
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}

	// Zero expiry days
	rr = doRequest(srv, "PATCH", fmt.Sprintf("/api/v1/tunnels/%s/rotation-policy", tunnelID), map[string]interface{}{
		"inactive_expiry_days": 0,
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestGetRotationPolicy(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains": []string{"a.com"}, "upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "GET", fmt.Sprintf("/api/v1/tunnels/%s/rotation-policy", tunnelID), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	body = parseJSON(t, rr)
	if body["tunnel_id"] != tunnelID {
		t.Errorf("expected tunnel_id %s, got %v", tunnelID, body["tunnel_id"])
	}
}

func TestGetRotationPolicyNotFound(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "GET", "/api/v1/tunnels/nonexistent/rotation-policy", nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

// --- Route endpoint tests ---

func TestCreateRoute(t *testing.T) {
	srv, _ := setupTestServer(t)

	// Create a tunnel first
	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "POST", "/api/v1/routes", map[string]interface{}{
		"tunnel_id":     tunnelID,
		"match_type":    "sni",
		"match_value":   []string{"new.example.com"},
		"upstream_port": 8080,
	})

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	body = parseJSON(t, rr)
	data := body["data"].(map[string]interface{})
	if data["tunnel_id"] != tunnelID {
		t.Errorf("expected tunnel_id %s, got %v", tunnelID, data["tunnel_id"])
	}
	if data["upstream"] == nil {
		t.Error("expected upstream")
	}
}

func TestCreateRouteInvalidTunnel(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/routes", map[string]interface{}{
		"tunnel_id":     "nonexistent",
		"match_type":    "sni",
		"match_value":   []string{"a.com"},
		"upstream_port": 443,
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateRouteInvalidMatchType(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{"upstream_port": 443})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "POST", "/api/v1/routes", map[string]interface{}{
		"tunnel_id":     tunnelID,
		"match_type":    "invalid",
		"match_value":   []string{"a.com"},
		"upstream_port": 443,
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateRouteEmptyMatchValue(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{"upstream_port": 443})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "POST", "/api/v1/routes", map[string]interface{}{
		"tunnel_id":     tunnelID,
		"match_type":    "sni",
		"match_value":   []string{},
		"upstream_port": 443,
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateRouteReservedPort(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{"upstream_port": 443})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "POST", "/api/v1/routes", map[string]interface{}{
		"tunnel_id":     tunnelID,
		"match_type":    "sni",
		"match_value":   []string{"a.com"},
		"upstream_port": 22,
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestListRoutes(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "GET", "/api/v1/routes", nil)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	body := parseJSON(t, rr)
	data := body["data"].([]interface{})
	if len(data) != 0 {
		t.Errorf("expected 0 routes, got %d", len(data))
	}
}

func TestDeleteRoute(t *testing.T) {
	srv, _ := setupTestServer(t)

	// Create tunnel + route
	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{
		"domains": []string{"a.com"}, "upstream_port": 443,
	})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "POST", "/api/v1/routes", map[string]interface{}{
		"tunnel_id": tunnelID, "match_type": "sni", "match_value": []string{"b.com"}, "upstream_port": 8080,
	})
	body = parseJSON(t, rr)
	routeID := body["data"].(map[string]interface{})["id"].(string)

	rr = doRequest(srv, "DELETE", "/api/v1/routes/"+routeID, nil)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rr.Code)
	}
}

func TestDeleteRouteNotFound(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "DELETE", "/api/v1/routes/nonexistent", nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

// --- Firewall endpoint tests ---

func TestCreateFirewallRule(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
		"port":        8080,
		"proto":       "tcp",
		"source_cidr": "0.0.0.0/0",
		"action":      "allow",
	})

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	body := parseJSON(t, rr)
	data := body["data"].(map[string]interface{})
	if data["port"] != float64(8080) {
		t.Errorf("expected port 8080, got %v", data["port"])
	}
	if data["proto"] != "tcp" {
		t.Errorf("expected proto tcp, got %v", data["proto"])
	}
}

func TestCreateFirewallRuleDefaults(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
		"port":  8080,
		"proto": "tcp",
	})

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	body := parseJSON(t, rr)
	data := body["data"].(map[string]interface{})
	if data["source_cidr"] != "0.0.0.0/0" {
		t.Errorf("expected default source_cidr 0.0.0.0/0, got %v", data["source_cidr"])
	}
	if data["action"] != "allow" {
		t.Errorf("expected default action allow, got %v", data["action"])
	}
}

func TestCreateFirewallRuleInvalidPort(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
		"port": 0, "proto": "tcp",
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}

	rr = doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
		"port": 70000, "proto": "tcp",
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for port 70000, got %d", rr.Code)
	}
}

func TestCreateFirewallRuleReservedPort(t *testing.T) {
	srv, _ := setupTestServer(t)

	for _, port := range []int{22, 2019, 7443, 51820} {
		rr := doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
			"port": port, "proto": "tcp",
		})
		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for reserved port %d, got %d", port, rr.Code)
		}
	}
}

func TestCreateFirewallRuleInvalidProto(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
		"port": 8080, "proto": "icmp",
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateFirewallRuleInvalidCIDR(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
		"port": 8080, "proto": "tcp", "source_cidr": "not-a-cidr",
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateFirewallRuleInvalidAction(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
		"port": 8080, "proto": "tcp", "action": "reject",
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestListFirewallRules(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "GET", "/api/v1/firewall/rules", nil)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	body := parseJSON(t, rr)
	data := body["data"].([]interface{})
	if len(data) != 0 {
		t.Errorf("expected 0 rules, got %d", len(data))
	}
}

func TestDeleteFirewallRule(t *testing.T) {
	srv, _ := setupTestServer(t)

	// Create
	rr := doRequest(srv, "POST", "/api/v1/firewall/rules", map[string]interface{}{
		"port": 8080, "proto": "tcp",
	})
	body := parseJSON(t, rr)
	ruleID := body["data"].(map[string]interface{})["id"].(string)

	// Delete
	rr = doRequest(srv, "DELETE", "/api/v1/firewall/rules/"+ruleID, nil)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rr.Code)
	}
}

func TestDeleteFirewallRuleNotFound(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "DELETE", "/api/v1/firewall/rules/nonexistent", nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

// --- Status endpoint tests ---

func TestStatusEndpoint(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "GET", "/api/v1/status", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	body := parseJSON(t, rr)
	if body["tunnels"] == nil {
		t.Error("expected tunnels in status")
	}
	if body["routes"] == nil {
		t.Error("expected routes in status")
	}
	if body["firewall"] == nil {
		t.Error("expected firewall in status")
	}
	if body["reconciliation"] == nil {
		t.Error("expected reconciliation in status")
	}

	recon := body["reconciliation"].(map[string]interface{})
	if recon["last_status"] != "pending" {
		t.Errorf("expected pending status, got %v", recon["last_status"])
	}
}

// --- Force reconcile tests ---

func TestForceReconcile(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/reconcile", nil)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	body := parseJSON(t, rr)
	if body["status"] != "reconciliation triggered" {
		t.Errorf("expected reconciliation triggered, got %v", body["status"])
	}
}

// --- Middleware tests ---

func TestRateLimiting(t *testing.T) {
	srv, _ := setupTestServer(t)

	rl := NewRateLimiter(3, time.Minute)
	handler := rl.RateLimitMiddleware(srv.mux)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("GET", "/api/v1/health", nil)
		req.RemoteAddr = "1.2.3.4:5678"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rr.Code)
		}
	}

	// 4th request should be rate limited
	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	req.RemoteAddr = "1.2.3.4:5678"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", rr.Code)
	}
}

func TestLoggingMiddleware(t *testing.T) {
	srv, _ := setupTestServer(t)

	handler := LoggingMiddleware(srv.mux)

	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestCreateTunnelInvalidJSON(t *testing.T) {
	srv, _ := setupTestServer(t)

	req := httptest.NewRequest("POST", "/api/v1/tunnels", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateRouteInvalidJSON(t *testing.T) {
	srv, _ := setupTestServer(t)

	req := httptest.NewRequest("POST", "/api/v1/routes", bytes.NewReader([]byte("bad")))
	rr := httptest.NewRecorder()
	srv.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateFirewallRuleInvalidJSON(t *testing.T) {
	srv, _ := setupTestServer(t)

	req := httptest.NewRequest("POST", "/api/v1/firewall/rules", bytes.NewReader([]byte("bad")))
	rr := httptest.NewRecorder()
	srv.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestCreateRouteInvalidSNI(t *testing.T) {
	srv, _ := setupTestServer(t)

	rr := doRequest(srv, "POST", "/api/v1/tunnels", map[string]interface{}{"upstream_port": 443})
	body := parseJSON(t, rr)
	tunnelID := body["id"].(string)

	rr = doRequest(srv, "POST", "/api/v1/routes", map[string]interface{}{
		"tunnel_id": tunnelID, "match_type": "sni",
		"match_value": []string{"invalid domain!!!"}, "upstream_port": 443,
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid SNI, got %d", rr.Code)
	}
}
