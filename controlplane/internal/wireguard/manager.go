package wireguard

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net"
	"time"

	"golang.zx2c4.com/wireguard/wgctrl"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

// PeerInfo holds information about a WireGuard peer retrieved from the kernel.
type PeerInfo struct {
	PublicKey         string
	Endpoint          string
	AllowedIPs        []string
	LastHandshakeTime time.Time
	ReceiveBytes      int64
	TransmitBytes     int64
}

// DeviceInfo holds the WireGuard device info (server side).
type DeviceInfo struct {
	PublicKey  string
	ListenPort int
	Peers      []PeerInfo
}

// WGClient is the interface for interacting with WireGuard at the kernel level.
// This abstraction allows mocking in tests.
type WGClient interface {
	AddPeer(iface string, pubkey, psk string, vpnIP string) error
	RemovePeer(iface string, pubkey string) error
	GetDevice(iface string) (*DeviceInfo, error)
}

// Manager wraps WireGuard operations for the control plane.
type Manager struct {
	iface  string
	client WGClient
}

// NewManager creates a new WireGuard manager for the given interface.
func NewManager(iface string, client WGClient) *Manager {
	return &Manager{
		iface:  iface,
		client: client,
	}
}

// AddPeer adds a WireGuard peer with the given public key, PSK, and VPN IP.
func (m *Manager) AddPeer(pubkey, psk, vpnIP string) error {
	return m.client.AddPeer(m.iface, pubkey, psk, vpnIP)
}

// RemovePeer removes a WireGuard peer by public key.
func (m *Manager) RemovePeer(pubkey string) error {
	return m.client.RemovePeer(m.iface, pubkey)
}

// ListPeers returns all WireGuard peers for the managed interface.
func (m *Manager) ListPeers() ([]PeerInfo, error) {
	dev, err := m.client.GetDevice(m.iface)
	if err != nil {
		return nil, err
	}
	return dev.Peers, nil
}

// GetServerPublicKey returns the server's WireGuard public key.
func (m *Manager) GetServerPublicKey() (string, error) {
	dev, err := m.client.GetDevice(m.iface)
	if err != nil {
		return "", err
	}
	return dev.PublicKey, nil
}

// GenerateKeyPair generates a new WireGuard Curve25519 key pair.
// Returns (privateKey, publicKey) as base64-encoded strings.
func GenerateKeyPair() (string, string, error) {
	privKey, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		return "", "", fmt.Errorf("generate private key: %w", err)
	}
	pubKey := privKey.PublicKey()
	return base64.StdEncoding.EncodeToString(privKey[:]), base64.StdEncoding.EncodeToString(pubKey[:]), nil
}

// GeneratePSK generates a new WireGuard pre-shared key.
// Returns the PSK as a base64-encoded string.
func GeneratePSK() (string, error) {
	key, err := wgtypes.GenerateKey()
	if err != nil {
		return "", fmt.Errorf("generate psk: %w", err)
	}
	return base64.StdEncoding.EncodeToString(key[:]), nil
}

// GenerateRandomID generates a random ID with the given prefix (e.g., "tun_", "route_", "fw_rule_").
func GenerateRandomID(prefix string) string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

// RealWGClient implements WGClient using the real wgctrl-go library.
type RealWGClient struct{}

// NewRealWGClient creates a new RealWGClient.
func NewRealWGClient() *RealWGClient {
	return &RealWGClient{}
}

// AddPeer adds a peer to the WireGuard interface via wgctrl.
func (c *RealWGClient) AddPeer(iface string, pubkey, psk, vpnIP string) error {
	// Lazy import approach: we use wgctrl.New() per-call so we don't hold a netlink socket open
	pubKeyBytes, err := base64.StdEncoding.DecodeString(pubkey)
	if err != nil {
		return fmt.Errorf("decode public key: %w", err)
	}
	var pubKeyArr wgtypes.Key
	copy(pubKeyArr[:], pubKeyBytes)

	pskBytes, err := base64.StdEncoding.DecodeString(psk)
	if err != nil {
		return fmt.Errorf("decode psk: %w", err)
	}
	var pskArr wgtypes.Key
	copy(pskArr[:], pskBytes)

	_, allowedNet, err := net.ParseCIDR(vpnIP + "/32")
	if err != nil {
		return fmt.Errorf("parse vpn ip: %w", err)
	}
	keepalive := 25 * time.Second

	config := wgtypes.Config{
		Peers: []wgtypes.PeerConfig{{
			PublicKey:                   pubKeyArr,
			PresharedKey:                &pskArr,
			AllowedIPs:                  []net.IPNet{*allowedNet},
			PersistentKeepaliveInterval: &keepalive,
			ReplaceAllowedIPs:           true,
		}},
	}

	client, err := wgctrl.New()
	if err != nil {
		return fmt.Errorf("wgctrl.New: %w", err)
	}
	defer client.Close()
	return client.ConfigureDevice(iface, config)
}

// RemovePeer removes a peer from the WireGuard interface via wgctrl.
func (c *RealWGClient) RemovePeer(iface string, pubkey string) error {
	pubKeyBytes, err := base64.StdEncoding.DecodeString(pubkey)
	if err != nil {
		return fmt.Errorf("decode public key: %w", err)
	}
	var pubKeyArr wgtypes.Key
	copy(pubKeyArr[:], pubKeyBytes)

	config := wgtypes.Config{
		Peers: []wgtypes.PeerConfig{{
			PublicKey: pubKeyArr,
			Remove:   true,
		}},
	}

	client, err := wgctrl.New()
	if err != nil {
		return fmt.Errorf("wgctrl.New: %w", err)
	}
	defer client.Close()
	return client.ConfigureDevice(iface, config)
}

// GetDevice returns the WireGuard device info.
func (c *RealWGClient) GetDevice(iface string) (*DeviceInfo, error) {
	client, err := wgctrl.New()
	if err != nil {
		return nil, fmt.Errorf("wgctrl.New: %w", err)
	}
	defer client.Close()

	dev, err := client.Device(iface)
	if err != nil {
		return nil, fmt.Errorf("get device %s: %w", iface, err)
	}

	info := &DeviceInfo{
		PublicKey:  base64.StdEncoding.EncodeToString(dev.PublicKey[:]),
		ListenPort: dev.ListenPort,
	}

	for _, p := range dev.Peers {
		var allowedIPs []string
		for _, ip := range p.AllowedIPs {
			allowedIPs = append(allowedIPs, ip.String())
		}
		var endpoint string
		if p.Endpoint != nil {
			endpoint = p.Endpoint.String()
		}
		info.Peers = append(info.Peers, PeerInfo{
			PublicKey:         base64.StdEncoding.EncodeToString(p.PublicKey[:]),
			Endpoint:          endpoint,
			AllowedIPs:        allowedIPs,
			LastHandshakeTime: p.LastHandshakeTime,
			ReceiveBytes:      p.ReceiveBytes,
			TransmitBytes:     p.TransmitBytes,
		})
	}

	return info, nil
}
