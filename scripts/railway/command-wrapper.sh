#!/usr/bin/env bash
set -euo pipefail

command_name="${0##*/}"
install_dir="${OPENALICE_INSTALL_DIR:-/data/home/.openalice}"
release_dir="$(CDPATH= cd -- "$install_dir/cli/current" 2>/dev/null && pwd -P)" || {
  printf 'openalice railway: the active release pointer is unavailable at %s\n' "$install_dir/cli/current" >&2
  exit 1
}
releases_dir="$(CDPATH= cd -- "$install_dir/cli/releases" 2>/dev/null && pwd -P)" || {
  printf 'openalice railway: the release store is unavailable at %s\n' "$install_dir/cli/releases" >&2
  exit 1
}
case "$release_dir" in
  "$releases_dir"/*) ;;
  *)
    printf 'openalice railway: the active release escaped the managed release store\n' >&2
    exit 1
    ;;
esac
release_name="${release_dir##*/}"
content_identity="${release_name##*-}"
target="$release_dir/bin/openalice"

if [[ -n "${RAILWAY_ENVIRONMENT_ID:-}" ]]; then
  [[ -n "${RAILWAY_SERVICE_ID:-}" ]] || {
    printf 'openalice railway: Railway did not provide a stable service identity\n' >&2
    exit 1
  }
  export OPENALICE_MACHINE_ID="railway-service-${RAILWAY_SERVICE_ID}"
fi

if [[ "${OPENALICE_SERVICE_MANAGER:-}" == railway && ( "$command_name" == openalice || "$command_name" == alice ) ]]; then
  case "${1:-}" in
    update|rollback)
      printf 'openalice railway: service variables own release selection; set OPENALICE_RAILWAY_CHANNEL and optional OPENALICE_RAILWAY_VERSION, then restart or redeploy\n'
      exit 0
      ;;
    uninstall)
      printf 'openalice railway: the service owns this install and its fallback releases; remove or reconfigure the Railway service instead\n'
      exit 0
      ;;
  esac
fi

[[ -x "$target" ]] || {
  printf 'openalice railway: the active OpenAlice executable is unavailable at %s\n' "$target" >&2
  exit 1
}

export OPENALICE_INSTALL_ROOT="$install_dir"
export OPENALICE_RELEASE_DIR="$release_dir"
export OPENALICE_INSTALL_SOURCE="$install_dir/cli/provenance/$release_name.json"
export OPENALICE_CONTENT_IDENTITY="$content_identity"
export OPENALICE_INSTALL_METHOD=direct

case "$command_name" in
  alice|alice-workspace|alice-uta|traderhub)
    exec "$target" --workspace-cli "$command_name" "$@"
    ;;
  *)
    exec "$target" "$@"
    ;;
esac
