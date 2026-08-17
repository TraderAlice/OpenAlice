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
runtime_deps_log="$(mktemp)"
tui_log="$(mktemp)"
tui_input="$(mktemp)"
rm -f "$tui_input"
mkfifo "$tui_input"
tui_pid=""
runtime_fixture_bin="$(mktemp -d)"
cp /fixture/fake-package-manager.sh "$runtime_fixture_bin/fake-package-manager"
chmod +x "$runtime_fixture_bin/fake-package-manager"
ln -s fake-package-manager "$runtime_fixture_bin/apt-get"
ln -s fake-package-manager "$runtime_fixture_bin/sudo"
export OPENALICE_RUNTIME_DEPS_SHIM_DIR="$runtime_fixture_bin"
export OPENALICE_RUNTIME_DEPS_LOG="$runtime_deps_log"
export OPENALICE_NPM_BIN="/fixture/fake-npm.sh"
export OPENALICE_PI_SOURCE_DIR="/fixture/pi-assets"
export PATH="$runtime_fixture_bin:$PATH"
node /fixture/static-server.mjs >"$server_log" 2>&1 &
server_pid=$!
cleanup() {
  if [[ -n "$tui_pid" ]]; then
    kill "$tui_pid" >/dev/null 2>&1 || true
    wait "$tui_pid" >/dev/null 2>&1 || true
  fi
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true
  rm -rf "$runtime_fixture_bin"
  rm -f "$server_log" "$refusal_log" "$runtime_deps_log" "$tui_log" "$tui_input"
}
trap cleanup EXIT

installer_url="http://127.0.0.1:18080/install"
export OPENALICE_INSTALL_URL="$installer_url"
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
cli_version="$(node -p "require('/fixture/packages/cli/package.json').version")"

default_plan="$(curl -fsSL "$installer_url" | bash -s -- --plan)"
grep -Fq "Branch         master" <<<"$default_plan" || fail "installer did not default to master"
dev_plan="$(curl -fsSL "$installer_url" | bash -s -- --plan --branch dev)"
grep -Fq "Branch         dev" <<<"$dev_plan" || fail "installer did not accept an explicit dev branch"
if curl -fsSL "$installer_url" | bash -s -- --plan --branch dev --version v0.2.0 >"$refusal_log" 2>&1; then
  fail "installer accepted both --branch and --version"
fi
grep -Fq "Use only one of --branch or --version" "$refusal_log" \
  || fail "installer selector conflict was not explained"

if curl -fsSL "$installer_url" | bash -s -- --branch smoke-unattended >"$refusal_log" 2>&1; then
  fail "installer proceeded without interactive or explicit approval"
fi
grep -Fq -- "--yes" "$refusal_log" || fail "unattended refusal did not explain --yes"
[[ ! -e "$HOME/.openalice" ]] || fail "unattended refusal changed the install root"

install_branch() {
  local branch="$1"
  curl -fsSL "$installer_url" | bash -s -- --yes --branch "$branch"
}

install_branch_with_runtime_deps() {
  local branch="$1"
  curl -fsSL "$installer_url" | bash -s -- --yes --with-runtime-deps --branch "$branch"
}

mkdir -p "$HOME/.openalice/.cli-install.lock"
printf '99999999\n' > "$HOME/.openalice/.cli-install.lock/pid"
first_install_output="$(install_branch smoke-v1)"
printf '%s\n' "$first_install_output"
grep -Fq "Press Enter inside the Supervisor to prepare, start, and open OpenAlice." \
  <<<"$first_install_output" \
  || fail "source-only install did not explain the parameter-free first start"
grep -Fq "Use c only if you want to select an existing checkout instead." \
  <<<"$first_install_output" \
  || fail "source-only install did not keep manual checkout selection secondary"
grep -Fq "Activate OpenAlice in this terminal now (no restart required):" \
  <<<"$first_install_output" \
  || fail "installer did not offer immediate current-shell activation"
grep -Fq "export PATH=$HOME/.openalice/bin:\$PATH" \
  <<<"$first_install_output" \
  || fail "installer did not print the current-shell PATH command"

bin_dir="$HOME/.openalice/bin"
versions_dir="$HOME/.openalice/cli-versions"
[[ "$($bin_dir/openalice --version)" == "$cli_version" ]] || fail "installed CLI version check failed"
install_source="$($bin_dir/openalice version --json)"
node -e '
const value = JSON.parse(process.argv[1]);
const expectedVersion = process.argv[2];
if (value.version !== expectedVersion) process.exit(1);
if (value.installSource?.schemaVersion !== 2) process.exit(1);
if (value.installSource?.cliVersion !== expectedVersion) process.exit(1);
if (value.installSource?.selector?.kind !== "branch" || value.installSource?.selector?.value !== "smoke-v1") process.exit(1);
if (value.installSource?.installerUrl !== "http://127.0.0.1:18080/install") process.exit(1);
if (value.installSource?.updateChannel !== "development") process.exit(1);
' "$install_source" "$cli_version" || fail "installed CLI did not preserve its install source"
[[ "$($bin_dir/pi --version)" == "0.83.0" ]] || fail "installed managed Pi version check failed"
"$bin_dir/openalice" --help | grep -Fq "OpenAlice CLI" || fail "installed CLI help check failed"
wait_for_tui_log() {
  local pattern="$1"
  local failure="$2"
  for _ in $(seq 1 100); do
    if grep -Fq "$pattern" "$tui_log"; then
      return
    fi
    if ! kill -0 "$tui_pid" >/dev/null 2>&1; then
      cat "$tui_log" >&2
      fail "$failure (TUI exited early)"
    fi
    sleep 0.1
  done
  cat "$tui_log" >&2
  fail "$failure (timed out)"
}
script -qefc "$bin_dir/openalice" "$tui_log" <"$tui_input" >/dev/null &
tui_pid=$!
exec 3>"$tui_input"
wait_for_tui_log "q / Esc / Ctrl+C  Detach without stopping" \
  "installed bare TUI did not render"
printf '\r' >&3
wait_for_tui_log "installer-managed OpenAlice source branch smoke-v1" \
  "installed bare TUI did not derive managed Runtime setup from install provenance"
printf 'n' >&3
wait_for_tui_log "Action cancelled." \
  "installed bare TUI did not return from the managed Runtime confirmation"
printf 'q' >&3
exec 3>&-
wait "$tui_pid"
tui_pid=""
grep -Fq "installer-managed OpenAlice source branch smoke-v1" "$tui_log" \
  || fail "installed bare TUI did not derive managed Runtime setup from install provenance"
grep -Fq "Action cancelled." "$tui_log" \
  || fail "installed bare TUI did not return from the managed Runtime confirmation"
if grep -Fq "Configure Runtime source" "$tui_log"; then
  fail "installed bare TUI fell back to the manual checkout path"
fi
server_status="$($bin_dir/openalice server status --home "$HOME/openalice-server-smoke" --json)"
node -e '
const status = JSON.parse(process.argv[1]);
if (status.class !== "absent" || status.state !== "absent") process.exit(1);
' "$server_status" || fail "installed CLI server status check failed"
lifecycle_status="$($bin_dir/openalice status --home "$HOME/openalice-lifecycle-smoke" --json)"
node -e '
const value = JSON.parse(process.argv[1]);
if (value.schemaVersion !== 1 || value.command !== "status" || value.ok !== true) process.exit(1);
if (value.result?.status?.class !== "absent" || value.result?.status?.state !== "absent") process.exit(1);
' "$lifecycle_status" || fail "installed CLI lifecycle status envelope check failed"
logs_status="$($bin_dir/openalice logs --home "$HOME/openalice-lifecycle-smoke" --json)"
node -e '
const value = JSON.parse(process.argv[1]);
if (value.schemaVersion !== 1 || value.command !== "logs" || value.ok !== true) process.exit(1);
if (value.result?.logs?.home !== process.argv[2] || value.result?.logs?.entries?.length !== 0) process.exit(1);
' "$logs_status" "$HOME/openalice-lifecycle-smoke" || fail "installed CLI logs envelope check failed"
doctor_status="$($bin_dir/openalice doctor --home "$HOME/openalice-lifecycle-smoke" --json)"
node -e '
const value = JSON.parse(process.argv[1]);
if (value.schemaVersion !== 1 || value.command !== "doctor" || value.ok !== true) process.exit(1);
if (value.result?.doctor?.summary?.failures !== 0 || value.result?.doctor?.runtime?.class !== "absent") process.exit(1);
' "$doctor_status" || fail "installed CLI Doctor envelope check failed"
"$bin_dir/openalice" up --help | grep -Fq "installed OpenAlice Runtime" \
  || fail "installed CLI up help check failed"
"$bin_dir/openalice" completion bash | grep -Fq "complete -F _openalice_completion openalice" \
  || fail "installed CLI completion check failed"
[[ -f "$bin_dir/openalice.cmd" ]] || fail "Windows launcher was not installed"
[[ -f "$bin_dir/pi.cmd" ]] || fail "Windows managed Pi launcher was not installed"
[[ ! -e "$HOME/.openalice/.cli-install.lock" ]] || fail "installer lock was not released"
v1_release="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -name 'smoke-v1-*' -print -quit)"
[[ -n "$v1_release" && -f "$v1_release/bin/openalice.ts" ]] || fail "content-addressed CLI release was not installed"
[[ -f "$v1_release/install-source.json" ]] || fail "content-addressed CLI release omitted install source metadata"
[[ -f "$v1_release/managed/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" ]] \
  || fail "content-addressed managed Pi runtime was not installed"
grep -Fq "OPENALICE_MANAGED_PI_PATH" "$bin_dir/openalice" \
  || fail "OpenAlice launcher does not inject the managed Pi path"
cmp /fixture/packages/cli/src/local-start.mjs "$v1_release/src/local-start.mjs" \
  || fail "downloaded CLI file differs from the fixture"
cmp /fixture/packages/cli/src/doctor.mjs "$v1_release/src/doctor.mjs" \
  || fail "downloaded Doctor module differs from the fixture"
cmp /fixture/packages/cli/src/logs.mjs "$v1_release/src/logs.mjs" \
  || fail "downloaded logs module differs from the fixture"
cmp /fixture/packages/cli/src/observability-command.mjs "$v1_release/src/observability-command.mjs" \
  || fail "downloaded observability command module differs from the fixture"
cmp /fixture/packages/cli/src/install-source.mjs "$v1_release/src/install-source.mjs" \
  || fail "downloaded install-source module differs from the fixture"
cmp /fixture/packages/cli/src/install-layout.mjs "$v1_release/src/install-layout.mjs" \
  || fail "downloaded install-layout module differs from the fixture"
cmp /fixture/packages/cli/src/supervisor-config.ts "$v1_release/src/supervisor-config.ts" \
  || fail "downloaded Supervisor configuration module differs from the fixture"
cmp /fixture/packages/cli/src/managed-source.ts "$v1_release/src/managed-source.ts" \
  || fail "downloaded managed source module differs from the fixture"
cmp /fixture/packages/cli/src/runtime-bundle.mjs "$v1_release/src/runtime-bundle.mjs" \
  || fail "downloaded Runtime bundle module differs from the fixture"
cmp /fixture/packages/cli/src/lifecycle-command.mjs "$v1_release/src/lifecycle-command.mjs" \
  || fail "downloaded lifecycle command module differs from the fixture"
cmp /fixture/packages/cli/src/lifecycle.mjs "$v1_release/src/lifecycle.mjs" \
  || fail "downloaded lifecycle core module differs from the fixture"
cmp /fixture/packages/cli/src/remote.mjs "$v1_release/src/remote.mjs" \
  || fail "downloaded Remote CLI file differs from the fixture"
cmp /fixture/packages/cli/src/runtime-deps.mjs "$v1_release/src/runtime-deps.mjs" \
  || fail "downloaded Runtime dependency probe differs from the fixture"
cmp /fixture/packages/cli/src/server.mjs "$v1_release/src/server.mjs" \
  || fail "downloaded Server CLI file differs from the fixture"
cmp /fixture/packages/cli/src/server-control.mjs "$v1_release/src/server-control.mjs" \
  || fail "downloaded Server control file differs from the fixture"
cmp /fixture/packages/cli/src/update.mjs "$v1_release/src/update.mjs" \
  || fail "downloaded update module differs from the fixture"
cmp /fixture/packages/cli/src/uninstall.mjs "$v1_release/src/uninstall.mjs" \
  || fail "downloaded uninstall module differs from the fixture"

rm -rf "$v1_release/managed/pi/node_modules/@earendil-works/pi-tui"
install_branch smoke-v1
damaged_release="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d \
  -name "$(basename "$v1_release").damaged.*" -print -quit)"
[[ -n "$damaged_release" ]] \
  || fail "installer reused a release whose managed Pi TUI dependency was missing"
node -e '
  const { createRequire } = require("node:module");
  createRequire(process.argv[1]).resolve("@earendil-works/pi-tui");
' "$v1_release/managed/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" \
  || fail "installer did not repair the managed Pi TUI dependency"
rm -rf "$damaged_release"

expected_path_line="export PATH=$HOME/.openalice/bin:\$PATH"
path_count="$(grep -Fxc "$expected_path_line" "$HOME/.bashrc" || true)"
[[ "$path_count" == "1" ]] || fail "installer did not add exactly one shell PATH entry"
[[ "$(grep -Fxc '# >>> OpenAlice CLI >>>' "$HOME/.bashrc" || true)" == "1" ]] \
  || fail "installer did not add its managed PATH block"

[[ ! -s "$runtime_deps_log" ]] || fail "default install changed system packages"
runtime_plan="$(curl -fsSL "$installer_url" | bash -s -- --plan --with-runtime-deps --branch smoke-v1)"
grep -Fq "sudo apt-get update && sudo apt-get install -y git python3 make g++" <<<"$runtime_plan" \
  || fail "runtime dependency plan did not show the exact package command"
[[ ! -s "$runtime_deps_log" ]] || fail "runtime dependency plan changed system packages"

install_branch_with_runtime_deps smoke-v1
grep -Fxq "apt-get update" "$runtime_deps_log" || fail "runtime dependency setup skipped apt-get update"
grep -Fxq "apt-get install -y git python3 make g++" "$runtime_deps_log" \
  || fail "runtime dependency setup used the wrong package list"
for tool in git python3 make g++; do
  command -v "$tool" >/dev/null 2>&1 || fail "runtime dependency setup did not provide $tool"
done

install_branch smoke-v1
path_count="$(grep -Fxc "$expected_path_line" "$HOME/.bashrc" || true)"
[[ "$path_count" == "1" ]] || fail "repeat install duplicated the shell PATH entry"
v1_count="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -name 'smoke-v1-*' | wc -l | tr -d ' ')"
[[ "$v1_count" == "1" ]] || fail "repeat install duplicated an identical CLI release"

update_check="$("$bin_dir/openalice" update --check)"
grep -Fq "stable release update checks are disabled" <<<"$update_check" \
  || fail "development-channel CLI did not explain its update policy"

curl -fsSL "$installer_url" | bash -s -- --yes --version smoke-v2
v2_release="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -name 'smoke-v2-*' -print -quit)"
[[ -d "$v1_release" ]] || fail "version switch removed the previous CLI"
[[ -n "$v2_release" && -d "$v2_release" ]] || fail "version switch did not install the new CLI"
version_count="$(find "$versions_dir" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$version_count" == "2" ]] || fail "unexpected number of installed CLI versions: $version_count"
grep -Fq "$v2_release/bin/openalice.ts" "$bin_dir/openalice" \
  || fail "stable launcher did not switch to the latest install"
[[ "$($bin_dir/openalice --version)" == "$cli_version" ]] || fail "switched CLI is not runnable"

grep -Fq "GET /packages/cli/package.json" "$server_log" \
  || fail "installer did not exercise the HTTP download branch"

mkdir -p "$HOME/.openalice/data" "$HOME/.openalice/workspaces" "$HOME/.openalice/sources"
printf 'state\n' > "$HOME/.openalice/data/preserved"
printf 'desk\n' > "$HOME/.openalice/workspaces/preserved"
printf 'checkout\n' > "$HOME/.openalice/sources/preserved"
printf 'keys\n' > "$HOME/.openalice/provider-keys.json"
printf 'seal\n' > "$HOME/.openalice/sealing.key"
uninstall_plan="$("$bin_dir/openalice" uninstall --plan)"
grep -Fq "$HOME/.openalice/workspaces" <<<"$uninstall_plan" \
  || fail "uninstall plan did not name preserved Workspaces"
"$bin_dir/openalice" uninstall --yes
[[ ! -e "$bin_dir/openalice" ]] || fail "uninstall left the OpenAlice launcher"
[[ ! -e "$versions_dir" ]] || fail "uninstall left immutable CLI releases"
[[ -f "$HOME/.openalice/data/preserved" ]] || fail "uninstall removed application data"
[[ -f "$HOME/.openalice/workspaces/preserved" ]] || fail "uninstall removed Workspaces"
[[ -f "$HOME/.openalice/sources/preserved" ]] || fail "uninstall removed source checkouts"
[[ -f "$HOME/.openalice/provider-keys.json" ]] || fail "uninstall removed provider credentials"
[[ -f "$HOME/.openalice/sealing.key" ]] || fail "uninstall removed the sealing key"
[[ "$(grep -Fxc '# >>> OpenAlice CLI >>>' "$HOME/.bashrc" || true)" == "0" ]] \
  || fail "uninstall left the managed PATH block"

echo "[install-docker-smoke] passed"
