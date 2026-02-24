# VPS Image

## Base OS

**Debian 12 (Bookworm) minimal cloud image.**

- glibc — full binary compatibility, no musl surprises
- systemd — standard init, matches all tooling and tutorials
- `apt` ecosystem — ufw, Caddy, WireGuard all available
- ~310 MB compressed cloud image, ~80-120 MB RAM idle
- 5-year support lifecycle

## Image Builder

**Packer (HCL2 format).**

- Plugins for every major VPS provider (Hetzner, DigitalOcean, Vultr, AWS, GCP)
- CI/CD via `hashicorp/setup-packer` GitHub Action
- Tag-triggered builds — only on git tags, not every commit
- Trivy scan after build, before promotion

## Two-Layer Build Strategy

1. **Base image** (rebuild monthly or on critical CVEs):
   - OS hardening, sshd config, ufw baseline, unattended-upgrades
   - WireGuard kernel module + tools
2. **Application image** (rebuild on every tagged release, built on top of base):
   - Custom Caddy binary (xcaddy + caddy-l4)
   - Control plane Go binary
   - systemd units, default configs

## File Layout on the VPS

```
/usr/bin/caddy                          # xcaddy-built binary with caddy-l4
/usr/bin/controlplane                   # Go control plane binary
/etc/caddy/caddy.json                   # Base Caddy config (admin socket, empty L4 app)
/etc/wireguard/wg0.conf                 # WireGuard server config (template, keys inserted at boot)
/etc/wireguard/server_private.key       # Generated at first boot (chmod 600)
/etc/wireguard/server_public.key        # Generated at first boot
/etc/controlplane/config.env            # Environment config (reconcile interval, log level)
/var/lib/controlplane/config.db         # SQLite — source of truth for all state
/run/caddy/admin.sock                   # Caddy admin Unix socket (0660, group=caddy)
/etc/systemd/system/caddy.service       # Caddy systemd unit
/etc/systemd/system/controlplane.service # Control plane systemd unit
/etc/systemd/system/wireguard-keygen.service # One-shot key generation at first boot
```

## Provisioning Scripts

### scripts/01-base.sh

```bash
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Update and install base packages
apt-get update
apt-get upgrade -y
apt-get install -y \
  ufw \
  wireguard \
  wireguard-tools \
  unattended-upgrades \
  apt-listchanges \
  curl \
  ca-certificates \
  jq

# Enable unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# SSH hardening
sed -i 's/#PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Enable IP forwarding for WireGuard
echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-wireguard.conf
echo 'net.ipv6.conf.all.forwarding = 1' >> /etc/sysctl.d/99-wireguard.conf

# UFW baseline
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH
ufw allow 80/tcp        # HTTP redirect
ufw allow 443/tcp       # HTTPS + L4 multiplexer
ufw allow 51820/udp     # WireGuard
ufw allow 7443/tcp      # Control plane API
ufw --force enable
```

### scripts/02-caddy.sh

```bash
#!/bin/bash
set -euo pipefail

# Install Go (needed for xcaddy)
GOVERSION="1.23.6"
curl -fsSL "https://go.dev/dl/go${GOVERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz
export PATH="/usr/local/go/bin:$PATH"

# Install xcaddy and build custom Caddy with L4 module
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
~/go/bin/xcaddy build \
  --with github.com/mholt/caddy-l4

# Install binary
mv caddy /usr/bin/caddy
chmod 755 /usr/bin/caddy
setcap 'cap_net_bind_service=+ep' /usr/bin/caddy

# Create caddy user and group
groupadd --system caddy
useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy

# Create runtime directory
install -d -m 755 -o caddy -g caddy /run/caddy

# Install base Caddy config
install -d -m 755 /etc/caddy
cat > /etc/caddy/caddy.json << 'CADDYJSON'
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
CADDYJSON

# Install systemd unit
cat > /etc/systemd/system/caddy.service << 'UNIT'
[Unit]
Description=Caddy L4 Proxy
Documentation=https://caddyserver.com/docs/
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
UNIT

systemctl daemon-reload
systemctl enable caddy

# Clean up Go (not needed at runtime)
rm -rf /usr/local/go ~/go
```

### scripts/03-wireguard.sh

```bash
#!/bin/bash
set -euo pipefail

# WireGuard keygen service — runs once on first boot
cat > /etc/systemd/system/wireguard-keygen.service << 'UNIT'
[Unit]
Description=WireGuard Key Generation (first boot only)
ConditionPathExists=!/etc/wireguard/server_private.key
Before=wg-quick@wg0.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c '\
  install -d -m 700 /etc/wireguard && \
  wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key && \
  chmod 600 /etc/wireguard/server_private.key && \
  chown root:root /etc/wireguard/server_private.key /etc/wireguard/server_public.key'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

# WireGuard base config template
# The PrivateKey is read from the file at runtime by wg-quick
cat > /etc/wireguard/wg0.conf << 'WGCONF'
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PostUp = wg set %i private-key /etc/wireguard/server_private.key
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -A FORWARD -i %i -o %i -j DROP
PostUp = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT
PostDown = iptables -D FORWARD -i %i -o %i -j DROP
PostDown = iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
WGCONF

chmod 600 /etc/wireguard/wg0.conf

systemctl daemon-reload
systemctl enable wireguard-keygen
systemctl enable wg-quick@wg0
```

### scripts/04-controlplane.sh

```bash
#!/bin/bash
set -euo pipefail

# Copy pre-built control plane binary (placed by Packer file provisioner)
install -m 755 /tmp/controlplane /usr/bin/controlplane

# Create controlplane user (member of caddy group for socket access)
useradd --system --create-home --home-dir /var/lib/controlplane --shell /usr/sbin/nologin controlplane
usermod -aG caddy controlplane

# Create data directory
install -d -m 750 -o controlplane -g controlplane /var/lib/controlplane

# Default environment config
install -d -m 755 /etc/controlplane
cat > /etc/controlplane/config.env << 'ENV'
# Control Plane Configuration
LISTEN_ADDR=0.0.0.0:7443
CADDY_ADMIN_SOCKET=/run/caddy/admin.sock
SQLITE_PATH=/var/lib/controlplane/config.db
RECONCILE_INTERVAL=30
LOG_LEVEL=info
WG_INTERFACE=wg0
WG_SUBNET=10.0.0.0/24
WG_SERVER_IP=10.0.0.1
TLS_CERT=/etc/controlplane/tls/server.crt
TLS_KEY=/etc/controlplane/tls/server.key
TLS_CLIENT_CA=/etc/controlplane/tls/client-ca.crt
ENV

# Install systemd unit
cat > /etc/systemd/system/controlplane.service << 'UNIT'
[Unit]
Description=Proxy Manager Control Plane API
After=network-online.target caddy.service wg-quick@wg0.service
Wants=network-online.target
Requires=caddy.service wg-quick@wg0.service

[Service]
Type=simple
User=controlplane
Group=caddy
EnvironmentFile=/etc/controlplane/config.env
ExecStart=/usr/bin/controlplane
Restart=always
RestartSec=5

# Security hardening
AmbientCapabilities=CAP_NET_ADMIN
CapabilityBoundingSet=CAP_NET_ADMIN
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/controlplane /run/caddy
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable controlplane
```

### scripts/99-cleanup.sh

```bash
#!/bin/bash
set -euo pipefail

# Clean apt caches
apt-get autoremove -y
apt-get clean
rm -rf /var/lib/apt/lists/*

# Clean logs
journalctl --flush
journalctl --rotate
journalctl --vacuum-time=1s
rm -rf /var/log/*.log /var/log/*.gz

# Clean cloud-init artifacts from build
rm -rf /var/lib/cloud/instances/*
cloud-init clean --logs 2>/dev/null || true

# Clean temp files
rm -rf /tmp/* /var/tmp/*

# Zero free space for smaller snapshot (optional, provider-dependent)
# dd if=/dev/zero of=/EMPTY bs=1M 2>/dev/null || true
# rm -f /EMPTY
```

## Packer Template

See [cicd.md](./cicd.md) for the full `image.pkr.hcl` template.

## cloud-init (Last-Mile Only)

cloud-init is used **only** for per-instance data that cannot be baked:

```yaml
#cloud-config
ssh_authorized_keys:
  - ssh-ed25519 AAAA... user@host

# Inject mTLS certificates for the control plane
write_files:
  - path: /etc/controlplane/tls/server.crt
    permissions: '0644'
    content: |
      -----BEGIN CERTIFICATE-----
      ... (injected per instance)
      -----END CERTIFICATE-----
  - path: /etc/controlplane/tls/server.key
    permissions: '0600'
    owner: controlplane:controlplane
    content: |
      -----BEGIN PRIVATE KEY-----
      ... (injected per instance)
      -----END PRIVATE KEY-----
  - path: /etc/controlplane/tls/client-ca.crt
    permissions: '0644'
    content: |
      -----BEGIN CERTIFICATE-----
      ... (your private CA cert)
      -----END CERTIFICATE-----
```

## Boot Order

```
1. systemd starts
2. wireguard-keygen.service — generates keypair if not present (first boot only)
3. wg-quick@wg0.service — brings up WireGuard interface
4. caddy.service — starts Caddy with empty L4 config
5. controlplane.service — starts API, runs initial reconciliation, restores state from SQLite
```
