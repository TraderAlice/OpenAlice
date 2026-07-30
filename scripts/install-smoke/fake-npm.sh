#!/usr/bin/env bash
set -euo pipefail

expected=(ci --omit=dev --ignore-scripts --no-audit --no-fund)
actual=("$@")
[[ "${#actual[@]}" -eq "${#expected[@]}" ]] || {
  printf 'fake npm: unexpected argument count: %s\n' "$#" >&2
  exit 1
}
for index in "${!expected[@]}"; do
  [[ "${actual[$index]}" == "${expected[$index]}" ]] || {
    printf 'fake npm: unexpected command: %q\n' "$*" >&2
    exit 1
  }
done

cli_dir="$PWD/node_modules/@earendil-works/pi-coding-agent/dist"
mkdir -p "$cli_dir"
printf '%s\n' \
  '#!/usr/bin/env node' \
  "if (process.argv.includes('--version') || process.argv.includes('-v')) console.log('0.83.0')" \
  > "$cli_dir/cli.js"
