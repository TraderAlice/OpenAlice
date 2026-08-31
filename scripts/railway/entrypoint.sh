#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'openalice railway: %s\n' "$*" >&2
  exit 1
}

canonical_path() {
  python3 - "$1" <<'PY'
import os
import sys

print(os.path.realpath(os.path.abspath(sys.argv[1])))
PY
}

system_path='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$system_path"

requested_volume_root="${RAILWAY_VOLUME_MOUNT_PATH:-${OPENALICE_RAILWAY_VOLUME_ROOT:-/data}}"
requested_volume_root="${requested_volume_root%/}"
[[ "$requested_volume_root" == /* && "$requested_volume_root" != / ]] \
  || fail 'the persistent volume root must be an absolute path other than /'
if [[ -n "${RAILWAY_ENVIRONMENT_ID:-}" && -z "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]]; then
  fail 'attach a Railway Volume before starting this service'
fi
volume_root="$(canonical_path "$requested_volume_root")"
if [[ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" && -n "${OPENALICE_RAILWAY_VOLUME_ROOT:-}" ]]; then
  configured_volume_root="$(canonical_path "$OPENALICE_RAILWAY_VOLUME_ROOT")"
  [[ "$configured_volume_root" == "$volume_root" ]] \
    || fail 'OPENALICE_RAILWAY_VOLUME_ROOT must match the Railway Volume mount path'
fi
if [[ -n "${RAILWAY_ENVIRONMENT_ID:-}" ]]; then
  [[ -n "${RAILWAY_SERVICE_ID:-}" ]] \
    || fail 'Railway did not provide a stable service identity'
  export OPENALICE_MACHINE_ID="${OPENALICE_MACHINE_ID:-railway-service-${RAILWAY_SERVICE_ID}}"
fi

fixed_home="$(canonical_path "$volume_root/home")"
fixed_install_dir="$(canonical_path "$fixed_home/.openalice")"
fixed_npm_prefix="$(canonical_path "$fixed_home/.local")"
fixed_bun_install="$(canonical_path "$fixed_home/.bun")"
if [[ -n "${RAILWAY_ENVIRONMENT_ID:-}" ]]; then
  for configured_pair in \
    "HOME=${HOME:-}" \
    "OPENALICE_INSTALL_DIR=${OPENALICE_INSTALL_DIR:-}" \
    "NPM_CONFIG_PREFIX=${NPM_CONFIG_PREFIX:-}" \
    "BUN_INSTALL=${BUN_INSTALL:-}"; do
    configured_name="${configured_pair%%=*}"
    configured_value="${configured_pair#*=}"
    [[ -z "$configured_value" ]] && continue
    case "$configured_name" in
      HOME) expected_value="$fixed_home" ;;
      OPENALICE_INSTALL_DIR) expected_value="$fixed_install_dir" ;;
      NPM_CONFIG_PREFIX) expected_value="$fixed_npm_prefix" ;;
      BUN_INSTALL) expected_value="$fixed_bun_install" ;;
    esac
    [[ "$(canonical_path "$configured_value")" == "$expected_value" ]] \
      || fail "$configured_name must use the persistent Railway user layout beneath $volume_root/home"
  done
fi

export HOME="$fixed_home"
export OPENALICE_HOME="$(canonical_path "${OPENALICE_HOME:-$volume_root/projects/default}")"
export AQ_LAUNCHER_ROOT="$(canonical_path "$OPENALICE_HOME/workspaces")"
export OPENALICE_INSTALL_DIR="$fixed_install_dir"
export NPM_CONFIG_PREFIX="$fixed_npm_prefix"
export BUN_INSTALL="$fixed_bun_install"

for persistent_path in "$HOME" "$OPENALICE_HOME" "$AQ_LAUNCHER_ROOT" "$OPENALICE_INSTALL_DIR" "$NPM_CONFIG_PREFIX" "$BUN_INSTALL"; do
  case "$persistent_path" in
    "$volume_root"/*) ;;
    *) fail "$persistent_path must stay beneath the persistent volume root $volume_root" ;;
  esac
done
mkdir -p "$HOME" "$OPENALICE_HOME" "$AQ_LAUNCHER_ROOT" "$NPM_CONFIG_PREFIX/bin" "$BUN_INSTALL/bin"

channel="${OPENALICE_RAILWAY_CHANNEL:-stable}"
version="${OPENALICE_RAILWAY_VERSION:-}"
force_install="${OPENALICE_RAILWAY_FORCE_INSTALL:-0}"
port="${OPENALICE_RAILWAY_PORT:-47331}"
wait_seconds="${OPENALICE_RAILWAY_WAIT_SECONDS:-180}"
installer="${OPENALICE_RAILWAY_INSTALLER_PATH:-/opt/openalice/install}"
command_wrapper="${OPENALICE_RAILWAY_COMMAND_WRAPPER_PATH:-/usr/local/libexec/openalice-railway-command}"
launcher="$OPENALICE_INSTALL_DIR/bin/openalice"

[[ "$channel" == stable || "$channel" == beta || "$channel" == dev ]] \
  || fail 'OPENALICE_RAILWAY_CHANNEL must be stable, beta, or dev'
[[ "$force_install" == 0 || "$force_install" == 1 ]] \
  || fail 'OPENALICE_RAILWAY_FORCE_INSTALL must be 0 or 1'
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] \
  || fail 'OPENALICE_RAILWAY_PORT must be between 1 and 65535'
[[ "$wait_seconds" =~ ^[0-9]+$ && "$wait_seconds" -ge 1 && "$wait_seconds" -le 600 ]] \
  || fail 'OPENALICE_RAILWAY_WAIT_SECONDS must be between 1 and 600'
if [[ "$channel" == dev && -n "$version" ]]; then
  fail 'the rolling dev channel cannot be combined with OPENALICE_RAILWAY_VERSION'
fi
if [[ -n "$version" ]]; then
  if [[ "$channel" == stable ]]; then
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
      || fail 'stable OPENALICE_RAILWAY_VERSION must be x.y.z'
  else
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta(\.[1-9][0-9]*)?$ ]] \
      || fail 'beta OPENALICE_RAILWAY_VERSION must be x.y.z-beta or x.y.z-beta.N'
  fi
  [[ "$version" != 0.90.1 ]] \
    || fail 'OpenAlice 0.90.1 uses the legacy Node-managed layout and cannot run as a Railway native CLI host'
fi

validated_install_identity() {
  local expected_channel="${1:-}" expected_version="${2:-}"
  local reported_version version_json
  [[ -x "$launcher" ]] || return 1
  reported_version="$("$launcher" --version 2>/dev/null)" || return 1
  version_json="$("$launcher" version --json 2>/dev/null)" || return 1
  python3 -c '
import json
import os
import re
import sys

expected_channel, expected_version, reported_version, install_root = sys.argv[1:]
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)

source = payload.get("installSource")
runtime = payload.get("managedRuntime")
artifact = source.get("artifact") if isinstance(source, dict) else None
version = payload.get("version")
identity = payload.get("contentIdentity")
if not (
    isinstance(version, str)
    and version == reported_version
    and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", version)
    and isinstance(identity, str)
    and re.fullmatch(r"[a-f0-9]{16}", identity)
    and isinstance(source, dict)
    and source.get("schemaVersion") == 3
    and source.get("repository") == "TraderAlice/OpenAlice"
    and source.get("cliVersion") == version
    and source.get("updateChannel") in {"stable", "beta", "development"}
    and isinstance(artifact, dict)
    and artifact.get("platform") in {"darwin", "linux"}
    and artifact.get("arch") in {"arm64", "x64"}
    and isinstance(artifact.get("sha256"), str)
    and re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"])
    and isinstance(runtime, dict)
    and runtime.get("productVersion") == version
    and runtime.get("contentIdentity") == identity
    and runtime.get("platform") == artifact.get("platform")
    and runtime.get("arch") == artifact.get("arch")
    and isinstance(runtime.get("path"), str)
):
    raise SystemExit(1)

release_root = os.path.realpath(os.path.join(install_root, "cli", "releases"))
runtime_root = os.path.realpath(runtime["path"])
try:
    contained = os.path.commonpath([release_root, runtime_root]) == release_root
except ValueError:
    contained = False
if not contained or runtime_root == release_root or not os.path.isdir(runtime_root):
    raise SystemExit(1)

if expected_channel:
    desired_channel = "development" if expected_channel == "dev" else expected_channel
    if source.get("updateChannel") != desired_channel:
        raise SystemExit(1)
    if expected_version and version != expected_version:
        raise SystemExit(1)
    selector = source.get("selector")
    if expected_channel == "dev":
        if selector != {"kind": "branch", "value": "dev"}:
            raise SystemExit(1)
    elif selector != {"kind": "version", "value": f"v{version}"}:
        raise SystemExit(1)
print(json.dumps({
    "version": version,
    "contentIdentity": identity,
    "releaseRoot": runtime_root,
    "installSource": {
        "schemaVersion": source["schemaVersion"],
        "repository": source["repository"],
        "cliVersion": source["cliVersion"],
        "selector": source.get("selector"),
        "updateChannel": source["updateChannel"],
        "method": source.get("method"),
        "artifact": {
            "platform": artifact["platform"],
            "arch": artifact["arch"],
            "sha256": artifact["sha256"],
        },
    },
    "managedRuntime": {
        "productVersion": runtime["productVersion"],
        "platform": runtime["platform"],
        "arch": runtime["arch"],
        "path": runtime_root,
        "contentIdentity": runtime["contentIdentity"],
    },
}, sort_keys=True, separators=(",", ":")))
' "$expected_channel" "$expected_version" "$reported_version" "$OPENALICE_INSTALL_DIR" \
    <<<"$version_json" 2>/dev/null
}

validate_install() {
  validated_install_identity "${1:-}" "${2:-}" >/dev/null
}

valid_install() {
  validate_install '' ''
}

install_matches_selection() {
  validate_install "$channel" "$version"
}

previous_release_name=''
previous_release_version=''
previous_release_identity=''

capture_previous_install() {
  local current_release releases_root
  current_release="$(canonical_path "$OPENALICE_INSTALL_DIR/cli/current")"
  releases_root="$(canonical_path "$OPENALICE_INSTALL_DIR/cli/releases")"
  [[ "$(dirname "$current_release")" == "$releases_root" ]] || return 1
  previous_release_name="$(basename "$current_release")"
  [[ "$previous_release_name" =~ ^[A-Za-z0-9._+-]+$ ]] || return 1
  previous_release_version="$("$launcher" --version 2>/dev/null)" || return 1
  previous_release_identity="$(validated_install_identity '' '')" || return 1
  [[ -n "$previous_release_identity" ]] || return 1
}

restore_previous_install() {
  local previous_release previous_link current_release
  [[ "$previous_install_valid" == 1 && -n "$previous_release_name" && -n "$previous_release_version" && -n "$previous_release_identity" ]] \
    || return 1
  previous_release="$OPENALICE_INSTALL_DIR/cli/releases/$previous_release_name"
  [[ -d "$previous_release" && ! -L "$previous_release" ]] || return 1
  current_release="$(canonical_path "$OPENALICE_INSTALL_DIR/cli/current" 2>/dev/null || true)"
  if [[ "$current_release" != "$(canonical_path "$previous_release")" ]]; then
    previous_link="$OPENALICE_INSTALL_DIR/cli/current.railway-rollback.$$"
    rm -f "$previous_link"
    ln -s "releases/$previous_release_name" "$previous_link" || return 1
    if [[ "$(uname -s)" == Darwin* ]]; then
      mv -fh "$previous_link" "$OPENALICE_INSTALL_DIR/cli/current" || return 1
    else
      mv -Tf "$previous_link" "$OPENALICE_INSTALL_DIR/cli/current" || return 1
    fi
  fi
  valid_install \
    && [[ "$("$launcher" --version 2>/dev/null)" == "$previous_release_version" ]] \
    && [[ "$(validated_install_identity '' '')" == "$previous_release_identity" ]]
}

previous_install_valid=0
if valid_install; then
  previous_install_valid=1
  capture_previous_install || fail 'the current verified OpenAlice release pointer is invalid'
fi
if [[ "$force_install" == 1 || "$previous_install_valid" == 0 || "$channel" == dev ]] || ! install_matches_selection; then
  [[ -f "$installer" ]] || fail "installer not found at $installer"
  install_args=(
    --yes
    --no-modify-path
    --install-dir "$OPENALICE_INSTALL_DIR"
    --channel "$channel"
  )
  if [[ -n "$version" ]]; then install_args+=(--version "$version"); fi
  printf 'openalice railway: installing %s%s into the persistent user home\n' \
    "$channel" "${version:+ $version}"
  selected_install_ready=0
  if bash "$installer" "${install_args[@]}"; then
    if install_matches_selection; then
      selected_install_ready=1
    else
      printf 'openalice railway: installer returned without the selected verified release\n' >&2
    fi
  fi
  if [[ "$selected_install_ready" != 1 ]] && restore_previous_install; then
    fallback_version="$previous_release_version"
    printf 'openalice railway: bootstrap failed; starting previously verified OpenAlice %s\n' \
      "$fallback_version" >&2
  elif [[ "$selected_install_ready" != 1 ]]; then
    fail 'bootstrap failed and no previously verified OpenAlice release is available'
  fi
fi

[[ -f "$command_wrapper" && ! -L "$command_wrapper" ]] \
  || fail "Railway command wrapper not found at $command_wrapper"
for command_name in openalice alice alice-workspace alice-uta traderhub; do
  target="$OPENALICE_INSTALL_DIR/bin/$command_name"
  temporary_target="$OPENALICE_INSTALL_DIR/bin/.$command_name.railway-next.$$"
  rm -f "$temporary_target"
  install -m 0755 "$command_wrapper" "$temporary_target"
  mv -f "$temporary_target" "$target"
done

link_dir="${OPENALICE_RAILWAY_LINK_DIR:-/usr/local/bin}"
mkdir -p "$link_dir"
for command_name in openalice alice alice-workspace alice-uta traderhub; do
  target="$OPENALICE_INSTALL_DIR/bin/$command_name"
  link="$link_dir/$command_name"
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ ! -e "$link" || -L "$link" ]]; then
      ln -sfn "$target" "$link"
    fi
  fi
done

export PATH="$OPENALICE_INSTALL_DIR/bin:$NPM_CONFIG_PREFIX/bin:$BUN_INSTALL/bin:$system_path"
printf 'openalice railway: starting foreground Runtime at %s on loopback port %s\n' \
  "$OPENALICE_HOME" "$port"
exec "$launcher" server run \
  --home "$OPENALICE_HOME" \
  --port "$port" \
  --wait "$wait_seconds"
