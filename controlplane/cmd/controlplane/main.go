package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/proxy-manager/controlplane/internal/api"
	"github.com/proxy-manager/controlplane/internal/caddy"
	"github.com/proxy-manager/controlplane/internal/config"
	"github.com/proxy-manager/controlplane/internal/firewall"
	"github.com/proxy-manager/controlplane/internal/reconciler"
	"github.com/proxy-manager/controlplane/internal/store"
	"github.com/proxy-manager/controlplane/internal/wireguard"
)

func main() {
	// Load configuration from environment
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Configure log level
	var logLevel slog.Level
	switch cfg.LogLevel {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})))

	slog.Info("starting control plane",
		"listen_addr", cfg.ListenAddr,
		"sqlite_path", cfg.SQLitePath,
		"reconcile_interval", cfg.ReconcileInterval,
		"wg_interface", cfg.WGInterface,
	)

	// Initialize SQLite database
	db, err := store.New(cfg.SQLitePath)
	if err != nil {
		slog.Error("failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	tunnelStore := store.NewTunnelStore(db)
	routeStore := store.NewRouteStore(db)
	fwStore := store.NewFirewallStore(db)

	// Initialize Caddy admin client
	caddyClient := caddy.NewHTTPClient(cfg.CaddyAdminSocket)

	// Initialize WireGuard manager
	wgClient := wireguard.NewRealWGClient()
	wgManager := wireguard.NewManager(cfg.WGInterface, wgClient)

	// Initialize firewall manager
	nftConn := firewall.NewRealNFTConn()
	fwManager := firewall.NewManager(nftConn)

	// Initialize nftables dynamic chain
	if err := fwManager.Init(); err != nil {
		slog.Warn("failed to initialize nftables chain (may require CAP_NET_ADMIN)", "error", err)
	}

	// Initialize reconciler
	rec := reconciler.New(tunnelStore, routeStore, fwStore, caddyClient, wgManager, fwManager, cfg.ReconcileInterval)

	// Create API server
	srv := api.NewServer(cfg, tunnelStore, routeStore, fwStore, caddyClient, wgManager, fwManager, rec)

	// Configure TLS
	tlsConfig, err := api.NewTLSConfig(cfg)
	if err != nil {
		slog.Error("failed to configure TLS", "error", err)
		os.Exit(1)
	}

	httpServer := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      srv.Handler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	if tlsConfig != nil {
		httpServer.TLSConfig = tlsConfig
	}

	// Start reconciliation loop in background
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go rec.Run(ctx)

	// Start HTTP server
	go func() {
		var err error
		if httpServer.TLSConfig != nil {
			slog.Info("starting HTTPS server with mTLS", "addr", cfg.ListenAddr)
			err = httpServer.ListenAndServeTLS("", "")
		} else {
			slog.Info("starting HTTP server (no TLS configured)", "addr", cfg.ListenAddr)
			err = httpServer.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit

	slog.Info("shutting down", "signal", sig)
	cancel() // Stop reconciler

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		slog.Error("HTTP server shutdown error", "error", err)
	}

	slog.Info("control plane stopped")
}
