# Web Dashboard

## Overview

A Bun monorepo with a Hono backend (BFF) and a Vite + React + shadcn/ui frontend. Manages VPS instances, tunnels, firewall rules, and L4 forwarding from a single web interface.

## Stack

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Bun | Fast, native TypeScript, built-in SQLite |
| Monorepo | Bun workspaces | Native feature, shared types, single install |
| Backend | Hono | Runtime-agnostic, superior SSE, mature middleware |
| Frontend | Vite + React 19 | shadcn/ui official target, no SSR overhead |
| UI components | shadcn/ui + TailwindCSS v4 | Component ownership, no version lock-in |
| Database | SQLite via Drizzle ORM (`bun:sqlite`) | Zero-process, upgrade path to PostgreSQL |
| Server state | TanStack Query | Cache, refetch, retry, offline handling |
| Client state | Zustand | Lightweight, no boilerplate |
| Auth | better-auth (passkeys + OAuth + email/password) | Native Hono/Drizzle integration, org plugin, RBAC |
| Real-time | SSE via Hono `streamSSE` | Unidirectional status updates |
| Deploy | Docker multi-stage | Single container, Hono serves static + API |

## Architecture Pattern: BFF (Backend-for-Frontend)

```
Browser ←→ Hono API (BFF) ←→ VPS Control Plane APIs (mTLS)
                ↕
        SQLite (VPS inventory, credentials, audit log)
```

The dashboard **never** talks to VPS instances directly. Hono holds mTLS certificates, validates sessions, applies rate limiting, and handles offline VPS gracefully.

## Project Structure

```
proxy-manager/
├── apps/
│   ├── web/                          # Frontend (Vite + React + shadcn/ui)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ui/              # shadcn/ui (auto-generated)
│   │   │   │   ├── layout/          # Sidebar, Header, AppShell
│   │   │   │   ├── vps/             # VPS cards, status indicators
│   │   │   │   ├── tunnels/         # Tunnel list, create form, config download, QR
│   │   │   │   ├── firewall/        # Firewall rule table, add rule form
│   │   │   │   └── forwarding/      # L4 route table, add route form
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx     # Overview: VPS grid, stats
│   │   │   │   ├── VpsDetail.tsx     # Single VPS: tunnels, routes, rules, reconciliation
│   │   │   │   ├── Tunnels.tsx       # Tunnel management per VPS
│   │   │   │   ├── Firewall.tsx      # Firewall rules per VPS
│   │   │   │   ├── Settings.tsx      # User settings, account
│   │   │   │   └── Login.tsx
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts     # Typed fetch wrapper for Hono backend
│   │   │   │   ├── queries/          # TanStack Query hooks
│   │   │   │   │   ├── vps.ts
│   │   │   │   │   ├── tunnels.ts
│   │   │   │   │   ├── routes.ts
│   │   │   │   │   └── firewall.ts
│   │   │   │   └── store/
│   │   │   │       └── ui.ts         # Zustand: selected VPS, sidebar state, theme
│   │   │   ├── hooks/
│   │   │   │   ├── use-theme.ts      # Theme hook (light/dark/system)
│   │   │   │   ├── use-vps-events.ts # SSE subscription hook
│   │   │   │   └── use-vps-status.ts
│   │   │   ├── router.tsx            # React Router v7
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── components.json           # shadcn/ui config
│   │   └── package.json
│   │
│   └── api/                          # Backend (Hono on Bun)
│       ├── src/
│       │   ├── index.ts              # Entry point, Hono app, serve static in production
│       │   ├── lib/
│       │   │   ├── auth.ts           # better-auth instance (server config)
│       │   │   ├── vps-client.ts     # mTLS HTTP client for VPS APIs
│       │   │   ├── crypto.ts         # Encrypt/decrypt VPS credentials
│       │   │   └── env.ts            # Typed env vars (Zod)
│       │   ├── routes/
│       │   │   ├── auth.ts           # Mount better-auth handler on /api/auth/*
│       │   │   ├── vps.ts            # VPS CRUD (add/remove instances, org-scoped)
│       │   │   ├── tunnels.ts        # Proxy to VPS tunnel API
│       │   │   ├── routes.ts         # Proxy to VPS L4 route API
│       │   │   ├── firewall.ts       # Proxy to VPS firewall API
│       │   │   └── events.ts         # SSE endpoint for live status
│       │   ├── middleware/
│       │   │   ├── auth.ts           # requireAuth + requirePermission middleware
│       │   │   ├── cors.ts           # CORS for dev (Vite dev server)
│       │   │   └── rate-limit.ts
│       │   ├── services/
│       │   │   ├── vps-poller.ts     # Background health checks (Bun.setInterval)
│       │   │   ├── sse-manager.ts    # In-memory SSE subscriber map
│       │   │   └── audit-log.ts
│       └── package.json
│
├── packages/
│   ├── shared/                       # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── vps.ts            # VpsInstance, VpsStatus
│   │   │   │   ├── tunnel.ts         # Tunnel, TunnelConfig, PeerStatus
│   │   │   │   ├── route.ts          # L4Route, RouteMatch
│   │   │   │   ├── firewall.ts       # FirewallRule
│   │   │   │   └── api.ts            # API request/response shapes
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── db/                           # Drizzle schema + migrations
│       ├── src/
│       │   ├── schema/
│       │   │   ├── auth.ts           # Auto-generated by better-auth CLI
│       │   │   ├── vps.ts            # VPS instances (org-scoped)
│       │   │   ├── audit.ts          # Dashboard audit log (org-scoped)
│       │   │   └── index.ts
│       │   └── index.ts              # Drizzle instance export
│       ├── migrations/
│       ├── drizzle.config.ts
│       └── package.json
│
├── package.json                      # Bun workspaces root
├── tsconfig.base.json                # Shared TypeScript config
├── .env.example
├── Dockerfile                        # Multi-stage build
└── docker-compose.yml                # Local dev (optional)
```

## Root package.json

```json
{
  "name": "proxy-manager",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:api": "bun run --filter api dev",
    "dev:web": "bun run --filter web dev",
    "build": "bun run --filter '*' build",
    "typecheck": "bun run --filter '*' typecheck",
    "test": "bun test",
    "db:generate": "bun run --cwd packages/db generate",
    "db:migrate": "bun run --cwd packages/db migrate"
  }
}
```

## Authentication & Multi-Tenancy

### Library: better-auth

[better-auth](https://www.better-auth.com/) is a TypeScript-first auth library with native Hono integration, Drizzle adapter, and built-in plugins for passkeys, OAuth, and organizations. 26k+ GitHub stars, actively maintained, YC-backed.

### Auth Methods (all three supported simultaneously)

1. **Email/password** — traditional signup/login, bcrypt hashing (handled by better-auth)
2. **Passkeys (WebAuthn)** — via `@better-auth/passkey` plugin (wraps `@simplewebauthn`)
3. **OAuth** — GitHub and Google as social login providers

Users can link multiple auth methods to the same account (e.g., sign up with email, later add a passkey and link GitHub).

### Multi-Tenancy: Organizations

Each organization manages its own set of VPS instances. Users belong to one or more organizations with a role in each.

- Organization plugin handles: creation, member invitations, role assignment, active org tracking per session
- VPS instances are scoped to an organization — queries always filter by `organizationId`
- A user switching orgs in the dashboard sees only that org's VPS fleet

### RBAC (per organization)

Roles are defined via better-auth's `createAccessControl`:

| Role | VPS | Tunnels/Routes/Firewall | Members | Org Settings |
|---|---|---|---|---|
| `admin` | Add, remove, configure | Full CRUD | Invite, remove, change roles | Full access |
| `operator` | View | Full CRUD | View | View |
| `viewer` | View | View | View | View |

### Server Setup

```typescript
// apps/api/src/lib/auth.ts
import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@proxy-manager/db";

// Define resource-level permissions
const ac = createAccessControl({
  vps:      ["create", "read", "update", "delete"],
  tunnel:   ["create", "read", "delete", "rotate"],
  route:    ["create", "read", "delete"],
  firewall: ["create", "read", "delete"],
  member:   ["invite", "read", "remove", "update-role"],
  settings: ["read", "update"],
});

const adminRole = ac.newRole({
  vps:      ["create", "read", "update", "delete"],
  tunnel:   ["create", "read", "delete", "rotate"],
  route:    ["create", "read", "delete"],
  firewall: ["create", "read", "delete"],
  member:   ["invite", "read", "remove", "update-role"],
  settings: ["read", "update"],
});

const operatorRole = ac.newRole({
  vps:      ["read"],
  tunnel:   ["create", "read", "delete", "rotate"],
  route:    ["create", "read", "delete"],
  firewall: ["create", "read", "delete"],
  member:   ["read"],
  settings: ["read"],
});

const viewerRole = ac.newRole({
  vps:      ["read"],
  tunnel:   ["read"],
  route:    ["read"],
  firewall: ["read"],
  member:   ["read"],
  settings: ["read"],
});

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),

  emailAndPassword: {
    enabled: true,
  },

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  plugins: [
    passkey({
      rpName: "Proxy Manager",
      rpID: process.env.PASSKEY_RP_ID!,          // e.g. "proxy-manager.example.com"
      origin: process.env.PASSKEY_ORIGIN!,        // e.g. "https://proxy-manager.example.com"
    }),
    organization({
      ac,
      roles: {
        admin: adminRole,
        operator: operatorRole,
        viewer: viewerRole,
      },
    }),
  ],
});
```

### Hono Integration

```typescript
// apps/api/src/routes/auth.ts
import { Hono } from "hono";
import { auth } from "../lib/auth";

const app = new Hono();

// Mount better-auth on /api/auth/*
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

export default app;
```

### Auth Middleware for Protected Routes

```typescript
// apps/api/src/middleware/auth.ts
import { auth } from "../lib/auth";
import type { MiddlewareHandler } from "hono";

// Session middleware — attaches user + active org to context
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
};

// Permission middleware — checks org-level RBAC
export const requirePermission = (
  resource: string,
  action: string
): MiddlewareHandler => {
  return async (c, next) => {
    const session = c.get("session");
    const hasPermission = await auth.api.hasPermission({
      headers: c.req.raw.headers,
      body: {
        permission: { [resource]: [action] },
      },
    });
    if (!hasPermission.success) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  };
};

// Usage in routes:
// app.post("/api/vps", requireAuth, requirePermission("vps", "create"), createVps);
// app.get("/api/tunnels", requireAuth, requirePermission("tunnel", "read"), listTunnels);
// app.delete("/api/firewall/:id", requireAuth, requirePermission("firewall", "delete"), deleteRule);
```

### Client Setup (React)

```typescript
// apps/web/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
  plugins: [
    passkeyClient(),
    organizationClient(),
  ],
});

// Hooks available:
// authClient.useSession()        — current user + session
// authClient.useActiveOrganization() — current org context
// authClient.signIn.email()      — email/password login
// authClient.signIn.social()     — OAuth login
// authClient.passkey.register()  — register a new passkey
// authClient.passkey.authenticate() — login with passkey
// authClient.organization.create() — create org
// authClient.organization.inviteMember() — invite by email
```

### Database Tables (auto-generated by better-auth CLI)

Run `bunx @better-auth/cli generate` to scaffold the Drizzle schema. Tables created:

| Table | Purpose |
|---|---|
| `user` | User accounts (id, name, email, emailVerified, image) |
| `session` | Active sessions (token, userId, expiresAt, activeOrganizationId) |
| `account` | Linked auth providers (userId, providerId, accountId, credentials) |
| `verification` | Email verification / magic links |
| `passkey` | WebAuthn credentials (userId, publicKey, credentialId, counter) |
| `organization` | Organizations (id, name, slug, logo) |
| `member` | Org membership (userId, organizationId, role) |
| `invitation` | Pending invitations (email, organizationId, role, status) |

These live alongside your app tables (`vps_instances`, `audit_log`) in the same SQLite database.

### Login Page Flow

```
┌─────────────────────────────────┐
│         Proxy Manager           │
│                                 │
│  ┌───────────────────────────┐  │
│  │  🔑 Sign in with Passkey  │  │  ← Primary (if passkey registered)
│  └───────────────────────────┘  │
│                                 │
│  ── or ──────────────────────── │
│                                 │
│  ┌─────────┐  ┌──────────────┐ │
│  │  GitHub  │  │    Google    │ │  ← OAuth providers
│  └─────────┘  └──────────────┘ │
│                                 │
│  ── or ──────────────────────── │
│                                 │
│  Email:    [________________]   │
│  Password: [________________]   │  ← Email/password fallback
│  [Sign In]                      │
│                                 │
│  Don't have an account? Sign up │
└─────────────────────────────────┘
```

### Org Switcher (Dashboard Header)

Users who belong to multiple organizations see an org switcher in the header. Switching orgs updates the `activeOrganizationId` on the session, and all subsequent queries are scoped to that org.

### VPS Scoping

All VPS-related queries include the organization filter:

```typescript
// All VPS queries are scoped to the active org
const vpsInstances = await db
  .select()
  .from(vpsInstancesTable)
  .where(eq(vpsInstancesTable.organizationId, session.activeOrganizationId));
```

The `vps_instances` table gets an `organization_id` foreign key column.

## VPS Communication

The Hono backend communicates with VPS control plane APIs via mTLS:

```typescript
// apps/api/src/lib/vps-client.ts
export async function callVpsApi(
  vps: VpsRecord,
  endpoint: string,
  options?: { method?: string; body?: unknown }
) {
  const response = await fetch(`${vps.apiUrl}${endpoint}`, {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    tls: {
      cert: vps.clientCert,
      key: decrypt(vps.encryptedClientKey),
      ca: vps.serverCa,
    },
  });

  if (!response.ok) {
    throw new VpsApiError(vps.id, response.status, await response.text());
  }
  return response.json();
}
```

## Real-Time Updates via SSE

The Hono backend pushes VPS status updates to connected dashboards:

```typescript
// apps/api/src/routes/events.ts
import { streamSSE } from 'hono/streaming';

app.get('/api/events', requireAuth, (c) => {
  return streamSSE(c, async (stream) => {
    const user = c.get('user');

    const unsubscribe = sseManager.subscribe(user.id, async (event) => {
      await stream.writeSSE({
        data: JSON.stringify(event),
        event: event.type,  // 'vps:status' | 'tunnel:connected' | 'reconciliation:drift'
      });
    });

    // Keep-alive ping every 25s
    const ping = setInterval(async () => {
      await stream.writeSSE({ data: 'ping', event: 'ping' });
    }, 25_000);

    stream.onAbort(() => {
      unsubscribe();
      clearInterval(ping);
    });
  });
});
```

Event types:
- `vps:status` — VPS came online/offline
- `tunnel:connected` / `tunnel:disconnected` — peer handshake state change
- `reconciliation:drift` — drift detected and corrected on a VPS
- `route:added` / `route:removed` — L4 route change (from another session)

## Background VPS Polling

```typescript
// apps/api/src/services/vps-poller.ts
const POLL_INTERVAL = 60_000; // 60 seconds

export function startVpsPoller(db: Database, sseManager: SSEManager) {
  Bun.setInterval(async () => {
    const instances = await db.select().from(vpsInstances);

    for (const vps of instances) {
      try {
        const status = await callVpsApi(vps, '/api/v1/status');
        await db.update(vpsInstances)
          .set({ status: 'online', lastSeenAt: new Date() })
          .where(eq(vpsInstances.id, vps.id));
        sseManager.broadcast({ type: 'vps:status', vpsId: vps.id, status: 'online' });
      } catch {
        await db.update(vpsInstances)
          .set({ status: 'offline' })
          .where(eq(vpsInstances.id, vps.id));
        sseManager.broadcast({ type: 'vps:status', vpsId: vps.id, status: 'offline' });
      }
    }
  }, POLL_INTERVAL);
}
```

## Dashboard Database Schema (Drizzle)

Auth tables (`user`, `session`, `account`, `verification`, `passkey`, `organization`, `member`, `invitation`) are auto-generated by `bunx @better-auth/cli generate`. You only need to define the app-specific tables:

```typescript
// packages/db/src/schema/vps.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organization } from "./auth";  // auto-generated by better-auth CLI

export const vpsInstances = sqliteTable('vps_instances', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  name: text('name').notNull(),
  apiUrl: text('api_url').notNull(),         // https://vps-ip:7443
  encryptedClientKey: text('encrypted_client_key').notNull(),
  clientCert: text('client_cert').notNull(),
  serverCa: text('server_ca').notNull(),
  status: text('status', { enum: ['online', 'offline', 'unknown'] }).default('unknown'),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// packages/db/src/schema/audit.ts
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),         // "vps.create", "tunnel.delete", etc.
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  metadata: text('metadata'),               // JSON blob with request details
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

## Dockerfile (Multi-Stage)

```dockerfile
# Stage 1: Build
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb ./
COPY apps/ apps/
COPY packages/ packages/
RUN bun install --frozen-lockfile
RUN bun run --filter 'web' build
RUN bun build apps/api/src/index.ts --compile --outfile dist/api

# Stage 2: Runtime
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist/api ./api
COPY --from=builder /app/apps/web/dist ./public
EXPOSE 3000
CMD ["./api"]
```

The Hono server serves the compiled Vite static assets via `serveStatic` in production, so a single container runs both frontend and API.

## Theming (Light / Dark / System)

### Approach

shadcn/ui uses CSS variables for all colors, scoped under `.dark` class on the `<html>` element. The theme system supports three modes:

- **Light** — forces light theme
- **Dark** — forces dark theme
- **System** — follows `prefers-color-scheme` media query, auto-switches

### Implementation

Theme state is managed in Zustand and persisted to `localStorage`:

```typescript
// apps/web/src/lib/store/ui.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

interface UIStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    { name: "proxy-manager-ui" }
  )
);
```

A hook applies the theme to the DOM and listens for system changes:

```typescript
// apps/web/src/hooks/use-theme.ts
import { useEffect } from "react";
import { useUIStore } from "../lib/store/ui";

export function useTheme() {
  const { theme, setTheme } = useUIStore();

  useEffect(() => {
    const root = document.documentElement;

    const apply = (resolved: "light" | "dark") => {
      root.classList.toggle("dark", resolved === "dark");
    };

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches ? "dark" : "light");
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }

    apply(theme);
  }, [theme]);

  return { theme, setTheme };
}
```

### Theme Toggle Component

A three-state toggle in the dashboard header (next to the org switcher):

```typescript
// apps/web/src/components/layout/ThemeToggle.tsx
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useTheme } from "../../hooks/use-theme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const icon = {
    light: <Sun className="h-4 w-4" />,
    dark: <Moon className="h-4 w-4" />,
    system: <Monitor className="h-4 w-4" />,
  }[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Flash Prevention

To prevent a white flash on dark-mode page loads, inject a blocking script in `index.html` before React hydrates:

```html
<!-- apps/web/index.html -->
<head>
  <script>
    (function() {
      const stored = JSON.parse(localStorage.getItem('proxy-manager-ui') || '{}');
      const theme = stored?.state?.theme || 'system';
      const dark = theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (dark) document.documentElement.classList.add('dark');
    })();
  </script>
</head>
```

### CSS Variables

shadcn/ui's default `globals.css` already defines light and dark color tokens. No custom color work needed unless you want to customize the palette:

```css
/* apps/web/src/index.css — generated by shadcn/ui init */
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    /* ... all light tokens */
  }

  .dark {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    /* ... all dark tokens */
  }
}
```

All shadcn/ui components automatically respect these variables — no per-component dark mode logic needed.

## Dashboard Features

- **VPS Inventory** — add/remove VPS instances, store encrypted mTLS credentials
- **Live Status** — SSE-pushed online/offline per VPS, reconciliation health
- **Tunnel Management** — create/revoke tunnels, download config, display QR code
- **L4 Route Management** — add/remove SNI-based forwarding rules per tunnel
- **Firewall Rules** — open/close ports in the dynamic nftables chain
- **Reconciliation Status** — per-VPS: last reconcile, drift events, errors, "Sync Now" button
- **Audit Log** — every mutation logged with user, org, timestamp, action
- **Organization Management** — create orgs, invite members, assign roles (admin/operator/viewer)
- **User Settings** — link/unlink OAuth accounts, register/manage passkeys
- **Org Switcher** — users in multiple orgs switch context from the header
