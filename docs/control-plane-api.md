# Control Plane API

## Overview

A single Go static binary that runs on each VPS instance. It is the sole management interface for Caddy L4, WireGuard, and dynamic firewall rules. SQLite is the source of truth; the reconciliation loop enforces desired state.

## Technology

- **Language:** Go (single static binary, no runtime dependencies)
- **HTTP framework:** `net/http` stdlib (sufficient for this API surface)
- **WireGuard management:** `golang.zx2c4.com/wireguard/wgctrl` (official Go library, kernel netlink)
- **Firewall management:** `github.com/google/nftables` (typed Go API, netlink, no shell commands)
- **Caddy management:** HTTP client to Caddy admin Unix socket
- **Database:** SQLite via `modernc.org/sqlite` (pure Go, no CGO)
- **TLS:** `crypto/tls` stdlib with mTLS

## API Surface

### Tunnel Management

```
POST   /api/v1/tunnels              # Create tunnel (generate keys + add WG peer + allocate IP)
GET    /api/v1/tunnels              # List all peers (pubkey, VPN IP, last handshake, tx/rx bytes)
DELETE /api/v1/tunnels/{id}         # Revoke peer + remove associated Caddy routes
GET    /api/v1/tunnels/{id}/config  # One-time config download (.conf file)
GET    /api/v1/tunnels/{id}/qr     # One-time QR code PNG
POST   /api/v1/tunnels/{id}/rotate           # Manual rotation, returns new config + QR (starts grace period)
PATCH  /api/v1/tunnels/{id}/rotation-policy  # Update per-tunnel rotation settings
GET    /api/v1/tunnels/{id}/rotation-policy  # Read current rotation settings
```

### L4 Route Management

```
POST   /api/v1/routes              # Add L4 route (SNI → WireGuard peer IP:port)
GET    /api/v1/routes              # List all active L4 routes
DELETE /api/v1/routes/{id}         # Remove L4 route
```

### Firewall Management

```
POST   /api/v1/firewall/rules      # Open a port/CIDR in the dynamic nftables chain
GET    /api/v1/firewall/rules      # List all dynamic firewall rules
DELETE /api/v1/firewall/rules/{id} # Close a port
```

### System

```
GET    /api/v1/server/pubkey       # VPS WireGuard public key (for client-side keygen flow)
GET    /api/v1/status              # Full state: caddy config + WG peers + firewall + reconciliation health
POST   /api/v1/reconcile           # Force immediate reconciliation
GET    /api/v1/health              # Liveness check (unauthenticated, localhost-only)
```

## Authentication

**mTLS (TLS 1.3 only).** Client certificates issued by a private CA.

```go
tlsConfig := &tls.Config{
    ClientAuth: tls.RequireAndVerifyClientCert,
    ClientCAs:  clientCACertPool,
    MinVersion: tls.VersionTLS13,
}
```

- The `/api/v1/health` endpoint is exempt from mTLS, bound to localhost only.
- Client certificates are issued per dashboard instance or per operator.
- Certificates can be revoked and have built-in expiry.

## Privilege Model

The control plane runs as an unprivileged user with exactly one elevated capability:

```ini
[Service]
User=controlplane
Group=caddy                         # For Caddy admin socket access
AmbientCapabilities=CAP_NET_ADMIN   # For nftables + WireGuard netlink
CapabilityBoundingSet=CAP_NET_ADMIN
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/controlplane /run/caddy
PrivateTmp=true
```

- **Caddy admin socket:** Access via group membership (controlplane user is in caddy group, socket is 0660)
- **nftables:** Requires `CAP_NET_ADMIN`
- **WireGuard (wgctrl-go):** Requires `CAP_NET_ADMIN`

## Request/Response Schemas

### POST /api/v1/tunnels

Request:
```json
{
  "public_key": "optional — if omitted, server generates keypair",
  "domains": ["app.example.com", "*.app.example.com"],
  "upstream_port": 443
}
```

Response (server-generated keys):
```json
{
  "id": "tun_abc123",
  "vpn_ip": "10.0.0.2",
  "config": "[Interface]\nPrivateKey = ...\nAddress = 10.0.0.2/32\n...",
  "qr_code_url": "/api/v1/tunnels/tun_abc123/qr",
  "server_public_key": "...",
  "warning": "Save this config now. The private key will not be available again."
}
```

Response (user-provided public key):
```json
{
  "id": "tun_abc123",
  "vpn_ip": "10.0.0.2",
  "server_public_key": "...",
  "server_endpoint": "203.0.113.1:51820",
  "preshared_key": "... (shown once)"
}
```

### POST /api/v1/routes

Request:
```json
{
  "tunnel_id": "tun_abc123",
  "match_type": "sni",
  "match_value": ["app.example.com"],
  "upstream_port": 443
}
```

The `upstream` is derived from the tunnel's VPN IP + the specified port. Example: tunnel `tun_abc123` has VPN IP `10.0.0.2`, so the Caddy L4 upstream becomes `10.0.0.2:443`.

Response:
```json
{
  "id": "route_xyz789",
  "tunnel_id": "tun_abc123",
  "match_type": "sni",
  "match_value": ["app.example.com"],
  "upstream": "10.0.0.2:443",
  "status": "active"
}
```

### PATCH /api/v1/tunnels/{id}/rotation-policy

Request (all fields optional, partial update):
```json
{
  "auto_rotate_psk": true,
  "psk_rotation_interval_days": 90,
  "auto_revoke_inactive": true,
  "inactive_expiry_days": 90,
  "grace_period_minutes": 30
}
```

Response:
```json
{
  "tunnel_id": "tun_abc123",
  "auto_rotate_psk": true,
  "psk_rotation_interval_days": 90,
  "auto_revoke_inactive": true,
  "inactive_expiry_days": 90,
  "grace_period_minutes": 30,
  "last_rotation_at": "2026-01-15T10:00:00Z",
  "next_rotation_at": "2026-04-15T10:00:00Z"
}
```

Notes:
- `auto_rotate_psk` is `false` by default — rotation causes tunnel downtime until the user re-imports config
- When a rotation occurs (manual or scheduled), the old peer remains active for `grace_period_minutes` so the user has time to download and re-import the new config
- `auto_revoke_inactive` deletes peers that haven't handshaked in `inactive_expiry_days` — no new config is generated, the tunnel is simply removed

### POST /api/v1/firewall/rules

Request:
```json
{
  "port": 8080,
  "proto": "tcp",
  "source_cidr": "0.0.0.0/0",
  "action": "allow"
}
```

Response:
```json
{
  "id": "fw_rule_001",
  "port": 8080,
  "proto": "tcp",
  "source_cidr": "0.0.0.0/0",
  "action": "allow",
  "status": "active"
}
```

### GET /api/v1/status

Response:
```json
{
  "tunnels": {
    "total": 5,
    "connected": 3,
    "peers": [
      {
        "id": "tun_abc123",
        "vpn_ip": "10.0.0.2",
        "last_handshake": "2026-02-23T12:00:00Z",
        "tx_bytes": 1048576,
        "rx_bytes": 2097152,
        "connected": true
      }
    ]
  },
  "routes": {
    "total": 4,
    "routes": [...]
  },
  "firewall": {
    "dynamic_rules": 2,
    "rules": [...]
  },
  "reconciliation": {
    "interval_seconds": 30,
    "last_run_at": "2026-02-23T12:00:30Z",
    "last_status": "ok",
    "last_error": null,
    "drift_corrections_total": 12
  }
}
```

## Input Validation

All inputs are strictly validated before any operation:

- **Port numbers:** integer, range 1–65535, reject reserved management ports (22, 2019, 7443)
- **SNI values:** valid FQDN regex `^[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,252}[a-zA-Z0-9]$`
- **Protocols:** exactly `"tcp"` or `"udp"`, never interpolated into shell
- **CIDRs:** parsed via `net.ParseCIDR`, reject invalid ranges
- **Public keys:** valid base64, 32 bytes when decoded
- **Upstream addresses:** must resolve to WireGuard subnet (10.0.0.0/24) — prevents SSRF

## Audit Logging

Every mutation (POST, DELETE) is logged with:
- Timestamp
- Client certificate CN (identity)
- Source IP
- HTTP method + path
- Request body hash
- Result (success/error)

Logs are written to stdout (captured by journald) and optionally forwarded to remote syslog over TLS.

## Go Project Structure

```
controlplane/
├── cmd/
│   └── controlplane/
│       └── main.go              # Entry point, config loading, server startup
├── internal/
│   ├── api/
│   │   ├── router.go            # HTTP mux setup
│   │   ├── middleware.go         # Logging, audit, rate limiting
│   │   ├── tunnels.go           # Tunnel handlers
│   │   ├── routes.go            # L4 route handlers
│   │   ├── firewall.go          # Firewall rule handlers
│   │   └── system.go            # Health, status, reconcile handlers
│   ├── caddy/
│   │   └── client.go            # Caddy admin API client (Unix socket)
│   ├── wireguard/
│   │   └── manager.go           # wgctrl-go wrapper (AddPeer, RemovePeer, ListPeers)
│   ├── firewall/
│   │   └── nftables.go          # google/nftables wrapper (dynamic chain management)
│   ├── reconciler/
│   │   └── reconciler.go        # Reconciliation loop (diff + correct)
│   ├── store/
│   │   ├── db.go                # SQLite connection + migrations
│   │   ├── tunnels.go           # Tunnel CRUD
│   │   ├── routes.go            # Route CRUD
│   │   └── firewall.go          # Firewall rule CRUD
│   └── config/
│       └── config.go            # Typed config from environment
├── go.mod
├── go.sum
└── Makefile
```

## Dependencies

```
golang.zx2c4.com/wireguard/wgctrl    # WireGuard kernel control
github.com/google/nftables            # nftables netlink
modernc.org/sqlite                    # Pure Go SQLite (no CGO)
github.com/skip2/go-qrcode           # QR code generation
```
