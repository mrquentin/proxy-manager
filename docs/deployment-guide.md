# Deployment Guide

Deploy the proxy-manager system using GitHub CI/CD:
- **Control plane binaries**: Built for linux/amd64 + linux/arm64, published as GitHub Release assets
- **Dashboard Docker image**: Multi-arch (amd64 + arm64), published to GitHub Container Registry (GHCR)
- **VPS**: Oracle Cloud Free Tier (ARM64) or any Linux VPS
- **Dashboard**: Any Docker host (Unraid, local, etc.)

---

## Part 1: Release from GitHub

### 1.1 Push the repo to GitHub

```powershell
cd E:\other\proxy-manager
git init
git add -A
git commit -m "Initial commit"
gh repo create proxy-manager --private --source=. --push
```

### 1.2 Tag a release

One tag triggers all workflows — control plane binaries + dashboard Docker image:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

This triggers:
- **release-controlplane.yml** — tests, builds `controlplane-linux-amd64` and `controlplane-linux-arm64`, creates a GitHub Release with both binaries
- **build-dashboard.yml** — tests, builds multi-arch Docker image, pushes to `ghcr.io/<your-user>/proxy-manager/dashboard`
- **build-image.yml** — (optional) builds Packer VPS image if you have HCLOUD_TOKEN configured

### 1.3 Wait for CI to finish

```powershell
gh run list --limit 5
gh run watch   # watch the latest run
```

### 1.4 Verify the release

```powershell
# Check the GitHub Release has binaries
gh release view v0.1.0

# Check the Docker image exists
docker pull ghcr.io/<your-user>/proxy-manager/dashboard:0.1.0
```

---

## Part 2: Set Up Oracle Cloud Free Tier VPS

### 2.1 Create an OCI account

1. Register at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
2. Credit card required for verification but **not charged** for Always Free resources
3. Choose a home region close to you

### 2.2 Generate an SSH key

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\oci_vps -C "proxy-manager-vps"
```

### 2.3 Create the ARM instance

In the OCI Console:

1. **Compute → Instances → Create Instance**
2. **Image**: Ubuntu 22.04 → Architecture **aarch64**
3. **Shape**: VM.Standard.A1.Flex → 2 OCPUs, 12 GB RAM (up to 4/24 free)
4. Ensure **public IPv4** is assigned
5. Paste contents of `$HOME\.ssh\oci_vps.pub`
6. Boot volume: 50 GB

> **"Out of host capacity"**: A1 instances are in high demand. Retry at off-peak hours (early morning UTC).

### 2.4 Open ports in OCI Security List

Networking → VCN → Security Lists → Default → Add Ingress Rules:

| Source CIDR | Protocol | Port | Description |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `80` | HTTP |
| `0.0.0.0/0` | TCP | `443` | HTTPS + L4 proxy |
| `0.0.0.0/0` | UDP | `51820` | WireGuard |
| `0.0.0.0/0` | TCP | `7443` | Control plane API |

### 2.5 SSH into the VPS

```powershell
ssh -i $HOME\.ssh\oci_vps ubuntu@<VPS_IP>
```

### 2.6 Fix OCI iptables (CRITICAL)

OCI Ubuntu images silently block everything except SSH.

```bash
sudo nano /etc/iptables/rules.v4
```

Find the SSH ACCEPT line and add these **immediately after it** (before the REJECT line):

```
-A INPUT -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT
-A INPUT -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT
-A INPUT -p tcp -m state --state NEW -m tcp --dport 7443 -j ACCEPT
-A INPUT -p udp -m state --state NEW -m udp --dport 51820 -j ACCEPT
```

Apply:

```bash
sudo iptables-restore < /etc/iptables/rules.v4
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

> **Do NOT use UFW** on OCI — it conflicts with OCI's iptables setup.

---

## Part 3: Provision the VPS

All commands below run **on the VPS** via SSH.

### 3.1 Install packages

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y wireguard wireguard-tools unattended-upgrades curl ca-certificates jq
```

### 3.2 Enable IP forwarding

```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-wireguard.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-wireguard.conf
sudo sysctl --system
```

### 3.3 Set up WireGuard

```bash
sudo install -d -m 700 /etc/wireguard
wg genkey | sudo tee /etc/wireguard/server_private.key | wg pubkey | sudo tee /etc/wireguard/server_public.key
sudo chmod 600 /etc/wireguard/server_private.key

IFACE=$(ip route show default | awk '{print $5}')

sudo tee /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PostUp = wg set %i private-key /etc/wireguard/server_private.key
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -A FORWARD -i %i -o %i -j DROP
PostUp = iptables -t nat -A POSTROUTING -o ${IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT
PostDown = iptables -D FORWARD -i %i -o %i -j DROP
PostDown = iptables -t nat -D POSTROUTING -o ${IFACE} -j MASQUERADE
EOF

sudo chmod 600 /etc/wireguard/wg0.conf
sudo systemctl enable --now wg-quick@wg0
sudo wg show  # verify
```

### 3.4 Build and install Caddy with L4 module

Since we're on ARM64, we build Caddy directly on the VPS:

```bash
GOVERSION="1.23.6"
curl -fsSL "https://go.dev/dl/go${GOVERSION}.linux-arm64.tar.gz" | sudo tar -C /usr/local -xz
export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"

go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
xcaddy build --with github.com/mholt/caddy-l4

sudo mv caddy /usr/bin/caddy
sudo chmod 755 /usr/bin/caddy
sudo setcap 'cap_net_bind_service=+ep' /usr/bin/caddy

# Clean up Go (not needed at runtime)
sudo rm -rf /usr/local/go ~/go
```

Create caddy user, config, and systemd unit:

```bash
sudo groupadd --system caddy
sudo useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy

sudo install -d -m 755 /etc/caddy
sudo tee /etc/caddy/caddy.json << 'EOF'
{
  "admin": {
    "listen": "unix//run/caddy/admin.sock|0660",
    "config": { "persist": false }
  },
  "apps": {
    "layer4": { "servers": {} }
  }
}
EOF

sudo tee /etc/systemd/system/caddy.service << 'EOF'
[Unit]
Description=Caddy L4 Proxy
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
AmbientCapabilities=CAP_NET_BIND_SERVICE
RuntimeDirectory=caddy
RuntimeDirectoryMode=0755

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now caddy
```

### 3.5 Download and install the control plane from GitHub Releases

```bash
# Download the ARM64 binary directly from your GitHub Release
VERSION="v0.1.0"
REPO="<your-user>/proxy-manager"

curl -fsSL "https://github.com/${REPO}/releases/download/${VERSION}/controlplane-linux-arm64" \
  -o /tmp/controlplane

sudo install -m 755 /tmp/controlplane /usr/bin/controlplane

# Create user and directories
sudo useradd --system --create-home --home-dir /var/lib/controlplane --shell /usr/sbin/nologin controlplane
sudo usermod -aG caddy controlplane
sudo install -d -m 750 -o controlplane -g controlplane /var/lib/controlplane
```

> For a **private repo**, use `gh release download` instead:
> ```bash
> gh release download v0.1.0 --repo <your-user>/proxy-manager --pattern "controlplane-linux-arm64" --dir /tmp
> ```

### 3.6 Generate mTLS certificates

```bash
sudo install -d -m 750 -o controlplane -g controlplane /etc/controlplane/tls
cd /tmp

# CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 -out ca.crt -subj "/CN=Proxy Manager CA"

# Server cert
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=<VPS_IP>"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365 -sha256 \
  -extfile <(printf "subjectAltName=IP:<VPS_IP>")

# Client cert (for the dashboard)
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=dashboard"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365 -sha256

# Install server certs
sudo cp server.crt server.key /etc/controlplane/tls/
sudo cp ca.crt /etc/controlplane/tls/client-ca.crt
sudo chown -R controlplane:controlplane /etc/controlplane/tls
sudo chmod 600 /etc/controlplane/tls/server.key

# SAVE THESE — paste them in the dashboard later:
echo "=== CLIENT CERT ===" && cat client.crt
echo "=== CLIENT KEY ===" && cat client.key
echo "=== CA CERT ===" && cat ca.crt
```

### 3.7 Configure and start the control plane

```bash
sudo install -d -m 755 /etc/controlplane
sudo tee /etc/controlplane/config.env << EOF
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

sudo tee /etc/systemd/system/controlplane.service << 'EOF'
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
AmbientCapabilities=CAP_NET_ADMIN
CapabilityBoundingSet=CAP_NET_ADMIN
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/controlplane /run/caddy
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now controlplane
```

### 3.8 Verify

```bash
sudo systemctl status wg-quick@wg0
sudo systemctl status caddy
sudo systemctl status controlplane
sudo journalctl -u controlplane -f  # if issues
```

---

## Part 4: Deploy the Dashboard (Docker)

### 4.1 Pull the image from GHCR

On your Docker host (Unraid, local machine, etc.):

```powershell
# Login to GHCR (one-time)
echo <GITHUB_PAT> | docker login ghcr.io -u <your-user> --password-stdin

# Pull the image
docker pull ghcr.io/<your-user>/proxy-manager/dashboard:0.1.0
```

> For public repos, no login needed.

### 4.2 Create the environment file

```powershell
# Generate secrets
openssl rand -hex 32   # → use for JWT_SECRET
openssl rand -hex 32   # → use for ENCRYPTION_KEY
```

Create a `.env` file:

```env
PORT=3000
NODE_ENV=production
DATABASE_PATH=./data/proxy-manager.db
JWT_SECRET=<paste-generated-value>
PASSKEY_RP_ID=localhost
PASSKEY_ORIGIN=http://localhost:3000
ENCRYPTION_KEY=<paste-generated-value>
CORS_ORIGIN=http://localhost:3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### 4.3 Run the container

```powershell
docker run -d `
  --name proxy-manager `
  --restart unless-stopped `
  -p 3000:3000 `
  -v proxy-manager-data:/app/data `
  --env-file .env `
  ghcr.io/<your-user>/proxy-manager/dashboard:0.1.0
```

### 4.4 Access the dashboard

Open `http://localhost:3000` (or `http://<unraid-ip>:3000`):

1. **Create your account** — first user is admin
2. **Create an organization**
3. **Add your VPS** — paste the `client.crt`, `client.key`, and `ca.crt` from step 3.6
4. **Create a tunnel** → download WireGuard config → import on your machine
5. **Add L4 routes** to forward traffic through the tunnel

---

## Part 5: DNS Setup

Point your domains to the VPS:

```
app.example.com  →  A record  →  <VPS_IP>
*.example.com    →  A record  →  <VPS_IP>   (wildcard)
```

Caddy L4 reads the SNI from TLS connections and routes by domain.

---

## Updating

### Update the control plane

Just tag a new release:

```powershell
git tag v0.2.0
git push origin v0.2.0
```

Wait for CI, then on the VPS:

```bash
VERSION="v0.2.0"
REPO="<your-user>/proxy-manager"
curl -fsSL "https://github.com/${REPO}/releases/download/${VERSION}/controlplane-linux-arm64" -o /tmp/controlplane
sudo systemctl stop controlplane
sudo install -m 755 /tmp/controlplane /usr/bin/controlplane
sudo systemctl start controlplane
```

### Update the dashboard

```powershell
docker pull ghcr.io/<your-user>/proxy-manager/dashboard:0.2.0
docker stop proxy-manager; docker rm proxy-manager
docker run -d `
  --name proxy-manager `
  --restart unless-stopped `
  -p 3000:3000 `
  -v proxy-manager-data:/app/data `
  --env-file .env `
  ghcr.io/<your-user>/proxy-manager/dashboard:0.2.0
```

SQLite data persists in the Docker volume — survives container restarts.

---

## Troubleshooting

### "Connection refused" on port 443/7443
1. Check OCI Security List has the ingress rule
2. Check iptables: `sudo iptables -L INPUT --line-numbers` — port must appear **before** REJECT
3. Check the service: `sudo systemctl status caddy`

### Control plane won't start
```bash
sudo journalctl -u controlplane -n 50 --no-pager
```
Common: permission denied on caddy socket → `sudo usermod -aG caddy controlplane` and restart

### WireGuard connects but no traffic
1. `cat /proc/sys/net/ipv4/ip_forward` → should be `1`
2. `sudo wg show` → peer should be listed
3. `sudo curl --unix-socket /run/caddy/admin.sock http://localhost/config/apps/layer4` → routes exist

### Dashboard can't reach VPS
1. `curl -k https://<VPS_IP>:7443/api/v1/health` — timeout = firewall, TLS error = cert mismatch
