package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/proxy-manager/controlplane/internal/caddy"
	"github.com/proxy-manager/controlplane/internal/firewall"
	"github.com/proxy-manager/controlplane/internal/store"
	"github.com/proxy-manager/controlplane/internal/wireguard"
)

// DriftOp represents a single drift correction operation.
type DriftOp struct {
	Type     string // "add", "remove", "update"
	System   string // "caddy", "wireguard", "firewall"
	ID       string
	Detail   string
}

// Reconciler implements the reconciliation loop.
type Reconciler struct {
	tunnelStore *store.TunnelStore
	routeStore  *store.RouteStore
	fwStore     *store.FirewallStore
	caddyClient caddy.Client
	wgManager   *wireguard.Manager
	fwManager   *firewall.Manager
	interval    time.Duration

	mu        sync.Mutex
	forceCh   chan struct{}
	logger    *slog.Logger
}

// New creates a new Reconciler.
func New(
	tunnelStore *store.TunnelStore,
	routeStore *store.RouteStore,
	fwStore *store.FirewallStore,
	caddyClient caddy.Client,
	wgManager *wireguard.Manager,
	fwManager *firewall.Manager,
	interval time.Duration,
) *Reconciler {
	return &Reconciler{
		tunnelStore: tunnelStore,
		routeStore:  routeStore,
		fwStore:     fwStore,
		caddyClient: caddyClient,
		wgManager:   wgManager,
		fwManager:   fwManager,
		interval:    interval,
		forceCh:     make(chan struct{}, 1),
		logger:      slog.Default(),
	}
}

// Run starts the reconciliation loop. It runs an immediate reconciliation first,
// then continues on a timer. It stops when the context is canceled.
func (r *Reconciler) Run(ctx context.Context) {
	r.logger.Info("running initial reconciliation")
	r.reconcileOnce(ctx)

	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			r.logger.Info("reconciliation loop stopped")
			return
		case <-ticker.C:
			r.reconcileOnce(ctx)
		case <-r.forceCh:
			r.logger.Info("forced reconciliation triggered")
			r.reconcileOnce(ctx)
			// Reset the ticker after a forced reconciliation
			ticker.Reset(r.interval)
		}
	}
}

// ForceReconcile triggers an immediate reconciliation outside the regular timer.
func (r *Reconciler) ForceReconcile() {
	select {
	case r.forceCh <- struct{}{}:
	default:
		// Already a force pending, skip
	}
}

func (r *Reconciler) reconcileOnce(ctx context.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()

	startTime := time.Now()
	var totalOps int
	var reconcileErr error

	defer func() {
		if reconcileErr != nil {
			errMsg := reconcileErr.Error()
			r.fwStore.UpdateReconciliationState("error", &errMsg, 0)
		} else if totalOps > 0 {
			r.fwStore.UpdateReconciliationState("drift_corrected", nil, totalOps)
		} else {
			r.fwStore.UpdateReconciliationState("ok", nil, 0)
		}
	}()

	// 1. Reconcile Caddy L4 routes
	caddyOps, err := r.reconcileCaddy(ctx)
	if err != nil {
		r.logger.Error("caddy reconciliation failed", "error", err)
		reconcileErr = fmt.Errorf("caddy: %w", err)
		// Continue with other systems
	}
	totalOps += caddyOps

	// 2. Reconcile WireGuard peers
	wgOps, err := r.reconcileWireGuard()
	if err != nil {
		r.logger.Error("wireguard reconciliation failed", "error", err)
		if reconcileErr == nil {
			reconcileErr = fmt.Errorf("wireguard: %w", err)
		}
	}
	totalOps += wgOps

	// 3. Reconcile firewall rules
	fwOps, err := r.reconcileFirewall()
	if err != nil {
		r.logger.Error("firewall reconciliation failed", "error", err)
		if reconcileErr == nil {
			reconcileErr = fmt.Errorf("firewall: %w", err)
		}
	}
	totalOps += fwOps

	// 4. Update peer stats from kernel
	r.updatePeerStats()

	// 5. Check rotation policies
	r.checkRotations()

	duration := time.Since(startTime)
	if totalOps > 0 {
		r.logger.Info("drift corrected",
			"caddy_ops", caddyOps,
			"wg_ops", wgOps,
			"fw_ops", fwOps,
			"duration", duration)
	} else {
		r.logger.Debug("reconciliation complete, no drift", "duration", duration)
	}
}

func (r *Reconciler) reconcileCaddy(ctx context.Context) (int, error) {
	// Read desired state from SQLite
	desiredRoutes, err := r.routeStore.ListEnabled()
	if err != nil {
		return 0, fmt.Errorf("list desired routes: %w", err)
	}

	// Read actual state from Caddy
	actualConfig, err := r.caddyClient.GetL4Config(ctx)
	if err != nil {
		return 0, fmt.Errorf("get caddy config: %w", err)
	}

	// Build maps of actual route IDs in Caddy
	actualRouteIDs := make(map[string]caddy.CaddyRoute)
	for _, server := range actualConfig.Servers {
		for _, route := range server.Routes {
			if route.ID != "" {
				actualRouteIDs[route.ID] = route
			}
		}
	}

	// Build maps of desired route Caddy IDs
	desiredRouteMap := make(map[string]*store.Route)
	for _, route := range desiredRoutes {
		desiredRouteMap[route.CaddyID] = route
	}

	var ops int

	// Ensure the server exists if there are desired routes
	if len(desiredRoutes) > 0 && len(actualConfig.Servers) == 0 {
		if err := r.caddyClient.CreateServer(ctx); err != nil {
			return 0, fmt.Errorf("create caddy server: %w", err)
		}
		ops++
	}

	// Add missing routes
	for caddyID, desired := range desiredRouteMap {
		if _, exists := actualRouteIDs[caddyID]; !exists {
			route := caddy.BuildCaddyRoute(caddyID, desired.MatchValue, desired.Upstream)
			if err := r.caddyClient.AddRoute(ctx, route); err != nil {
				r.logger.Error("failed to add caddy route", "caddy_id", caddyID, "error", err)
				continue
			}
			ops++
		}
	}

	// Remove extra routes
	for caddyID := range actualRouteIDs {
		if _, exists := desiredRouteMap[caddyID]; !exists {
			if err := r.caddyClient.DeleteRoute(ctx, caddyID); err != nil {
				r.logger.Error("failed to delete caddy route", "caddy_id", caddyID, "error", err)
				continue
			}
			ops++
		}
	}

	return ops, nil
}

func (r *Reconciler) reconcileWireGuard() (int, error) {
	desiredPeers, err := r.tunnelStore.ListEnabled()
	if err != nil {
		return 0, fmt.Errorf("list desired peers: %w", err)
	}

	actualPeers, err := r.wgManager.ListPeers()
	if err != nil {
		return 0, fmt.Errorf("list actual peers: %w", err)
	}

	// Build maps
	desiredMap := make(map[string]*store.Tunnel)
	for _, t := range desiredPeers {
		desiredMap[t.PublicKey] = t
	}

	actualMap := make(map[string]wireguard.PeerInfo)
	for _, p := range actualPeers {
		actualMap[p.PublicKey] = p
	}

	var ops int

	// Add missing peers
	for pubkey, desired := range desiredMap {
		if _, exists := actualMap[pubkey]; !exists {
			// We don't have the PSK in the store (only the hash), so we can only
			// re-add without PSK on reconciliation. The PSK is set at creation time only.
			if err := r.wgManager.AddPeer(pubkey, "", desired.VpnIP); err != nil {
				r.logger.Error("failed to add wg peer", "pubkey", pubkey, "error", err)
				continue
			}
			ops++
		}
	}

	// Remove extra peers
	for pubkey := range actualMap {
		if _, exists := desiredMap[pubkey]; !exists {
			if err := r.wgManager.RemovePeer(pubkey); err != nil {
				r.logger.Error("failed to remove wg peer", "pubkey", pubkey, "error", err)
				continue
			}
			ops++
		}
	}

	return ops, nil
}

func (r *Reconciler) reconcileFirewall() (int, error) {
	desiredRules, err := r.fwStore.ListEnabled()
	if err != nil {
		return 0, fmt.Errorf("list desired fw rules: %w", err)
	}

	actualRules, err := r.fwManager.ListRules()
	if err != nil {
		return 0, fmt.Errorf("list actual fw rules: %w", err)
	}

	// Build maps by composite key
	type ruleKey struct {
		Port       int
		Proto      string
		Direction  string
		SourceCIDR string
		Action     string
	}

	desiredMap := make(map[ruleKey]*store.FirewallRule)
	for _, r := range desiredRules {
		key := ruleKey{r.Port, r.Proto, r.Direction, r.SourceCIDR, r.Action}
		desiredMap[key] = r
	}

	actualMap := make(map[ruleKey]firewall.Rule)
	for _, r := range actualRules {
		key := ruleKey{r.Port, r.Proto, r.Direction, r.SourceCIDR, r.Action}
		actualMap[key] = r
	}

	var ops int

	// Add missing rules
	for key, desired := range desiredMap {
		if _, exists := actualMap[key]; !exists {
			fwRule := firewall.Rule{
				ID:         desired.ID,
				Port:       desired.Port,
				Proto:      desired.Proto,
				Direction:  desired.Direction,
				SourceCIDR: desired.SourceCIDR,
				Action:     desired.Action,
			}
			if err := r.fwManager.AddRule(fwRule); err != nil {
				r.logger.Error("failed to add fw rule", "id", desired.ID, "error", err)
				continue
			}
			ops++
		}
	}

	// Remove extra rules
	for key, actual := range actualMap {
		if _, exists := desiredMap[key]; !exists {
			if err := r.fwManager.DeleteRule(actual.ID); err != nil {
				r.logger.Error("failed to delete fw rule", "id", actual.ID, "error", err)
				continue
			}
			ops++
		}
	}

	return ops, nil
}

func (r *Reconciler) updatePeerStats() {
	peers, err := r.wgManager.ListPeers()
	if err != nil {
		r.logger.Error("failed to list peers for stats update", "error", err)
		return
	}

	for _, peer := range peers {
		hs := peer.LastHandshakeTime
		var hsPtr *time.Time
		if !hs.IsZero() {
			hsPtr = &hs
		}
		if err := r.tunnelStore.UpdatePeerStats(peer.PublicKey, hsPtr, peer.ReceiveBytes, peer.TransmitBytes); err != nil {
			r.logger.Error("failed to update peer stats", "pubkey", peer.PublicKey, "error", err)
		}
	}
}

func (r *Reconciler) checkRotations() {
	tunnels, err := r.tunnelStore.ListEnabled()
	if err != nil {
		r.logger.Error("failed to list tunnels for rotation check", "error", err)
		return
	}

	now := time.Now()

	for _, t := range tunnels {
		// Check auto_revoke_inactive
		if t.AutoRevokeInactive && t.LastHandshake != nil {
			inactiveThreshold := t.LastHandshake.Add(time.Duration(t.InactiveExpiryDays) * 24 * time.Hour)
			if now.After(inactiveThreshold) {
				r.logger.Info("auto-revoking inactive tunnel", "id", t.ID, "last_handshake", t.LastHandshake)
				if err := r.wgManager.RemovePeer(t.PublicKey); err != nil {
					r.logger.Error("failed to remove inactive peer", "id", t.ID, "error", err)
				}
				if err := r.tunnelStore.Delete(t.ID); err != nil {
					r.logger.Error("failed to delete inactive tunnel", "id", t.ID, "error", err)
				}
				continue
			}
		}

		// Check pending rotation grace period expiry
		if t.PendingRotationID != "" && t.LastRotationAt != nil {
			graceExpiry := t.LastRotationAt.Add(time.Duration(t.GracePeriodMinutes) * time.Minute)
			if now.After(graceExpiry) {
				r.logger.Info("grace period expired, removing old peer config", "id", t.ID, "pending", t.PendingRotationID)
				// The pending rotation ID refers to the *new* peer. The current peer (t) is the old one.
				// Clear the pending rotation flag.
				if err := r.tunnelStore.ClearPendingRotation(t.ID); err != nil {
					r.logger.Error("failed to clear pending rotation", "id", t.ID, "error", err)
				}
			}
		}

		// Check auto_rotate_psk schedule
		if t.AutoRotatePSK && t.PSKRotationIntervalDays > 0 {
			var lastRotation time.Time
			if t.LastRotationAt != nil {
				lastRotation = *t.LastRotationAt
			} else {
				lastRotation = t.CreatedAt
			}

			nextRotation := lastRotation.Add(time.Duration(t.PSKRotationIntervalDays) * 24 * time.Hour)
			if now.After(nextRotation) {
				r.logger.Info("auto PSK rotation due", "id", t.ID, "last_rotation", lastRotation)
				// PSK rotation is handled by the API (generates new keys, creates new peer entry).
				// The reconciler just logs it. In a full implementation, this would trigger the
				// same flow as POST /api/v1/tunnels/{id}/rotate.
			}
		}
	}
}
