# Proxy Manager — Architecture

## Overview

Proxy Manager is a two-component system for managing L4 traffic forwarding through VPS instances over WireGuard tunnels.

1. **VPS Image** — Minimal Debian 12 image running Caddy-L4 + WireGuard + UFW + a Go control plane API with persistent config and reconciliation loop.
2. **Web Dashboard** — Bun monorepo (Hono backend + Vite/React/shadcn/ui frontend) for managing VPS instances, tunnels, firewall rules, and L4 forwarding.

## Traffic Flow

```
Internet Client (TLS :443, SNI visible)
    │
    ▼
VPS Public IP :443
    │
    ▼
Caddy L4 (reads SNI from ClientHello, does NOT terminate TLS)
    │ SNI match → proxy to 10.0.0.X:PORT
    ▼
WireGuard interface wg0 (kernel-level, 10.0.0.1/24)
    │ encrypted UDP :51820
    ▼
User's Machine (peer, e.g. 10.0.0.2)
    │ WireGuard client running
    ▼
User's Service (Nginx, app server, etc.) terminates TLS end-to-end
```

Caddy L4 never terminates TLS — it reads the SNI from the ClientHello without decrypting the payload, then proxies the raw TCP stream over the WireGuard tunnel. The TLS handshake completes end-to-end between the internet client and the user's service. This is effectively a self-hosted Cloudflare Tunnel.

## Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                       Internet                          │
└────────────┬───────────────────────────────┬────────────┘
             │ TLS :443                      │ UDP :51820
             ▼                               ▼
┌────────────────────────────────────────────────────────┐
│  VPS (Debian 12 Minimal, Packer-built image)           │
│                                                        │
│  ┌──────────────────────────────────────────────┐      │
│  │  Caddy L4 (xcaddy + caddy-l4)               │      │
│  │  :443 → SNI match → proxy 10.0.0.X:PORT     │      │
│  │  Admin: unix:///run/caddy/admin.sock (0660)  │      │
│  └──────────────────────┬───────────────────────┘      │
│                         │                              │
│  ┌──────────────────────▼───────────────────────┐      │
│  │  WireGuard wg0 (10.0.0.1/24, kernel module)  │      │
│  │  Managed live by wgctrl-go, no file edits     │      │
│  └──────────────────────┬───────────────────────┘      │
│                         │                              │
│  ┌──────────────────────▼───────────────────────┐      │
│  │  Control Plane API (Go, single static binary) │      │
│  │  :7443 mTLS │ SQLite config store             │      │
│  │  Reconciliation loop (configurable, 30s)      │      │
│  │  Manages: Caddy + WireGuard + nftables        │      │
│  └──────────────────────────────────────────────┘      │
│                                                        │
│  UFW (static baseline) + nftables dynamic chain        │
└────────────────────────────────────────────────────────┘
             │ WireGuard encrypted tunnel
             ▼
┌──────────────────────┐  ┌──────────────────────┐
│  Peer A (10.0.0.2)   │  │  Peer B (10.0.0.3)   │
│  User's service :443 │  │  User's service :443 │
└──────────────────────┘  └──────────────────────┘


┌────────────────────────────────────────────────────────┐
│  Web Dashboard (deployed separately)                   │
│                                                        │
│  ┌────────────────────┐  ┌─────────────────────────┐  │
│  │  Vite + React SPA  │  │  Hono API (BFF)         │  │
│  │  shadcn/ui         │←→│  SQLite (Drizzle ORM)   │  │
│  │  TanStack Query    │  │  mTLS client → VPS APIs │  │
│  │  Zustand           │  │  SSE for live updates    │  │
│  └────────────────────┘  └─────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

## Documentation Index

| Document | Description |
|---|---|
| [VPS Image](./vps-image.md) | Base OS, Packer build, provisioning scripts, file layout |
| [Control Plane API](./control-plane-api.md) | Go API surface, auth, systemd service, privilege model |
| [Caddy L4](./caddy-l4.md) | Caddy binary build, L4 config, admin API usage |
| [WireGuard](./wireguard.md) | Tunnel setup, key management, peer lifecycle, key distribution |
| [Firewall](./firewall.md) | UFW baseline, dynamic nftables chain, rules management |
| [Reconciliation](./reconciliation.md) | Config persistence, drift detection, correction loop |
| [Web Dashboard](./web-dashboard.md) | Bun monorepo, Hono backend, React frontend, project structure |
| [CI/CD](./cicd.md) | GitHub Actions pipelines for image builds and app deployment |

## Key Design Principles

1. **SQLite on VPS is the source of truth** — not Caddy's runtime state, not nftables, not WireGuard. The reconciliation loop enforces this.
2. **Private keys never leave the device that generated them** — VPS keys generated at boot, user keys generated once and delivered or generated client-side.
3. **BFF pattern** — the dashboard never talks to VPS instances directly. Hono backend holds mTLS certs and proxies requests.
4. **Dual firewall strategy** — UFW for static baseline (never touched by API), dedicated nftables chain for dynamic rules (no conflict).
5. **Zero-downtime operations** — Caddy admin API, wgctrl-go, and nftables netlink all support live changes without restarts.
6. **Minimal image** — single Go binary for the control plane, xcaddy-built Caddy binary, WireGuard kernel module. No interpreters, no runtimes.
