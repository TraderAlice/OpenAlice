#!/usr/bin/env bash
set -euo pipefail

command_name="$(basename "$0")"
if [[ "$command_name" == "sudo" ]]; then
  exec "$@"
fi
if [[ "$command_name" != "apt-get" ]]; then
  echo "fake package manager: unsupported command $command_name" >&2
  exit 1
fi

: "${OPENALICE_RUNTIME_DEPS_SHIM_DIR:?runtime dependency shim directory is required}"
: "${OPENALICE_RUNTIME_DEPS_LOG:?runtime dependency log is required}"
printf 'apt-get %s\n' "$*" >> "$OPENALICE_RUNTIME_DEPS_LOG"

if [[ "${1:-}" == "update" ]]; then
  exit 0
fi
if [[ "${1:-}" != "install" ]]; then
  echo "fake apt-get: unsupported arguments: $*" >&2
  exit 1
fi

for tool in git python3 make g++ c++; do
  printf '#!/usr/bin/env sh\nexit 0\n' > "$OPENALICE_RUNTIME_DEPS_SHIM_DIR/$tool"
  chmod +x "$OPENALICE_RUNTIME_DEPS_SHIM_DIR/$tool"
done
