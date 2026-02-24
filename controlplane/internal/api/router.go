package api

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/proxy-manager/controlplane/internal/caddy"
	"github.com/proxy-manager/controlplane/internal/config"
	"github.com/proxy-manager/controlplane/internal/firewall"
	"github.com/proxy-manager/controlplane/internal/reconciler"
	"github.com/proxy-manager/controlplane/internal/store"
	"github.com/proxy-manager/controlplane/internal/wireguard"
)

// Server holds all dependencies for the HTTP API.
type Server struct {
	cfg         *config.Config
	tunnelStore *store.TunnelStore
	routeStore  *store.RouteStore
	fwStore     *store.FirewallStore
	caddyClient caddy.Client
	wgManager   *wireguard.Manager
	fwManager   *firewall.Manager
	reconciler  *reconciler.Reconciler
	mux         *http.ServeMux
}

// NewServer creates a new API server with all routes mounted.
func NewServer(
	cfg *config.Config,
	tunnelStore *store.TunnelStore,
	routeStore *store.RouteStore,
	fwStore *store.FirewallStore,
	caddyClient caddy.Client,
	wgManager *wireguard.Manager,
	fwManager *firewall.Manager,
	rec *reconciler.Reconciler,
) *Server {
	s := &Server{
		cfg:         cfg,
		tunnelStore: tunnelStore,
		routeStore:  routeStore,
		fwStore:     fwStore,
		caddyClient: caddyClient,
		wgManager:   wgManager,
		fwManager:   fwManager,
		reconciler:  rec,
		mux:         http.NewServeMux(),
	}

	s.registerRoutes()
	return s
}

func (s *Server) registerRoutes() {
	// Tunnel endpoints
	s.mux.HandleFunc("POST /api/v1/tunnels", s.handleCreateTunnel)
	s.mux.HandleFunc("GET /api/v1/tunnels", s.handleListTunnels)
	s.mux.HandleFunc("DELETE /api/v1/tunnels/{id}", s.handleDeleteTunnel)
	s.mux.HandleFunc("GET /api/v1/tunnels/{id}/config", s.handleGetTunnelConfig)
	s.mux.HandleFunc("GET /api/v1/tunnels/{id}/qr", s.handleGetTunnelQR)
	s.mux.HandleFunc("POST /api/v1/tunnels/{id}/rotate", s.handleRotateTunnel)
	s.mux.HandleFunc("PATCH /api/v1/tunnels/{id}/rotation-policy", s.handleUpdateRotationPolicy)
	s.mux.HandleFunc("GET /api/v1/tunnels/{id}/rotation-policy", s.handleGetRotationPolicy)

	// Route endpoints
	s.mux.HandleFunc("POST /api/v1/routes", s.handleCreateRoute)
	s.mux.HandleFunc("GET /api/v1/routes", s.handleListRoutes)
	s.mux.HandleFunc("DELETE /api/v1/routes/{id}", s.handleDeleteRoute)

	// Firewall endpoints
	s.mux.HandleFunc("POST /api/v1/firewall/rules", s.handleCreateFirewallRule)
	s.mux.HandleFunc("GET /api/v1/firewall/rules", s.handleListFirewallRules)
	s.mux.HandleFunc("DELETE /api/v1/firewall/rules/{id}", s.handleDeleteFirewallRule)

	// System endpoints
	s.mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/v1/status", s.handleStatus)
	s.mux.HandleFunc("POST /api/v1/reconcile", s.handleForceReconcile)
	s.mux.HandleFunc("GET /api/v1/server/pubkey", s.handleGetServerPubkey)
}

// Handler returns the mux wrapped with middleware.
func (s *Server) Handler() http.Handler {
	auditLogger := NewAuditLogger(s.fwStore)
	rateLimiter := NewRateLimiter(100, time.Minute)

	var handler http.Handler = s.mux
	handler = AuditMiddleware(auditLogger)(handler)
	handler = rateLimiter.RateLimitMiddleware(handler)
	handler = LoggingMiddleware(handler)

	return handler
}

// NewTLSConfig creates a TLS configuration for mTLS with TLS 1.3 only.
func NewTLSConfig(cfg *config.Config) (*tls.Config, error) {
	if cfg.TLSCert == "" || cfg.TLSKey == "" {
		return nil, nil // No TLS configured (for testing)
	}

	cert, err := tls.LoadX509KeyPair(cfg.TLSCert, cfg.TLSKey)
	if err != nil {
		return nil, fmt.Errorf("load TLS cert/key: %w", err)
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
	}

	if cfg.TLSClientCA != "" {
		caCert, err := os.ReadFile(cfg.TLSClientCA)
		if err != nil {
			return nil, fmt.Errorf("read CA cert: %w", err)
		}
		caCertPool := x509.NewCertPool()
		if !caCertPool.AppendCertsFromPEM(caCert) {
			return nil, fmt.Errorf("failed to parse CA certificate")
		}
		tlsConfig.ClientAuth = tls.RequireAndVerifyClientCert
		tlsConfig.ClientCAs = caCertPool
	}

	return tlsConfig, nil
}

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
