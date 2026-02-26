package caddy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// CaddyRoute represents a single L4 route in Caddy config.
type CaddyRoute struct {
	ID      string        `json:"@id"`
	Match   []RouteMatch  `json:"match"`
	Handle  []RouteHandle `json:"handle"`
}

// RouteMatch represents the match block of a Caddy L4 route.
type RouteMatch struct {
	TLS *TLSMatch `json:"tls,omitempty"`
}

// TLSMatch represents a TLS SNI match.
type TLSMatch struct {
	SNI []string `json:"sni"`
}

// RouteHandle represents the handle block of a Caddy L4 route.
type RouteHandle struct {
	Handler   string           `json:"handler"`
	Upstreams []RouteUpstream  `json:"upstreams"`
}

// RouteUpstream represents an upstream in a proxy handler.
type RouteUpstream struct {
	Dial []string `json:"dial"`
}

// L4Config represents the layer4 apps config from Caddy.
type L4Config struct {
	Servers map[string]*L4Server `json:"servers"`
}

// L4Server represents a single L4 server in Caddy config.
type L4Server struct {
	ID     string        `json:"@id,omitempty"`
	Listen []string      `json:"listen"`
	Routes []CaddyRoute  `json:"routes"`
}

// Client is an interface for interacting with the Caddy admin API.
type Client interface {
	GetL4Config(ctx context.Context) (*L4Config, error)
	AddRoute(ctx context.Context, route CaddyRoute) error
	DeleteRoute(ctx context.Context, caddyID string) error
	CreateServer(ctx context.Context) error
	CreatePortForwardServer(ctx context.Context, serverName, listenAddr, upstream, caddyID string) error
	DeleteServer(ctx context.Context, serverName string) error
}

// HTTPClient implements Client using HTTP calls to Caddy's admin Unix socket.
type HTTPClient struct {
	httpClient *http.Client
	baseURL    string
}

// NewHTTPClient creates a new Caddy admin API client connected via Unix socket.
func NewHTTPClient(socketPath string) *HTTPClient {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return net.DialTimeout("unix", socketPath, 5*time.Second)
		},
	}

	return &HTTPClient{
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   10 * time.Second,
		},
		baseURL: "http://localhost",
	}
}

// NewHTTPClientWithHTTPClient creates a Caddy client using a provided *http.Client.
// This is useful for testing with httptest.NewServer.
func NewHTTPClientWithHTTPClient(httpClient *http.Client, baseURL string) *HTTPClient {
	return &HTTPClient{
		httpClient: httpClient,
		baseURL:    baseURL,
	}
}

// GetL4Config reads the current L4 configuration from Caddy.
func (c *HTTPClient) GetL4Config(ctx context.Context) (*L4Config, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/config/apps/layer4", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get l4 config: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		// No layer4 config exists yet; return empty
		return &L4Config{Servers: map[string]*L4Server{}}, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("caddy returned status %d: %s", resp.StatusCode, string(body))
	}

	var cfg L4Config
	if err := json.Unmarshal(body, &cfg); err != nil {
		return nil, fmt.Errorf("decode l4 config: %w", err)
	}
	if cfg.Servers == nil {
		cfg.Servers = map[string]*L4Server{}
	}
	return &cfg, nil
}

// CreateServer creates the main L4 proxy server in Caddy if it doesn't exist.
func (c *HTTPClient) CreateServer(ctx context.Context) error {
	server := map[string]interface{}{
		"@id":    "l4-main",
		"listen": []string{"0.0.0.0:443"},
		"routes": []interface{}{},
	}

	body, err := json.Marshal(server)
	if err != nil {
		return fmt.Errorf("marshal server config: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/config/apps/layer4/servers/proxy", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("create server: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("caddy returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// AddRoute adds a new L4 route to the Caddy proxy server.
func (c *HTTPClient) AddRoute(ctx context.Context, route CaddyRoute) error {
	body, err := json.Marshal(route)
	if err != nil {
		return fmt.Errorf("marshal route: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/config/apps/layer4/servers/proxy/routes", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("add route: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("caddy returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// DeleteRoute removes a route from Caddy by its @id.
func (c *HTTPClient) DeleteRoute(ctx context.Context, caddyID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		c.baseURL+"/id/"+caddyID, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete route: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("caddy returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// CreatePortForwardServer creates a dedicated L4 server for port forwarding.
func (c *HTTPClient) CreatePortForwardServer(ctx context.Context, serverName, listenAddr, upstream, caddyID string) error {
	server := map[string]interface{}{
		"listen": []string{listenAddr},
		"routes": []map[string]interface{}{
			{
				"@id": caddyID,
				"handle": []map[string]interface{}{
					{
						"handler": "proxy",
						"upstreams": []map[string]interface{}{
							{"dial": []string{upstream}},
						},
					},
				},
			},
		},
	}

	body, err := json.Marshal(server)
	if err != nil {
		return fmt.Errorf("marshal server config: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut,
		c.baseURL+"/config/apps/layer4/servers/"+serverName, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("create port-forward server: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("caddy returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// DeleteServer removes an entire L4 server from Caddy.
func (c *HTTPClient) DeleteServer(ctx context.Context, serverName string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		c.baseURL+"/config/apps/layer4/servers/"+serverName, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete server: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("caddy returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// PortForwardServerName returns the Caddy server name for a port-forward route.
func PortForwardServerName(port int, protocol string) string {
	return fmt.Sprintf("pf-%s-%d", protocol, port)
}

// FormatListenAddr returns the Caddy listen address for a given port and protocol.
func FormatListenAddr(port int, protocol string) string {
	if protocol == "udp" {
		return fmt.Sprintf("udp/0.0.0.0:%d", port)
	}
	return fmt.Sprintf("0.0.0.0:%d", port)
}

// FormatUpstream returns the Caddy upstream dial address.
func FormatUpstream(vpnIP string, port int, protocol string) string {
	if protocol == "udp" {
		return fmt.Sprintf("udp/%s:%d", vpnIP, port)
	}
	return fmt.Sprintf("%s:%d", vpnIP, port)
}

// BuildCaddyRoute constructs a CaddyRoute from route parameters.
func BuildCaddyRoute(caddyID string, sniDomains []string, upstream string) CaddyRoute {
	return CaddyRoute{
		ID: caddyID,
		Match: []RouteMatch{
			{
				TLS: &TLSMatch{
					SNI: sniDomains,
				},
			},
		},
		Handle: []RouteHandle{
			{
				Handler: "proxy",
				Upstreams: []RouteUpstream{
					{Dial: []string{upstream}},
				},
			},
		},
	}
}
