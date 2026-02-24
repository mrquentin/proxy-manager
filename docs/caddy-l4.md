# Caddy L4

## Overview

Caddy is used as a Layer 4 (TCP/UDP) proxy via the `mholt/caddy-l4` community module. It reads the SNI from TLS ClientHello messages and forwards the raw TCP stream to the appropriate WireGuard peer without terminating TLS.

## Building the Binary

The L4 module is not included in the official Caddy binary. Build a custom binary using `xcaddy`:

```bash
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

xcaddy build \
  --with github.com/mholt/caddy-l4

sudo mv caddy /usr/bin/caddy
sudo chmod 755 /usr/bin/caddy
sudo setcap 'cap_net_bind_service=+ep' /usr/bin/caddy
```

This is done during image build (Packer provisioner). Go is removed after the build — not needed at runtime.

## Base Configuration

The image ships with an empty L4 config. Routes are added dynamically by the control plane API.

`/etc/caddy/caddy.json`:
```json
{
  "admin": {
    "listen": "unix//run/caddy/admin.sock|0660",
    "config": {
      "persist": false
    }
  },
  "apps": {
    "layer4": {
      "servers": {}
    }
  }
}
```

Key settings:
- **Admin socket:** Unix socket at `/run/caddy/admin.sock`, mode `0660`, group `caddy`. No TCP port exposed.
- **Persist disabled:** Caddy does not write config to disk. SQLite is the source of truth; the reconciler restores config on restart.

## Admin API Usage

The control plane API communicates with Caddy via the Unix socket. All operations are zero-downtime — Caddy validates new config before applying, and rolls back on failure.

### Create or Update the L4 Server

When the first route is added, the control plane creates the server:

```bash
curl --unix-socket /run/caddy/admin.sock \
  -X POST http://localhost/config/apps/layer4/servers/proxy \
  -H "Content-Type: application/json" \
  -d '{
    "listen": ["0.0.0.0:443"],
    "@id": "l4-main",
    "routes": []
  }'
```

### Add a Route

Each route uses an `@id` for stable addressing:

```bash
curl --unix-socket /run/caddy/admin.sock \
  -X POST http://localhost/config/apps/layer4/servers/proxy/routes \
  -H "Content-Type: application/json" \
  -d '{
    "@id": "route-tun_abc123-443",
    "match": [{"tls": {"sni": ["app.example.com"]}}],
    "handle": [{"handler": "proxy", "upstreams": [{"dial": ["10.0.0.2:443"]}]}]
  }'
```

### Delete a Route

```bash
curl --unix-socket /run/caddy/admin.sock \
  -X DELETE http://localhost/id/route-tun_abc123-443
```

### Read Current Config

```bash
curl --unix-socket /run/caddy/admin.sock \
  http://localhost/config/apps/layer4
```

## Route JSON Structure

Every route managed by the control plane follows this structure:

```json
{
  "@id": "route-{tunnel_id}-{port}",
  "match": [
    {
      "tls": {
        "sni": ["domain1.example.com", "domain2.example.com"]
      }
    }
  ],
  "handle": [
    {
      "handler": "proxy",
      "upstreams": [
        {
          "dial": ["10.0.0.X:PORT"]
        }
      ]
    }
  ]
}
```

### @id Convention

Format: `route-{tunnel_id}-{upstream_port}`

Examples:
- `route-tun_abc123-443` — tunnel abc123, port 443
- `route-tun_abc123-8080` — tunnel abc123, port 8080

The `@id` enables:
- Direct addressing via `/id/{id}` without knowing array index
- Stable references that survive route reordering
- Easy reconciliation (compare IDs in SQLite vs IDs in Caddy config)

## Available L4 Matchers

| Matcher | Use Case |
|---|---|
| `tls` (SNI) | Primary — route by domain name |
| `http` | Detect HTTP traffic (for redirect to HTTPS) |
| `ssh` | Detect SSH protocol |
| `rdp` | Detect RDP protocol |
| `remote_ip` | Route by client IP/CIDR |
| `not` | Logical negation |

For this project, `tls` (SNI matching) is the primary matcher. Others can be added later for protocol multiplexing on port 443.

## Available L4 Handlers

| Handler | Terminal | Use Case |
|---|---|---|
| `proxy` | Yes | Forward to upstream (WireGuard peer) |
| `tls` | No | Terminate TLS (not used — we pass through) |
| `subroute` | No | Nested routing logic |
| `echo` | Yes | Testing only |

## Concurrency Control

The admin API supports ETag-based optimistic concurrency:

1. `GET` returns an `ETag` header
2. Subsequent writes can include `If-Match: "<path> <etag>"`
3. If config changed between read and write, the write is rejected

The control plane should use this for the reconciliation loop to avoid overwriting concurrent API-initiated changes.

## systemd Unit

```ini
[Unit]
Description=Caddy L4 Proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --config /etc/caddy/caddy.json
ExecReload=/usr/bin/caddy reload --config /etc/caddy/caddy.json
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
AmbientCapabilities=CAP_NET_BIND_SERVICE
RuntimeDirectory=caddy
RuntimeDirectoryMode=0755

[Install]
WantedBy=multi-user.target
```
