#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "[install-docker-smoke] $*" >&2
  exit 1
}

[[ "$(id -u)" -ne 0 ]] || fail "container must run as a non-root user"
[[ -z "$(find "$HOME" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail "HOME is not empty"
if command -v pnpm >/dev/null 2>&1; then
  fail "pnpm must not be globally installed in the bootstrap fixture"
fi

server_log="$(mktemp)"
refusal_log="$(mktemp)"
node /fixture/static-server.mjs >"$server_log" 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true
  rm -f "$server_log" "$refusal_log"
}
trap cleanup EXIT

installer_url="http://127.0.0.1:18080/install"
for _ in $(seq 1 100); do
  if curl --fail --silent --output /dev/null "$installer_url"; then
    break
  fi
  if ! kill -0 "$server_pid" >/dev/null 2>&1; then
    cat "$server_log" >&2
    fail "fixture server exited before becoming ready"
  fi
  sleep 0.1
done
curl --fail --silent --output /dev/null "$installer_url" || {
  cat "$server_log" >&2
  fail "fixture server did not become ready"
}

export OPENALICE_INSTALL_BASE_URL="http://127.0.0.1:18080/packages/cli/"

if curl -fsSL "$installer_url" | bash -s -- --version smoke-unattended >"$refusal_log" 2>&1; then
  fail "installer proceeded without interactive or explicit approval"
fi
grep -Fq -- "--yes" "$refusal_log" || fail "unattended refusal did not explain --yes"
[[ ! -e "$HOME/.openalice" ]] || fail "unattended refusal changed the install root"

install_version() {
  local version="$1"
  curl -fsSL "$installer_url" | bash -s -- --yes --version "$version"
}

mkdir -p "$HOME/.openalice/.cli-install.lock"
printf '99999999\n' > "$HOME/.openalice/.cli-install.lock/pid"
install_version smoke-v1

bin_dir="$HOME/.openalice/bin"
versions_dir="$HOME/.openalice/cli-versions"
[[ "$($bin_dir/openalice --version)" == "0.2.0" ]] || fail "installed CLI version check failed"
"$bin_dir/openalice" --help | grep -Fq "OpenAlice CLI" || fail "installed CLI help check failed"
server_status="$($bin_dir/openalice server status --home "$HOME/openalice-server-smoke" --json)"
node -e '
const status = JSON.parse(process.argv[1]);
if (status.class !== "absent" || status.state !== "absent") process.exit(1);
' "$server_status" || fail "installed CLI server status check failed"
[[ -f "$bin_dir/openalice.cmd" ]] || fail "Windows launcher was not installed"
[[ ! -e "$HOME/.openalice/.cli-install.lock" ]] || fail "installer lock was not released"
v1_release="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -name 'smoke-v1-*' -print -quit)"
[[ -n "$v1_release" && -f "$v1_release/bin/openalice.mjs" ]] || fail "content-addressed CLI release was not installed"
cmp /fixture/packages/cli/src/local-start.mjs "$v1_release/src/local-start.mjs" \
  || fail "downloaded CLI file differs from the fixture"
cmp /fixture/packages/cli/src/remote.mjs "$v1_release/src/remote.mjs" \
  || fail "downloaded Remote CLI file differs from the fixture"
cmp /fixture/packages/cli/src/server.mjs "$v1_release/src/server.mjs" \
  || fail "downloaded Server CLI file differs from the fixture"
cmp /fixture/packages/cli/src/server-control.mjs "$v1_release/src/server-control.mjs" \
  || fail "downloaded Server control file differs from the fixture"

expected_path_line="export PATH=$HOME/.openalice/bin:\$PATH"
path_count="$(grep -Fxc "$expected_path_line" "$HOME/.bashrc" || true)"
[[ "$path_count" == "1" ]] || fail "installer did not add exactly one shell PATH entry"
[[ "$(grep -Fxc '# >>> OpenAlice CLI >>>' "$HOME/.bashrc" || true)" == "1" ]] \
  || fail "installer did not add its managed PATH block"

install_version smoke-v1
path_count="$(grep -Fxc "$expected_path_line" "$HOME/.bashrc" || true)"
[[ "$path_count" == "1" ]] || fail "repeat install duplicated the shell PATH entry"
v1_count="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -name 'smoke-v1-*' | wc -l | tr -d ' ')"
[[ "$v1_count" == "1" ]] || fail "repeat install duplicated an identical CLI release"

install_version smoke-v2
v2_release="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -name 'smoke-v2-*' -print -quit)"
[[ -d "$v1_release" ]] || fail "version switch removed the previous CLI"
[[ -n "$v2_release" && -d "$v2_release" ]] || fail "version switch did not install the new CLI"
version_count="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$version_count" == "2" ]] || fail "unexpected number of installed CLI versions: $version_count"
grep -Fq "$v2_release/bin/openalice.mjs" "$bin_dir/openalice" \
  || fail "stable launcher did not switch to the latest install"
[[ "$($bin_dir/openalice --version)" == "0.2.0" ]] || fail "switched CLI is not runnable"

grep -Fq "GET /packages/cli/package.json" "$server_log" \
  || fail "installer did not exercise the HTTP download branch"

echo "[install-docker-smoke] passed"
