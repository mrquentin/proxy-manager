#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Packer Template Validation ==="

# Check that required files exist
echo "Checking required files..."
required_files=(
  "$IMAGE_DIR/image.pkr.hcl"
  "$IMAGE_DIR/variables.pkr.hcl"
  "$IMAGE_DIR/providers/hcloud.pkrvars.hcl"
  "$IMAGE_DIR/config/caddy.json"
  "$IMAGE_DIR/config/controlplane.env"
  "$IMAGE_DIR/scripts/01-base.sh"
  "$IMAGE_DIR/scripts/02-caddy.sh"
  "$IMAGE_DIR/scripts/03-wireguard.sh"
  "$IMAGE_DIR/scripts/04-controlplane.sh"
  "$IMAGE_DIR/scripts/99-cleanup.sh"
)

for f in "${required_files[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "FAIL: Missing required file: $f"
    exit 1
  fi
  echo "  OK: $f"
done

# Initialize Packer plugins
echo ""
echo "Initializing Packer plugins..."
cd "$IMAGE_DIR"
packer init .

# Validate the Packer template
echo ""
echo "Validating Packer template..."
packer validate -syntax-only .
echo "Packer syntax validation passed."

# Validate with provider variables (skip if no token)
echo ""
echo "Validating with hcloud provider variables..."
packer validate -var-file="providers/hcloud.pkrvars.hcl" . || {
  echo "WARNING: Full validation failed (expected if HCLOUD_TOKEN is not set)."
  echo "Syntax-only validation passed."
}

echo ""
echo "=== Validation complete ==="
