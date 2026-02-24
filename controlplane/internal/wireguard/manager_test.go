package wireguard

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"
)

// MockWGClient implements WGClient for testing.
type MockWGClient struct {
	peers     map[string]PeerInfo
	publicKey string
	addErr    error
	removeErr error
	getErr    error
}

func NewMockWGClient() *MockWGClient {
	return &MockWGClient{
		peers:     make(map[string]PeerInfo),
		publicKey: "server-pub-key-base64==",
	}
}

func (m *MockWGClient) AddPeer(iface string, pubkey, psk, vpnIP string) error {
	if m.addErr != nil {
		return m.addErr
	}
	m.peers[pubkey] = PeerInfo{
		PublicKey:  pubkey,
		AllowedIPs: []string{vpnIP + "/32"},
	}
	return nil
}

func (m *MockWGClient) RemovePeer(iface string, pubkey string) error {
	if m.removeErr != nil {
		return m.removeErr
	}
	if _, ok := m.peers[pubkey]; !ok {
		return fmt.Errorf("peer not found: %s", pubkey)
	}
	delete(m.peers, pubkey)
	return nil
}

func (m *MockWGClient) GetDevice(iface string) (*DeviceInfo, error) {
	if m.getErr != nil {
		return nil, m.getErr
	}
	var peers []PeerInfo
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	return &DeviceInfo{
		PublicKey:  m.publicKey,
		ListenPort: 51820,
		Peers:      peers,
	}, nil
}

func TestManagerAddPeer(t *testing.T) {
	mock := NewMockWGClient()
	mgr := NewManager("wg0", mock)

	err := mgr.AddPeer("pubkey1", "psk1", "10.0.0.2")
	if err != nil {
		t.Fatalf("add peer: %v", err)
	}

	if len(mock.peers) != 1 {
		t.Fatalf("expected 1 peer, got %d", len(mock.peers))
	}

	peer, ok := mock.peers["pubkey1"]
	if !ok {
		t.Fatal("peer pubkey1 not found")
	}
	if peer.AllowedIPs[0] != "10.0.0.2/32" {
		t.Errorf("expected allowed IP 10.0.0.2/32, got %s", peer.AllowedIPs[0])
	}
}

func TestManagerAddPeerError(t *testing.T) {
	mock := NewMockWGClient()
	mock.addErr = fmt.Errorf("kernel error")
	mgr := NewManager("wg0", mock)

	err := mgr.AddPeer("pubkey1", "psk1", "10.0.0.2")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "kernel error") {
		t.Errorf("expected kernel error, got %v", err)
	}
}

func TestManagerRemovePeer(t *testing.T) {
	mock := NewMockWGClient()
	mgr := NewManager("wg0", mock)

	mgr.AddPeer("pubkey1", "psk1", "10.0.0.2")

	err := mgr.RemovePeer("pubkey1")
	if err != nil {
		t.Fatalf("remove peer: %v", err)
	}
	if len(mock.peers) != 0 {
		t.Errorf("expected 0 peers, got %d", len(mock.peers))
	}
}

func TestManagerRemovePeerNotFound(t *testing.T) {
	mock := NewMockWGClient()
	mgr := NewManager("wg0", mock)

	err := mgr.RemovePeer("nonexistent")
	if err == nil {
		t.Fatal("expected error removing nonexistent peer")
	}
}

func TestManagerListPeers(t *testing.T) {
	mock := NewMockWGClient()
	mock.peers["pk1"] = PeerInfo{
		PublicKey:         "pk1",
		AllowedIPs:        []string{"10.0.0.2/32"},
		LastHandshakeTime: time.Now(),
		ReceiveBytes:      1000,
		TransmitBytes:     2000,
	}
	mock.peers["pk2"] = PeerInfo{
		PublicKey:  "pk2",
		AllowedIPs: []string{"10.0.0.3/32"},
	}

	mgr := NewManager("wg0", mock)

	peers, err := mgr.ListPeers()
	if err != nil {
		t.Fatalf("list peers: %v", err)
	}
	if len(peers) != 2 {
		t.Fatalf("expected 2 peers, got %d", len(peers))
	}
}

func TestManagerGetServerPublicKey(t *testing.T) {
	mock := NewMockWGClient()
	mock.publicKey = "my-server-pubkey=="
	mgr := NewManager("wg0", mock)

	key, err := mgr.GetServerPublicKey()
	if err != nil {
		t.Fatalf("get server pubkey: %v", err)
	}
	if key != "my-server-pubkey==" {
		t.Errorf("expected my-server-pubkey==, got %s", key)
	}
}

func TestManagerGetDeviceError(t *testing.T) {
	mock := NewMockWGClient()
	mock.getErr = fmt.Errorf("device not found")
	mgr := NewManager("wg0", mock)

	_, err := mgr.ListPeers()
	if err == nil {
		t.Fatal("expected error")
	}

	_, err = mgr.GetServerPublicKey()
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestGenerateKeyPair(t *testing.T) {
	privKey, pubKey, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}

	privBytes, err := base64.StdEncoding.DecodeString(privKey)
	if err != nil {
		t.Fatalf("decode private key: %v", err)
	}
	if len(privBytes) != 32 {
		t.Errorf("expected 32 byte private key, got %d", len(privBytes))
	}

	pubBytes, err := base64.StdEncoding.DecodeString(pubKey)
	if err != nil {
		t.Fatalf("decode public key: %v", err)
	}
	if len(pubBytes) != 32 {
		t.Errorf("expected 32 byte public key, got %d", len(pubBytes))
	}

	// Keys should differ
	if privKey == pubKey {
		t.Error("private and public keys should differ")
	}
}

func TestGeneratePSK(t *testing.T) {
	psk, err := GeneratePSK()
	if err != nil {
		t.Fatalf("generate psk: %v", err)
	}

	pskBytes, err := base64.StdEncoding.DecodeString(psk)
	if err != nil {
		t.Fatalf("decode psk: %v", err)
	}
	if len(pskBytes) != 32 {
		t.Errorf("expected 32 byte psk, got %d", len(pskBytes))
	}
}

func TestGenerateRandomID(t *testing.T) {
	id1 := GenerateRandomID("tun_")
	id2 := GenerateRandomID("tun_")

	if !strings.HasPrefix(id1, "tun_") {
		t.Errorf("expected prefix tun_, got %s", id1)
	}
	if id1 == id2 {
		t.Error("two generated IDs should be different")
	}

	routeID := GenerateRandomID("route_")
	if !strings.HasPrefix(routeID, "route_") {
		t.Errorf("expected prefix route_, got %s", routeID)
	}
}
