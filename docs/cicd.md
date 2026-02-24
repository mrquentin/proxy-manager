# CI/CD

## Overview

Two independent pipelines:
1. **VPS Image Pipeline** — builds the Packer image on tagged releases
2. **Web Dashboard Pipeline** — builds and pushes the Docker image on main/tag

Both are triggered by git tags. Feature branches run lint/typecheck/test only.

## Repository Structure

```
proxy-manager/
├── image/                        # VPS image build
│   ├── image.pkr.hcl            # Packer template (HCL2)
│   ├── variables.pkr.hcl        # Variable definitions
│   ├── scripts/
│   │   ├── 01-base.sh
│   │   ├── 02-caddy.sh
│   │   ├── 03-wireguard.sh
│   │   ├── 04-controlplane.sh
│   │   └── 99-cleanup.sh
│   └── config/
│       ├── caddy.json
│       └── controlplane.env
├── controlplane/                 # Go control plane source
│   ├── cmd/controlplane/main.go
│   ├── internal/...
│   ├── go.mod
│   └── Makefile
├── apps/                         # Web dashboard
│   ├── web/
│   └── api/
├── packages/                     # Shared packages
│   ├── shared/
│   └── db/
├── .github/workflows/
│   ├── ci.yml                   # PR checks: lint, typecheck, test
│   ├── build-image.yml          # VPS image build (tag-triggered)
│   └── build-dashboard.yml      # Dashboard Docker build (tag-triggered)
├── package.json
├── Dockerfile
└── docker-compose.yml
```

## Pipeline 1: VPS Image Build

### Trigger

Tag push matching `image/v*` (e.g., `image/v1.0.0`).

### Workflow: `.github/workflows/build-image.yml`

```yaml
name: Build VPS Image

on:
  push:
    tags: ['image/v*']

env:
  GO_VERSION: '1.23'

jobs:
  build-controlplane:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: ${{ env.GO_VERSION }}

      - name: Build control plane binary
        working-directory: controlplane
        run: |
          CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
            go build -ldflags="-s -w" -o ../image/files/controlplane ./cmd/controlplane

      - uses: actions/upload-artifact@v4
        with:
          name: controlplane-binary
          path: image/files/controlplane

  build-image:
    needs: build-controlplane
    runs-on: ubuntu-latest
    strategy:
      matrix:
        provider: [hcloud]  # Add more providers as needed: digitalocean, vultr
    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          name: controlplane-binary
          path: image/files/

      - name: Setup Packer
        uses: hashicorp/setup-packer@main
        with:
          version: latest

      - name: Packer Init
        working-directory: image
        run: packer init .

      - name: Packer Validate
        working-directory: image
        run: packer validate -var-file="providers/${{ matrix.provider }}.pkrvars.hcl" .

      - name: Packer Build
        working-directory: image
        env:
          HCLOUD_TOKEN: ${{ secrets.HCLOUD_TOKEN }}
          PKR_VAR_build_version: ${{ github.ref_name }}
        run: packer build -var-file="providers/${{ matrix.provider }}.pkrvars.hcl" .

      - name: Scan with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: image/
          severity: HIGH,CRITICAL
          exit-code: 1
```

### Packer Template: `image/image.pkr.hcl`

```hcl
packer {
  required_plugins {
    hcloud = {
      source  = "github.com/hetznercloud/hcloud"
      version = ">= 1.6.0"
    }
  }
}

variable "hcloud_token" {
  type      = string
  sensitive = true
  default   = env("HCLOUD_TOKEN")
}

variable "build_version" {
  type    = string
  default = "dev"
}

source "hcloud" "debian12" {
  token         = var.hcloud_token
  image         = "debian-12"
  location      = "fsn1"
  server_type   = "cx22"
  ssh_username  = "root"
  snapshot_name = "proxy-manager-${var.build_version}-{{timestamp}}"
  snapshot_labels = {
    app           = "proxy-manager"
    build_version = var.build_version
    base_os       = "debian-12"
  }
}

build {
  sources = ["source.hcloud.debian12"]

  # Upload pre-built control plane binary
  provisioner "file" {
    source      = "files/controlplane"
    destination = "/tmp/controlplane"
  }

  # Upload config files
  provisioner "file" {
    source      = "config/"
    destination = "/tmp/config/"
  }

  # Run provisioning scripts in order
  provisioner "shell" {
    scripts = [
      "scripts/01-base.sh",
      "scripts/02-caddy.sh",
      "scripts/03-wireguard.sh",
      "scripts/04-controlplane.sh",
      "scripts/99-cleanup.sh",
    ]
    environment_vars = [
      "DEBIAN_FRONTEND=noninteractive",
      "BUILD_VERSION=${var.build_version}",
    ]
  }
}
```

### Provider Variables: `image/providers/hcloud.pkrvars.hcl`

```hcl
# Hetzner Cloud specific overrides
# hcloud_token is set via environment variable
```

## Pipeline 2: Web Dashboard Build

### Trigger

Tag push matching `dashboard/v*` (e.g., `dashboard/v1.0.0`) or push to `main`.

### Workflow: `.github/workflows/build-dashboard.yml`

```yaml
name: Build Dashboard

on:
  push:
    branches: [main]
    tags: ['dashboard/v*']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install --frozen-lockfile
      - run: bun run --filter '*' typecheck
      - run: bun test

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/')
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Docker meta
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}/dashboard
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}},prefix=dashboard/v
            type=sha

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## Pipeline 3: PR Checks

### Workflow: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'

      - name: Install dashboard dependencies
        run: bun install --frozen-lockfile

      - name: Typecheck dashboard
        run: bun run --filter '*' typecheck

      - name: Test dashboard
        run: bun test

      - name: Test control plane
        working-directory: controlplane
        run: go test ./...

      - name: Vet control plane
        working-directory: controlplane
        run: go vet ./...

      - name: Validate Packer
        working-directory: image
        run: |
          packer init .
          packer validate .
```

## Release Workflow

1. **Development:** Work on feature branches, PRs trigger `ci.yml`
2. **Dashboard release:** Tag `dashboard/v1.2.3` → builds and pushes Docker image to GHCR
3. **Image release:** Tag `image/v1.2.3` → builds Go binary, runs Packer, creates VPS snapshot, scans with Trivy
4. **Combined release:** Tag both in sequence when both components change

## Secrets Required

| Secret | Used By | Description |
|---|---|---|
| `HCLOUD_TOKEN` | VPS image build | Hetzner Cloud API token |
| `GITHUB_TOKEN` | Dashboard build | Auto-provided by GitHub Actions for GHCR |

Add more provider tokens as needed (e.g., `DIGITALOCEAN_TOKEN`, `VULTR_API_KEY`).

## Version Strategy

- Dashboard and VPS image are versioned independently
- Tag format: `{component}/v{semver}` (e.g., `image/v1.0.0`, `dashboard/v1.0.0`)
- The control plane binary embeds its version via `-ldflags`:
  ```bash
  go build -ldflags="-s -w -X main.version=${BUILD_VERSION}" ./cmd/controlplane
  ```
- The VPS snapshot label includes the build version for traceability
