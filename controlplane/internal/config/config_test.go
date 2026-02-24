package config

import (
	"os"
	"testing"
)

func clearEnv() {
	for _, key := range []string{
		"LISTEN_ADDR", "CADDY_ADMIN_SOCKET", "SQLITE_PATH",
		"RECONCILE_INTERVAL", "LOG_LEVEL", "WG_INTERFACE",
		"WG_SUBNET", "WG_SERVER_IP", "TLS_CERT", "TLS_KEY",
		"TLS_CLIENT_CA", "SERVER_ENDPOINT",
	} {
		os.Unsetenv(key)
	}
}

func TestLoadDefaults(t *testing.T) {
	clearEnv()
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error loading defaults: %v", err)
	}

	if cfg.ListenAddr != ":7443" {
		t.Errorf("expected ListenAddr :7443, got %q", cfg.ListenAddr)
	}
	if cfg.CaddyAdminSocket != "/run/caddy/admin.sock" {
		t.Errorf("expected CaddyAdminSocket /run/caddy/admin.sock, got %q", cfg.CaddyAdminSocket)
	}
	if cfg.SQLitePath != "/var/lib/controlplane/config.db" {
		t.Errorf("expected SQLitePath /var/lib/controlplane/config.db, got %q", cfg.SQLitePath)
	}
	if cfg.ReconcileInterval.Seconds() != 30 {
		t.Errorf("expected ReconcileInterval 30s, got %v", cfg.ReconcileInterval)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("expected LogLevel info, got %q", cfg.LogLevel)
	}
	if cfg.WGInterface != "wg0" {
		t.Errorf("expected WGInterface wg0, got %q", cfg.WGInterface)
	}
	if cfg.WGSubnet != "10.0.0.0/24" {
		t.Errorf("expected WGSubnet 10.0.0.0/24, got %q", cfg.WGSubnet)
	}
	if cfg.WGServerIP != "10.0.0.1" {
		t.Errorf("expected WGServerIP 10.0.0.1, got %q", cfg.WGServerIP)
	}
}

func TestLoadFromEnv(t *testing.T) {
	clearEnv()
	os.Setenv("LISTEN_ADDR", ":9443")
	os.Setenv("RECONCILE_INTERVAL", "60")
	os.Setenv("LOG_LEVEL", "debug")
	os.Setenv("WG_SUBNET", "172.16.0.0/16")
	os.Setenv("WG_SERVER_IP", "172.16.0.1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.ListenAddr != ":9443" {
		t.Errorf("expected :9443, got %q", cfg.ListenAddr)
	}
	if cfg.ReconcileInterval.Seconds() != 60 {
		t.Errorf("expected 60s, got %v", cfg.ReconcileInterval)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("expected debug, got %q", cfg.LogLevel)
	}
	if cfg.WGSubnet != "172.16.0.0/16" {
		t.Errorf("expected 172.16.0.0/16, got %q", cfg.WGSubnet)
	}
	clearEnv()
}

func TestInvalidReconcileInterval(t *testing.T) {
	clearEnv()
	os.Setenv("RECONCILE_INTERVAL", "abc")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid RECONCILE_INTERVAL")
	}
	clearEnv()
}

func TestInvalidLogLevel(t *testing.T) {
	clearEnv()
	os.Setenv("LOG_LEVEL", "trace")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid LOG_LEVEL")
	}
	clearEnv()
}

func TestInvalidWGSubnet(t *testing.T) {
	clearEnv()
	os.Setenv("WG_SUBNET", "not-a-cidr")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid WG_SUBNET")
	}
	clearEnv()
}

func TestInvalidWGServerIP(t *testing.T) {
	clearEnv()
	os.Setenv("WG_SERVER_IP", "not-an-ip")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid WG_SERVER_IP")
	}
	clearEnv()
}

func TestPartialTLSConfigFails(t *testing.T) {
	clearEnv()
	os.Setenv("TLS_CERT", "/path/to/cert.pem")
	// TLS_KEY and TLS_CLIENT_CA are not set
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for partial TLS configuration")
	}
	clearEnv()
}

func TestAllTLSFieldsSetSucceeds(t *testing.T) {
	clearEnv()
	os.Setenv("TLS_CERT", "/path/to/cert.pem")
	os.Setenv("TLS_KEY", "/path/to/key.pem")
	os.Setenv("TLS_CLIENT_CA", "/path/to/ca.pem")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error with all TLS fields set: %v", err)
	}
	if cfg.TLSCert != "/path/to/cert.pem" {
		t.Errorf("expected TLSCert /path/to/cert.pem, got %q", cfg.TLSCert)
	}
	clearEnv()
}

func TestValidateEmptyListenAddr(t *testing.T) {
	cfg := &Config{
		ListenAddr:       "",
		CaddyAdminSocket: "/run/caddy/admin.sock",
		SQLitePath:       "/tmp/test.db",
		WGInterface:      "wg0",
		WGSubnet:         "10.0.0.0/24",
		WGServerIP:       "10.0.0.1",
		LogLevel:         "info",
		ReconcileInterval: 30e9,
	}
	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected validation error for empty ListenAddr")
	}
}
