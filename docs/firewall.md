# Firewall

## Strategy: Dual-Layer Approach

Two independent firewall layers that never conflict:

1. **UFW (static baseline)** — set at image build time, never modified by the API
2. **nftables dynamic chain** — managed exclusively by the control plane API

## UFW Baseline

Configured during Packer image build, enabled at boot, never touched again:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH management
ufw allow 80/tcp        # HTTP (redirect to HTTPS)
ufw allow 443/tcp       # HTTPS + L4 multiplexer
ufw allow 51820/udp     # WireGuard
ufw allow 7443/tcp      # Control plane API (restrict source in production)
ufw --force enable
```

UFW writes its rules to `/etc/ufw/` and manages its own nftables chains (`ufw-before-input`, `ufw-after-input`, etc.). The control plane API never calls `ufw` and never modifies these chains.

## Dynamic nftables Chain

The control plane API manages a dedicated nftables chain for runtime rules. This chain is injected into the filter table alongside UFW's chains, not inside them.

### Chain Topology

```
table inet filter
  chain input (policy drop)
    jump ufw-before-input       ← UFW manages this
    jump dynamic-api-rules      ← Control plane API manages this
    jump ufw-reject-input       ← UFW manages this
```

### Implementation via google/nftables

The control plane uses the `github.com/google/nftables` Go library for typed, atomic rule management via netlink. No shell commands, no parsing.

```go
import "github.com/google/nftables"

func (fw *Firewall) Init() error {
    conn := &nftables.Conn{}

    // Get the existing inet filter table (created by UFW/nftables)
    table := &nftables.Table{
        Family: nftables.TableFamilyINet,
        Name:   "filter",
    }

    // Create the dynamic chain
    chain := conn.AddChain(&nftables.Chain{
        Name:  "dynamic-api-rules",
        Table: table,
        Type:  nftables.ChainTypeFilter,
    })

    // The chain is jumped to from the input chain
    // (jump rule added once during initial setup)

    return conn.Flush()
}
```

### Adding a Rule

```go
func (fw *Firewall) AllowPort(port uint16, proto string) error {
    conn := &nftables.Conn{}

    // Build match expressions for protocol + port
    // Add rule to the dynamic-api-rules chain
    // ...

    return conn.Flush() // Atomic application
}
```

### Listing Rules

```go
func (fw *Firewall) ListRules() ([]*nftables.Rule, error) {
    conn := &nftables.Conn{}
    return conn.GetRules(table, dynamicChain)
}
```

### Removing a Rule

```go
func (fw *Firewall) DeleteRule(rule *nftables.Rule) error {
    conn := &nftables.Conn{}
    conn.DelRule(rule)
    return conn.Flush()
}
```

## Rule Storage

Dynamic rules are persisted in SQLite and reconciled:

```sql
CREATE TABLE firewall_rules (
    id          TEXT PRIMARY KEY,
    port        INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    proto       TEXT NOT NULL CHECK (proto IN ('tcp', 'udp')),
    direction   TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out')),
    source_cidr TEXT NOT NULL DEFAULT '0.0.0.0/0',
    action      TEXT NOT NULL DEFAULT 'allow' CHECK (action IN ('allow', 'deny')),
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
```

## Input Validation

All firewall rule inputs are strictly validated:

- **Port:** integer, 1–65535, reject reserved ports (22, 2019, 7443, 51820)
- **Protocol:** exactly `"tcp"` or `"udp"`
- **Source CIDR:** parsed via `net.ParseCIDR()`, reject invalid ranges
- **Action:** exactly `"allow"` or `"deny"`

Reserved ports are configurable via environment variable `RESERVED_PORTS=22,2019,7443,51820`.

## Reconciliation

The reconciliation loop (see [reconciliation.md](./reconciliation.md)) compares:

- **Desired state:** all enabled rules from SQLite `firewall_rules` table
- **Actual state:** rules in the `dynamic-api-rules` nftables chain (read via `conn.GetRules()`)

On drift:
- Missing rules are added
- Extra rules (not in SQLite) are removed
- Modified rules are replaced

## Security Notes

- The dynamic chain only handles rules **added via the API**. UFW's baseline is always enforced independently.
- Even if the control plane crashes, UFW's static rules remain in effect — the VPS is never fully open.
- The control plane cannot modify UFW rules — it has no access to the `ufw` command or UFW's config files.
- Rate limiting on the API prevents a valid client from flooding the firewall with thousands of rules.
