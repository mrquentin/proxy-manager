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
