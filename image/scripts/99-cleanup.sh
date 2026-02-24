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
