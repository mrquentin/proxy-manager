# Reconciliation Loop

## Purpose

The reconciliation loop is the core reliability mechanism. It ensures that the actual runtime state of the VPS (Caddy L4 routes, WireGuard peers, nftables rules) always matches the desired state stored in SQLite. This handles:

- **Caddy restarts** — Caddy loads an empty config on restart (persistence is disabled). The reconciler restores all L4 routes.
- **Manual interference** — If someone runs `wg` or `nft` commands outside the API, the reconciler corrects the drift.
- **Partial failures** — If an API call added a WireGuard peer but Caddy route creation failed, the reconciler completes the operation.
- **VPS reboot** — All state is restored from SQLite after boot.

## Source of Truth

**SQLite at `/var/lib/controlplane/config.db` is the single source of truth.** Not Caddy's runtime config, not WireGuard's kernel state, not nftables. If they disagree, SQLite wins.

## Schema

```sql
-- L4 forwarding routes
CREATE TABLE l4_routes (
    id          TEXT PRIMARY KEY,
    tunnel_id   TEXT NOT NULL REFERENCES wg_peers(id),
    listen_port INTEGER NOT NULL DEFAULT 443,
    match_type  TEXT NOT NULL DEFAULT 'sni',
    match_value TEXT NOT NULL,  -- JSON array of domains: ["app.example.com"]
    upstream    TEXT NOT NULL,  -- "10.0.0.2:443"
    caddy_id    TEXT NOT NULL,  -- @id in Caddy config: "route-{tunnel_id}-{port}"
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- Dynamic firewall rules
CREATE TABLE firewall_rules (
    id          TEXT PRIMARY KEY,
    port        INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    proto       TEXT NOT NULL CHECK (proto IN ('tcp', 'udp')),
    direction   TEXT NOT NULL DEFAULT 'in',
    source_cidr TEXT NOT NULL DEFAULT '0.0.0.0/0',
    action      TEXT NOT NULL DEFAULT 'allow',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- WireGuard peers
CREATE TABLE wg_peers (
    id              TEXT PRIMARY KEY,
    public_key      TEXT NOT NULL UNIQUE,
    vpn_ip          TEXT NOT NULL UNIQUE,
    psk_hash        TEXT,          -- bcrypt hash of PSK (for audit, not for use)
    endpoint        TEXT,          -- last known endpoint IP:port (updated from kernel)
    domains         TEXT,          -- JSON array of associated domains
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_handshake  INTEGER,       -- unix timestamp, updated from kernel
    tx_bytes        INTEGER DEFAULT 0,
    rx_bytes        INTEGER DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- Reconciliation state
CREATE TABLE reconciliation_state (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    interval_seconds    INTEGER NOT NULL DEFAULT 30,
    last_run_at         INTEGER,
    last_status         TEXT DEFAULT 'pending',  -- 'ok' | 'drift_corrected' | 'error'
    last_error          TEXT,
    drift_corrections   INTEGER DEFAULT 0,
    CHECK (id = 1)  -- singleton row
);

-- Audit log
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    client_cn   TEXT,
    source_ip   TEXT,
    method      TEXT NOT NULL,
    path        TEXT NOT NULL,
    body_hash   TEXT,
    result      TEXT NOT NULL,  -- 'ok' | 'error'
    error_msg   TEXT
);
```

## Loop Algorithm

```
ticker := time.NewTicker(config.ReconcileInterval)

for range ticker.C {
    reconcile()
}

func reconcile() {
    startTime := time.Now()

    // 1. READ desired state from SQLite
    desiredRoutes   := store.ListEnabledRoutes()
    desiredPeers    := store.ListEnabledPeers()
    desiredFwRules  := store.ListEnabledFirewallRules()

    // 2. READ actual state from runtime systems
    actualCaddyConfig := caddy.GetL4Config()     // GET unix socket /config/apps/layer4
    actualWgPeers     := wireguard.ListPeers()   // wgctrl-go Device().Peers
    actualFwRules     := firewall.ListRules()     // nftables conn.GetRules()

    // 3. DIFF each system
    caddyDrift := diffCaddyRoutes(desiredRoutes, actualCaddyConfig)
    wgDrift    := diffWireGuardPeers(desiredPeers, actualWgPeers)
    fwDrift    := diffFirewallRules(desiredFwRules, actualFwRules)

    driftDetected := len(caddyDrift) > 0 || len(wgDrift) > 0 || len(fwDrift) > 0

    // 4. CORRECT drift
    if driftDetected {
        // Caddy: add missing routes, remove extra routes
        for _, op := range caddyDrift {
            switch op.Type {
            case "add":
                caddy.AddRoute(op.Route)
            case "remove":
                caddy.DeleteRoute(op.CaddyID)
            case "update":
                caddy.DeleteRoute(op.CaddyID)
                caddy.AddRoute(op.Route)
            }
        }

        // WireGuard: add missing peers, remove extra peers
        for _, op := range wgDrift {
            switch op.Type {
            case "add":
                wireguard.AddPeer(op.PublicKey, op.PSK, op.VPNIP)
            case "remove":
                wireguard.RemovePeer(op.PublicKey)
            }
        }

        // Firewall: add missing rules, remove extra rules
        for _, op := range fwDrift {
            switch op.Type {
            case "add":
                firewall.AllowPort(op.Port, op.Proto)
            case "remove":
                firewall.DeleteRule(op.Rule)
            }
        }

        log.Info("drift corrected",
            "caddy_ops", len(caddyDrift),
            "wg_ops", len(wgDrift),
            "fw_ops", len(fwDrift),
            "duration", time.Since(startTime))

        store.UpdateReconciliationState("drift_corrected", nil, len(caddyDrift)+len(wgDrift)+len(fwDrift))
    } else {
        store.UpdateReconciliationState("ok", nil, 0)
    }

    // 5. UPDATE peer stats from kernel (always, even if no drift)
    for _, peer := range actualWgPeers {
        store.UpdatePeerStats(peer.PublicKey, peer.LastHandshakeTime, peer.ReceiveBytes, peer.TransmitBytes)
    }
}
```

## Diff Logic

### Caddy Routes

Compare by `caddy_id` (the `@id` field):
- **Missing:** exists in SQLite but not in Caddy → add
- **Extra:** exists in Caddy but not in SQLite → remove
- **Modified:** exists in both but config differs (different SNI, different upstream) → update

### WireGuard Peers

Compare by `public_key`:
- **Missing:** exists in SQLite but not in kernel → add peer
- **Extra:** exists in kernel but not in SQLite → remove peer
- **Note:** WireGuard peer config is immutable except for PSK. If PSK needs rotation, it's handled by the `/rotate` endpoint, not the reconciler.

### Firewall Rules

Compare by a composite key of `(port, proto, direction, source_cidr, action)`:
- **Missing:** exists in SQLite but not in nftables → add rule
- **Extra:** exists in nftables dynamic chain but not in SQLite → remove rule

## Configuration

Via environment variables in `/etc/controlplane/config.env`:

```bash
RECONCILE_INTERVAL=30     # seconds between reconciliation runs (default: 30)
```

The interval is also stored in SQLite `reconciliation_state.interval_seconds` and can be updated via the API:

```
PATCH /api/v1/config/reconciliation
{ "interval_seconds": 60 }
```

Changes take effect on the next tick.

## Force Reconciliation

The API exposes `POST /api/v1/reconcile` to trigger an immediate reconciliation outside the timer. Use cases:
- After applying bulk changes via the API
- Dashboard "Sync Now" button
- Debugging / verification

## Status Reporting

`GET /api/v1/status` includes:

```json
{
  "reconciliation": {
    "interval_seconds": 30,
    "last_run_at": "2026-02-23T12:00:30Z",
    "last_status": "ok",
    "last_error": null,
    "drift_corrections_total": 12
  }
}
```

Possible statuses:
- `ok` — no drift detected
- `drift_corrected` — drift found and corrected
- `error` — reconciliation failed (details in `last_error`)
- `pending` — never run yet (fresh boot)

## Error Handling

- If one system fails (e.g., Caddy admin socket is down), the reconciler logs the error and continues with the other systems.
- Errors are recorded in `reconciliation_state.last_error` and surfaced via the status API.
- The reconciler does not retry within the same tick — it waits for the next interval.
- Persistent errors trigger an exponential backoff on the failing system only (not the entire loop).

## Boot Sequence

On first start after a VPS boot:

1. Control plane starts, opens SQLite
2. Runs an immediate reconciliation (before the first timer tick)
3. This restores all Caddy routes, WireGuard peers, and firewall rules from the persisted state
4. Timer begins ticking at the configured interval
