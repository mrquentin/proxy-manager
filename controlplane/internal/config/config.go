package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all configuration values for the control plane, loaded from environment variables.
type Config struct {
	ListenAddr        string
	CaddyAdminSocket  string
	SQLitePath        string
	ReconcileInterval time.Duration
	LogLevel          string
	WGInterface       string
	WGSubnet          string
	WGServerIP        string
	TLSCert           string
	TLSKey            string
	TLSClientCA       string
	ServerEndpoint    string // Public IP:port for WireGuard endpoint (VPS_PUBLIC_IP:51820)
}

// Load reads configuration from environment variables and returns a validated Config.
func Load() (*Config, error) {
	cfg := &Config{
		ListenAddr:       envOrDefault("LISTEN_ADDR", ":7443"),
		CaddyAdminSocket: envOrDefault("CADDY_ADMIN_SOCKET", "/run/caddy/admin.sock"),
		SQLitePath:       envOrDefault("SQLITE_PATH", "/var/lib/controlplane/config.db"),
		LogLevel:         envOrDefault("LOG_LEVEL", "info"),
		WGInterface:      envOrDefault("WG_INTERFACE", "wg0"),
		WGSubnet:         envOrDefault("WG_SUBNET", "10.0.0.0/24"),
		WGServerIP:       envOrDefault("WG_SERVER_IP", "10.0.0.1"),
		TLSCert:          os.Getenv("TLS_CERT"),
		TLSKey:           os.Getenv("TLS_KEY"),
		TLSClientCA:      os.Getenv("TLS_CLIENT_CA"),
		ServerEndpoint:   envOrDefault("SERVER_ENDPOINT", ""),
	}

	intervalStr := envOrDefault("RECONCILE_INTERVAL", "30")
	intervalSec, err := strconv.Atoi(intervalStr)
	if err != nil || intervalSec < 1 {
		return nil, fmt.Errorf("invalid RECONCILE_INTERVAL: %q", intervalStr)
	}
	cfg.ReconcileInterval = time.Duration(intervalSec) * time.Second

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return cfg, nil
}

// Validate checks that all required fields are present and valid.
func (c *Config) Validate() error {
	var errs []string

	if c.ListenAddr == "" {
		errs = append(errs, "LISTEN_ADDR is required")
	}

	if c.CaddyAdminSocket == "" {
		errs = append(errs, "CADDY_ADMIN_SOCKET is required")
	}

	if c.SQLitePath == "" {
		errs = append(errs, "SQLITE_PATH is required")
	}

	if c.WGInterface == "" {
		errs = append(errs, "WG_INTERFACE is required")
	}

	if c.WGSubnet == "" {
		errs = append(errs, "WG_SUBNET is required")
	} else {
		_, _, err := net.ParseCIDR(c.WGSubnet)
		if err != nil {
			errs = append(errs, fmt.Sprintf("WG_SUBNET is not a valid CIDR: %v", err))
		}
	}

	if c.WGServerIP == "" {
		errs = append(errs, "WG_SERVER_IP is required")
	} else if ip := net.ParseIP(c.WGServerIP); ip == nil {
		errs = append(errs, fmt.Sprintf("WG_SERVER_IP is not a valid IP: %s", c.WGServerIP))
	}

	validLevels := map[string]bool{"debug": true, "info": true, "warn": true, "error": true}
	if !validLevels[c.LogLevel] {
		errs = append(errs, fmt.Sprintf("LOG_LEVEL must be one of debug, info, warn, error; got %q", c.LogLevel))
	}

	if c.ReconcileInterval < time.Second {
		errs = append(errs, "RECONCILE_INTERVAL must be at least 1 second")
	}

	// TLS fields must be all set or all empty (mTLS is required in production)
	tlsFields := []string{c.TLSCert, c.TLSKey, c.TLSClientCA}
	tlsSet := 0
	for _, f := range tlsFields {
		if f != "" {
			tlsSet++
		}
	}
	if tlsSet > 0 && tlsSet < len(tlsFields) {
		errs = append(errs, "TLS_CERT, TLS_KEY, and TLS_CLIENT_CA must all be set together or all be empty")
	}

	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}

	return nil
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
