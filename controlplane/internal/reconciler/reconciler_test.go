package reconciler

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-manager/controlplane/internal/caddy"
	"github.com/proxy-manager/controlplane/internal/firewall"
	"github.com/proxy-manager/controlplane/internal/store"
	"github.com/proxy-manager/controlplane/internal/wireguard"
)

// mockCaddyClient implements caddy.Client for testing.
type mockCaddyClient struct {
	config       *caddy.L4Config
	routes       []caddy.CaddyRoute
	serverExists bool
	addErr       error
	deleteErr    error
	getErr       error
	createErr    error
	addedRoutes  []caddy.CaddyRoute
	deletedIDs   []string
}

func newMockCaddyClient() *mockCaddyClient {
	return &mockCaddyClient{
		config: &caddy.L4Config{Servers: map[string]*caddy.L4Server{}},
	}
}

func (m *mockCaddyClient) GetL4Config(ctx context.Context) (*caddy.L4Config, error) {
	if m.getErr != nil {
		return nil, m.getErr
	}
	return m.config, nil
}

func (m *mockCaddyClient) AddRoute(ctx context.Context, route caddy.CaddyRoute) error {
	if m.addErr != nil {
		return m.addErr
	}
	m.addedRoutes = append(m.addedRoutes, route)
	return nil
}

func (m *mockCaddyClient) DeleteRoute(ctx context.Context, caddyID string) error {
	if m.deleteErr != nil {
		return m.deleteErr
	}
	m.deletedIDs = append(m.deletedIDs, caddyID)
	return nil
}

func (m *mockCaddyClient) CreateServer(ctx context.Context) error {
	if m.createErr != nil {
		return m.createErr
	}
	m.serverExists = true
	return nil
}

// mockWGClient for reconciler tests.
type mockWGClient struct {
	peers     map[string]wireguard.PeerInfo
	publicKey string
	addErr    error
	removeErr error
}

func newMockWGClient() *mockWGClient {
	return &mockWGClient{
		peers:     make(map[string]wireguard.PeerInfo),
		publicKey: "server-key==",
	}
}

func (m *mockWGClient) AddPeer(iface string, pubkey, psk, vpnIP string) error {
	if m.addErr != nil {
		return m.addErr
	}
	m.peers[pubkey] = wireguard.PeerInfo{
		PublicKey:  pubkey,
		AllowedIPs: []string{vpnIP + "/32"},
	}
	return nil
}

func (m *mockWGClient) RemovePeer(iface string, pubkey string) error {
	if m.removeErr != nil {
		return m.removeErr
	}
	delete(m.peers, pubkey)
	return nil
}

func (m *mockWGClient) GetDevice(iface string) (*wireguard.DeviceInfo, error) {
	var peers []wireguard.PeerInfo
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	return &wireguard.DeviceInfo{
		PublicKey:  m.publicKey,
		ListenPort: 51820,
		Peers:      peers,
	}, nil
}

// mockNFTConn for reconciler tests.
type mockNFTConn struct {
	rules   map[string]firewall.Rule
	addErr  error
	delErr  error
}

func newMockNFTConn() *mockNFTConn {
	return &mockNFTConn{rules: make(map[string]firewall.Rule)}
}

func (m *mockNFTConn) Init() error { return nil }

func (m *mockNFTConn) AddRule(rule firewall.Rule) error {
	if m.addErr != nil {
		return m.addErr
	}
	m.rules[rule.ID] = rule
	return nil
}

func (m *mockNFTConn) DeleteRule(id string) error {
	if m.delErr != nil {
		return m.delErr
	}
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

func setupReconciler(t *testing.T) (*Reconciler, *store.DB, *mockCaddyClient, *mockWGClient, *mockNFTConn) {
	t.Helper()
	db, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("create test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	tunnelStore := store.NewTunnelStore(db)
	routeStore := store.NewRouteStore(db)
	fwStore := store.NewFirewallStore(db)

	mockCaddy := newMockCaddyClient()
	mockWG := newMockWGClient()
	mockNFT := newMockNFTConn()

	wgMgr := wireguard.NewManager("wg0", mockWG)
	fwMgr := firewall.NewManager(mockNFT)

	rec := New(tunnelStore, routeStore, fwStore, mockCaddy, wgMgr, fwMgr, 30*time.Second)

	return rec, db, mockCaddy, mockWG, mockNFT
}

func TestReconcileCaddyAddMissingRoute(t *testing.T) {
	rec, db, mockCaddy, _, _ := setupReconciler(t)

	// Add a desired route to SQLite
	tunnelStore := store.NewTunnelStore(db)
	routeStore := store.NewRouteStore(db)

	tunnelStore.Create(&store.Tunnel{ID: "tun_1", PublicKey: "pk1", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})
	routeStore.Create(&store.Route{
		ID: "route_1", TunnelID: "tun_1", ListenPort: 443, MatchType: "sni",
		MatchValue: []string{"app.example.com"}, Upstream: "10.0.0.2:443",
		CaddyID: "route-tun_1-443", Enabled: true,
	})

	// Caddy has no routes (empty)
	mockCaddy.config = &caddy.L4Config{Servers: map[string]*caddy.L4Server{}}

	// Run reconciliation
	ctx := context.Background()
	ops, err := rec.reconcileCaddy(ctx)
	if err != nil {
		t.Fatalf("reconcile caddy: %v", err)
	}

	// Should create server + add route = 2 ops
	if ops < 1 {
		t.Errorf("expected at least 1 op, got %d", ops)
	}
	if len(mockCaddy.addedRoutes) != 1 {
		t.Fatalf("expected 1 added route, got %d", len(mockCaddy.addedRoutes))
	}
	if mockCaddy.addedRoutes[0].ID != "route-tun_1-443" {
		t.Errorf("expected route ID route-tun_1-443, got %s", mockCaddy.addedRoutes[0].ID)
	}
}

func TestReconcileCaddyRemoveExtraRoute(t *testing.T) {
	rec, _, mockCaddy, _, _ := setupReconciler(t)

	// Caddy has a route that's not in SQLite
	mockCaddy.config = &caddy.L4Config{
		Servers: map[string]*caddy.L4Server{
			"proxy": {
				Listen: []string{"0.0.0.0:443"},
				Routes: []caddy.CaddyRoute{
					{ID: "route-stale-443", Match: []caddy.RouteMatch{{TLS: &caddy.TLSMatch{SNI: []string{"old.com"}}}},
						Handle: []caddy.RouteHandle{{Handler: "proxy", Upstreams: []caddy.RouteUpstream{{Dial: []string{"10.0.0.5:443"}}}}}},
				},
			},
		},
	}

	ctx := context.Background()
	ops, err := rec.reconcileCaddy(ctx)
	if err != nil {
		t.Fatalf("reconcile caddy: %v", err)
	}

	if ops != 1 {
		t.Errorf("expected 1 op (remove), got %d", ops)
	}
	if len(mockCaddy.deletedIDs) != 1 || mockCaddy.deletedIDs[0] != "route-stale-443" {
		t.Errorf("expected deleted route-stale-443, got %v", mockCaddy.deletedIDs)
	}
}

func TestReconcileWireGuardAddMissingPeer(t *testing.T) {
	rec, db, _, mockWG, _ := setupReconciler(t)

	tunnelStore := store.NewTunnelStore(db)
	tunnelStore.Create(&store.Tunnel{ID: "tun_1", PublicKey: "pk1", VpnIP: "10.0.0.2", Enabled: true, Domains: []string{}})

	// WG has no peers
	ops, err := rec.reconcileWireGuard()
	if err != nil {
		t.Fatalf("reconcile wg: %v", err)
	}

	if ops != 1 {
		t.Errorf("expected 1 op, got %d", ops)
	}
	if _, ok := mockWG.peers["pk1"]; !ok {
		t.Error("expected peer pk1 to be added")
	}
}

func TestReconcileWireGuardRemoveExtraPeer(t *testing.T) {
	rec, _, _, mockWG, _ := setupReconciler(t)

	// WG has a peer not in SQLite
	mockWG.peers["stale_pk"] = wireguard.PeerInfo{PublicKey: "stale_pk", AllowedIPs: []string{"10.0.0.5/32"}}

	ops, err := rec.reconcileWireGuard()
	if err != nil {
		t.Fatalf("reconcile wg: %v", err)
	}

	if ops != 1 {
		t.Errorf("expected 1 op, got %d", ops)
	}
	if _, ok := mockWG.peers["stale_pk"]; ok {
		t.Error("expected stale peer to be removed")
	}
}

func TestReconcileFirewallAddMissingRule(t *testing.T) {
	rec, db, _, _, mockNFT := setupReconciler(t)

	fwStore := store.NewFirewallStore(db)
	fwStore.Create(&store.FirewallRule{
		ID: "fw_1", Port: 8080, Proto: "tcp", Direction: "in",
		SourceCIDR: "0.0.0.0/0", Action: "allow", Enabled: true,
	})

	ops, err := rec.reconcileFirewall()
	if err != nil {
		t.Fatalf("reconcile fw: %v", err)
	}

	if ops != 1 {
		t.Errorf("expected 1 op, got %d", ops)
	}
	if _, ok := mockNFT.rules["fw_1"]; !ok {
		t.Error("expected rule fw_1 to be added")
	}
}

func TestReconcileFirewallRemoveExtraRule(t *testing.T) {
	rec, _, _, _, mockNFT := setupReconciler(t)

	// NFT has a rule not in SQLite
	mockNFT.rules["stale_fw"] = firewall.Rule{ID: "stale_fw", Port: 9090, Proto: "tcp", Direction: "in", SourceCIDR: "0.0.0.0/0", Action: "allow"}

	ops, err := rec.reconcileFirewall()
	if err != nil {
		t.Fatalf("reconcile fw: %v", err)
	}

	if ops != 1 {
		t.Errorf("expected 1 op, got %d", ops)
	}
	if _, ok := mockNFT.rules["stale_fw"]; ok {
		t.Error("expected stale rule to be removed")
	}
}

func TestReconcileNoDrift(t *testing.T) {
	rec, db, _, _, _ := setupReconciler(t)

	// Everything empty — no drift
	ctx := context.Background()
	rec.reconcileOnce(ctx)

	// Check reconciliation state updated
	fwStore := store.NewFirewallStore(db)
	state, err := fwStore.GetReconciliationState()
	if err != nil {
		t.Fatalf("get reconciliation state: %v", err)
	}
	if state.LastStatus != "ok" {
		t.Errorf("expected ok status, got %s", state.LastStatus)
	}
}

func TestForceReconcile(t *testing.T) {
	rec, _, _, _, _ := setupReconciler(t)

	// Should not block
	rec.ForceReconcile()
	rec.ForceReconcile() // second should be no-op (buffered channel)
}

func TestReconcileCaddyError(t *testing.T) {
	rec, _, mockCaddy, _, _ := setupReconciler(t)

	mockCaddy.getErr = fmt.Errorf("socket down")

	ctx := context.Background()
	_, err := rec.reconcileCaddy(ctx)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReconcileWireGuardError(t *testing.T) {
	rec, _, _, _, _ := setupReconciler(t)

	// Make GetDevice fail by replacing the client
	mockWG2 := newMockWGClient()
	rec.wgManager = wireguard.NewManager("wg0", &errorWGClient{})
	_ = mockWG2

	_, err := rec.reconcileWireGuard()
	if err == nil {
		t.Fatal("expected error")
	}
}

type errorWGClient struct{}

func (e *errorWGClient) AddPeer(iface string, pubkey, psk, vpnIP string) error {
	return fmt.Errorf("add error")
}
func (e *errorWGClient) RemovePeer(iface string, pubkey string) error {
	return fmt.Errorf("remove error")
}
func (e *errorWGClient) GetDevice(iface string) (*wireguard.DeviceInfo, error) {
	return nil, fmt.Errorf("device error")
}

func TestCheckRotationsAutoRevoke(t *testing.T) {
	rec, db, _, mockWG, _ := setupReconciler(t)

	tunnelStore := store.NewTunnelStore(db)

	// Create a tunnel with a very old handshake
	oldTime := time.Now().Add(-100 * 24 * time.Hour)
	tunnel := &store.Tunnel{
		ID: "tun_old", PublicKey: "pk_old", VpnIP: "10.0.0.2",
		Enabled: true, Domains: []string{},
		AutoRevokeInactive: true, InactiveExpiryDays: 90,
		LastHandshake: &oldTime,
	}
	tunnelStore.Create(tunnel)

	// Also add the peer to WG
	mockWG.peers["pk_old"] = wireguard.PeerInfo{PublicKey: "pk_old"}

	rec.checkRotations()

	// The tunnel should have been deleted
	_, err := tunnelStore.Get("tun_old")
	if err == nil {
		t.Error("expected tunnel to be deleted due to inactivity")
	}
}
