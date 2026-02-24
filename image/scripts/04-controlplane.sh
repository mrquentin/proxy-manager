#!/bin/bash
set -euo pipefail

# Copy pre-built control plane binary (placed by Packer file provisioner)
# Select the correct architecture binary
ARCH=$(dpkg --print-architecture)  # amd64 or arm64
if [ -f "/tmp/controlplane-${ARCH}" ]; then
  install -m 755 "/tmp/controlplane-${ARCH}" /usr/bin/controlplane
elif [ -f "/tmp/controlplane" ]; then
  install -m 755 /tmp/controlplane /usr/bin/controlplane
else
  echo "ERROR: No controlplane binary found for architecture ${ARCH}"
  exit 1
fi

# Create controlplane user (member of caddy group for socket access)
useradd --system --create-home --home-dir /var/lib/controlplane --shell /usr/sbin/nologin controlplane
usermod -aG caddy controlplane

# Create data directory
install -d -m 750 -o controlplane -g controlplane /var/lib/controlplane

# Default environment config
install -d -m 755 /etc/controlplane
cp /tmp/config/controlplane.env /etc/controlplane/config.env

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
