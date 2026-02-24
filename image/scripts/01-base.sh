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
