#!/bin/bash
set -euo pipefail

# Install Go (needed for xcaddy)
# shellcheck disable=SC2153
GOVERSION="${GO_VERSION:-1.23.6}"
GOARCH=$(dpkg --print-architecture)  # amd64 or arm64
curl -fsSL "https://go.dev/dl/go${GOVERSION}.linux-${GOARCH}.tar.gz" | tar -C /usr/local -xz
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
cp /tmp/config/caddy.json /etc/caddy/caddy.json

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
