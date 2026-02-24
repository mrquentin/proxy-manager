#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_DIR="$(dirname "$SCRIPT_DIR")"
SCRIPTS_DIR="$IMAGE_DIR/scripts"

echo "=== Shell Script Validation ==="

EXIT_CODE=0

# Check that all scripts exist and are executable
echo "Checking script permissions..."
scripts=(
  "$SCRIPTS_DIR/01-base.sh"
  "$SCRIPTS_DIR/02-caddy.sh"
  "$SCRIPTS_DIR/03-wireguard.sh"
  "$SCRIPTS_DIR/04-controlplane.sh"
  "$SCRIPTS_DIR/99-cleanup.sh"
)

for script in "${scripts[@]}"; do
  if [[ ! -f "$script" ]]; then
    echo "FAIL: Script not found: $script"
    EXIT_CODE=1
    continue
  fi
  if [[ ! -x "$script" ]]; then
    echo "WARN: Script not executable: $script (fixing...)"
    chmod +x "$script"
  fi
  echo "  OK: $script"
done

# Check that all scripts start with a proper shebang
echo ""
echo "Checking shebangs..."
for script in "${scripts[@]}"; do
  if [[ ! -f "$script" ]]; then
    continue
  fi
  # shellcheck disable=SC2016
  first_line=$(head -n 1 "$script")
  if [[ "$first_line" != "#!/bin/bash" ]]; then
    echo "FAIL: Invalid shebang in $script: $first_line"
    EXIT_CODE=1
  else
    echo "  OK: $script"
  fi
done

# Check that all scripts use set -euo pipefail
echo ""
echo "Checking error handling..."
for script in "${scripts[@]}"; do
  if [[ ! -f "$script" ]]; then
    continue
  fi
  if ! grep -q 'set -euo pipefail' "$script"; then
    echo "FAIL: Missing 'set -euo pipefail' in $script"
    EXIT_CODE=1
  else
    echo "  OK: $script"
  fi
done

# Run shellcheck if available
echo ""
echo "Running shellcheck..."
if command -v shellcheck &>/dev/null; then
  for script in "${scripts[@]}"; do
    if [[ ! -f "$script" ]]; then
      continue
    fi
    echo "  Checking: $script"
    if shellcheck -s bash -S warning "$script"; then
      echo "    PASS"
    else
      echo "    FAIL"
      EXIT_CODE=1
    fi
  done
else
  echo "WARNING: shellcheck not installed, skipping linting."
  echo "Install with: apt-get install shellcheck"
fi

# Validate JSON config files
echo ""
echo "Checking JSON config files..."
if command -v jq &>/dev/null; then
  json_files=(
    "$IMAGE_DIR/config/caddy.json"
  )
  for jf in "${json_files[@]}"; do
    if jq empty "$jf" 2>/dev/null; then
      echo "  OK: $jf"
    else
      echo "  FAIL: Invalid JSON in $jf"
      EXIT_CODE=1
    fi
  done
else
  echo "WARNING: jq not installed, skipping JSON validation."
fi

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "=== All checks passed ==="
else
  echo "=== Some checks failed ==="
fi

exit $EXIT_CODE
