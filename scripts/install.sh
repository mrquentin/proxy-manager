#!/bin/bash
# Proxy Manager — VPS Install Script
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mrquentin/proxy-manager/main/scripts/install.sh | sudo bash
#   Or with options:
#   curl -fsSL https://raw.githubusercontent.com/mrquentin/proxy-manager/main/scripts/install.sh | sudo bash -s -- --version v1.0.0
#   Or locally:
#   ssh root@vps 'bash -s' < scripts/install.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# ─── Defaults ───────────────────────────────────────────────────────────────────
GITHUB_REPO="mrquentin/proxy-manager"
RELEASE_TAG=""       # empty = latest release
GO_VERSION="1.23.6"
SKIP_FIREWALL=false
BINARY_PATH=""       # local path to pre-uploaded controlplane binary

# ─── Parse arguments ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)    RELEASE_TAG="$2"; shift 2 ;;
    --go-version) GO_VERSION="$2"; shift 2 ;;
    --binary)     BINARY_PATH="$2"; shift 2 ;;
    --skip-firewall) SKIP_FIREWALL=true; shift ;;
    -h|--help)
      echo "Usage: install.sh [--binary <path>] [--version <tag>] [--go-version <ver>] [--skip-firewall]"
      echo "  --binary <path>    Path to a pre-uploaded controlplane binary (skips GitHub download)"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Helpers ────────────────────────────────────────────────────────────────────
log()  { echo -e "\033[1;34m[install]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
err()  { echo -e "\033[1;31m[error]\033[0m $*" >&2; exit 1; }

# ─── Preflight ──────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || err "This script must be run as root."

# Detect OS
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  err "Cannot detect OS — /etc/os-release not found."
fi

case "${ID}-${VERSION_ID}" in
  debian-12*)    log "Detected Debian 12 (${PRETTY_NAME})" ;;
  ubuntu-22.04*) log "Detected Ubuntu 22.04 (${PRETTY_NAME})" ;;
  ubuntu-24.04*) log "Detected Ubuntu 24.04 (${PRETTY_NAME})" ;;
  *) err "Unsupported OS: ${PRETTY_NAME:-unknown}. Requires Debian 12, Ubuntu 22.04, or Ubuntu 24.04." ;;
esac

# Detect architecture
ARCH=$(dpkg --print-architecture)
case "$ARCH" in
  amd64|arm64) log "Architecture: ${ARCH}" ;;
  *) err "Unsupported architecture: ${ARCH}. Requires amd64 or arm64." ;;
esac

# Check connectivity (only needed for GitHub download + Go/xcaddy)
if [[ -z "$BINARY_PATH" ]]; then
  curl -fsSL --connect-timeout 5 https://api.github.com/ > /dev/null 2>&1 \
    || err "Cannot reach GitHub API. Check your internet connection or use --binary."
fi

log "Starting Proxy Manager VPS installation..."

# ─── 1. Base packages ───────────────────────────────────────────────────────────
log "Installing base packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
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

# ─── 2. System hardening ────────────────────────────────────────────────────────
log "Hardening SSH..."
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

log "Enabling IP forwarding..."
cat > /etc/sysctl.d/99-wireguard.conf << 'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
sysctl --system > /dev/null 2>&1

# ─── 3. Firewall ────────────────────────────────────────────────────────────────
if [[ "$SKIP_FIREWALL" == "false" ]]; then
  log "Configuring UFW firewall..."
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp        # SSH
  ufw allow 80/tcp        # HTTP redirect
  ufw allow 443/tcp       # HTTPS + L4 multiplexer
  ufw allow 51820/udp     # WireGuard
  ufw allow 7443/tcp      # Control plane API
  ufw --force enable
else
  warn "Skipping firewall configuration (--skip-firewall)"
fi

# ─── 4. Caddy L4 ────────────────────────────────────────────────────────────────
log "Building Caddy with L4 module (this may take a few minutes)..."

# Download Go temporarily
curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" | tar -C /usr/local -xz
export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"

# Build Caddy with xcaddy
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
TMPBUILD=$(mktemp -d)
pushd "$TMPBUILD" > /dev/null
xcaddy build --with github.com/mholt/caddy-l4
popd > /dev/null

# Install binary
install -m 755 "$TMPBUILD/caddy" /usr/bin/caddy
setcap 'cap_net_bind_service=+ep' /usr/bin/caddy
rm -rf "$TMPBUILD"

# Create caddy user and group
if ! getent group caddy > /dev/null 2>&1; then
  groupadd --system caddy
fi
if ! id caddy > /dev/null 2>&1; then
  useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
fi

# Runtime directory
install -d -m 755 -o caddy -g caddy /run/caddy

# Config
install -d -m 755 /etc/caddy
cat > /etc/caddy/caddy.json << 'EOF'
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
EOF

# Systemd unit
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

# Clean up Go
rm -rf /usr/local/go ~/go
log "Caddy installed."

# ─── 5. WireGuard ───────────────────────────────────────────────────────────────
log "Configuring WireGuard..."

# Keygen service (first boot / first install)
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

# Detect default network interface for NAT
DEFAULT_IFACE=$(ip route show default | awk '/default/ {print $5; exit}')
DEFAULT_IFACE="${DEFAULT_IFACE:-eth0}"

cat > /etc/wireguard/wg0.conf << WGCONF
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PostUp = wg set %i private-key /etc/wireguard/server_private.key
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -A FORWARD -i %i -o %i -j DROP
PostUp = iptables -t nat -A POSTROUTING -o ${DEFAULT_IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT
PostDown = iptables -D FORWARD -i %i -o %i -j DROP
PostDown = iptables -t nat -D POSTROUTING -o ${DEFAULT_IFACE} -j MASQUERADE
WGCONF

chmod 600 /etc/wireguard/wg0.conf

# ─── 6. Control Plane ───────────────────────────────────────────────────────────
log "Installing control plane..."

if [[ -n "$BINARY_PATH" ]]; then
  # Use pre-uploaded binary
  [[ -f "$BINARY_PATH" ]] || err "Binary not found at ${BINARY_PATH}"
  install -m 755 "$BINARY_PATH" /usr/bin/controlplane
  RELEASE_TAG="${RELEASE_TAG:-local}"
  log "Installed controlplane from ${BINARY_PATH}"
else
  # Download from GitHub Releases
  if [[ -z "$RELEASE_TAG" ]]; then
    RELEASE_TAG=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | jq -r '.tag_name')
    if [[ -z "$RELEASE_TAG" || "$RELEASE_TAG" == "null" ]]; then
      err "Could not determine latest release. Use --binary to provide the binary directly, or --version to specify a tag."
    fi
  fi
  log "Using version: ${RELEASE_TAG}"

  DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}/controlplane-${ARCH}"
  log "Downloading controlplane from ${DOWNLOAD_URL}..."
  curl -fsSL -o /tmp/controlplane "$DOWNLOAD_URL" \
    || err "Failed to download control plane binary. For private repos, use --binary instead."
  install -m 755 /tmp/controlplane /usr/bin/controlplane
  rm -f /tmp/controlplane
fi

# Create controlplane user
if ! id controlplane > /dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/controlplane --shell /usr/sbin/nologin controlplane
fi
usermod -aG caddy controlplane

# Data directory
install -d -m 750 -o controlplane -g controlplane /var/lib/controlplane

# Environment config
install -d -m 755 /etc/controlplane
cat > /etc/controlplane/config.env << 'EOF'
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
EOF

# TLS directory (certs must be placed here before starting)
install -d -m 750 -o controlplane -g controlplane /etc/controlplane/tls

# Systemd unit
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

# ─── 7. Enable & start services ─────────────────────────────────────────────────
log "Enabling and starting services..."
systemctl daemon-reload
systemctl enable --now wireguard-keygen
systemctl enable --now wg-quick@wg0
systemctl enable --now caddy
systemctl enable --now controlplane

# ─── 8. Cleanup ─────────────────────────────────────────────────────────────────
log "Cleaning up..."
apt-get autoremove -y -qq
apt-get clean -qq

# ─── Done ────────────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  Proxy Manager VPS — Installation Complete  "
echo "============================================="
echo ""
echo "  Version:           ${RELEASE_TAG}"
echo "  Architecture:      ${ARCH}"
echo "  WireGuard iface:   wg0 (10.0.0.1/24)"
echo "  NAT interface:     ${DEFAULT_IFACE}"
echo "  Control plane API: 0.0.0.0:7443 (mTLS)"
echo ""
if [[ -f /etc/wireguard/server_public.key ]]; then
  echo "  WireGuard public key: $(cat /etc/wireguard/server_public.key)"
else
  echo "  WireGuard keys will be generated on first boot."
fi
echo ""
echo "  Next steps:"
echo "    1. Place mTLS certificates in /etc/controlplane/tls/"
echo "       - server.crt, server.key, client-ca.crt"
echo "    2. Restart the control plane: systemctl restart controlplane"
echo ""
echo "  Service status:"
systemctl --no-pager is-active caddy wg-quick@wg0 controlplane 2>/dev/null | paste - - - | \
  awk '{printf "    caddy: %s | wireguard: %s | controlplane: %s\n", $1, $2, $3}' || true
echo ""
