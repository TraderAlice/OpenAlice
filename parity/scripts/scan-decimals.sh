#!/usr/bin/env bash
# parity/scripts/scan-decimals.sh — Phase 0.7 decimal inventory sweep.
#
# Read-only ripgrep sweep for every Decimal / sentinel-bearing field in
# `packages/ibkr/src/` and `src/domain/trading/`. The output drives the
# manual classification in `parity/decimal-inventory.md`.
#
# Usage:
#   bash parity/scripts/scan-decimals.sh
#   bash parity/scripts/scan-decimals.sh > /tmp/decimal-scan.txt
#
# Run from the OpenAlice/ project root.

set -euo pipefail

BOLD="\033[1m"
RESET="\033[0m"

if ! command -v rg >/dev/null 2>&1; then
  echo "error: ripgrep (rg) is required. Install via: brew install ripgrep"
  exit 2
fi

print_header() {
  printf "\n${BOLD}== %s ==${RESET}\n" "$1"
}

print_header "1. Decimal-typed fields with UNSET_DECIMAL default"
rg -n --type ts 'Decimal\s*=\s*UNSET_DECIMAL' packages/ibkr/src/ src/domain/trading/ || true

print_header "2. number-typed fields with UNSET_DOUBLE default"
rg -n --type ts 'number\s*=\s*UNSET_DOUBLE' packages/ibkr/src/ src/domain/trading/ || true

print_header "3. number-typed fields with UNSET_INTEGER default"
rg -n --type ts 'number\s*=\s*UNSET_INTEGER' packages/ibkr/src/ src/domain/trading/ || true

print_header "4. Other Decimal-typed fields (no UNSET default — likely class (a) value-only)"
rg -n --type ts ':\s*Decimal\b' packages/ibkr/src/ src/domain/trading/ \
  | rg -v 'UNSET_DECIMAL' \
  | rg -v 'import\s' \
  | rg -v '//.*Decimal\b' \
  || true

print_header "5. Decimal-as-string fields (filledQty, filledPrice, etc.)"
rg -n --type ts -B1 'Decimal as string' packages/ibkr/src/ src/domain/trading/ || true

print_header "6. Sentinel comparisons in source (callers checking sentinels)"
rg -n --type ts 'UNSET_DECIMAL|UNSET_DOUBLE|UNSET_INTEGER' packages/ibkr/src/ src/domain/trading/ \
  | rg -v 'const UNSET_' \
  | rg -v 'export ' \
  | rg -v '^.*: Decimal = UNSET_DECIMAL$' \
  | rg -v '^.*: number = UNSET_(DOUBLE|INTEGER)$' \
  || true

print_header "7. Decimal.toString() callsites (Phase 1c will replace these with toCanonicalDecimalString)"
rg -n --type ts '\.toString\(\)' packages/ibkr/src/ src/domain/trading/ \
  | rg -v '\bString\b' \
  | rg 'Decimal|decimal\.js' \
  || true

echo
echo "Done. Hand-classify each hit per parity/decimal-inventory.md §classification rubric."
