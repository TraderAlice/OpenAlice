#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "[install-channel-smoke] $*" >&2
  exit 1
}

installer_url="${OPENALICE_CHANNEL_INSTALLER_URL:?OPENALICE_CHANNEL_INSTALLER_URL is required}"
channel="${OPENALICE_CHANNEL:-dev}"
install_root="$HOME/.openalice"
installer_path="$(mktemp)"
plan_path="$(mktemp)"

cleanup() {
  rm -f "$installer_path" "$plan_path"
}
trap cleanup EXIT

[[ "$(id -u)" -ne 0 ]] || fail "container must run as a non-root user"
[[ -z "$(find "$HOME" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail "HOME is not empty"
for command in node npm pnpm bun pi opencode codex claude; do
  ! command -v "$command" >/dev/null 2>&1 \
    || fail "clean host unexpectedly provides $command"
done

for attempt in $(seq 1 10); do
  if curl --fail --silent --show-error --location \
    --output "$installer_path" "$installer_url"; then
    break
  fi
  [[ "$attempt" -lt 10 ]] || fail "could not download $installer_url"
  sleep "$attempt"
done

head -n 1 "$installer_path" | grep -Fq '#!/usr/bin/env bash' \
  || fail "channel endpoint did not return the OpenAlice Bash installer"
bash -n "$installer_path"

OPENALICE_INSTALL_URL="$installer_url" \
  bash "$installer_path" --plan --channel "$channel" --no-modify-path >"$plan_path"
grep -Eq "^Channel[[:space:]]+development \(${channel}\)$" "$plan_path" \
  || fail "plan did not select the development channel"
grep -Eq "^Platform[[:space:]]+linux-(x64|arm64)$" "$plan_path" \
  || fail "plan did not select a supported Linux native target"
grep -Eq "^Artifact[[:space:]]+https://download\.openalice\.ai/cli/dev/openalice-cli-dev-linux-(x64|arm64)\.tar\.gz$" "$plan_path" \
  || fail "plan did not select the fixed native dev artifact"
[[ ! -e "$install_root" ]] || fail "plan changed the install root"

OPENALICE_INSTALL_URL="$installer_url" \
  bash "$installer_path" --yes --channel "$channel" --no-modify-path \
    --install-dir "$install_root"

openalice="$install_root/bin/openalice"
[[ -x "$openalice" ]] || fail "openalice launcher was not installed"
for helper in alice alice-workspace alice-uta traderhub; do
  [[ -x "$install_root/bin/$helper" ]] || fail "$helper launcher was not installed"
done
[[ ! -e "$install_root/bin/pi" ]] || fail "installer unexpectedly created a managed Pi launcher"

version_json="$($openalice version --json)"
first_content_identity="$(printf '%s' "$version_json" | jq -er \
    --arg channel "$channel" \
  --arg installer_url "$installer_url" '
    select(.installSource.schemaVersion == 3)
    | select(.installSource.selector.kind == "branch")
    | select(.installSource.selector.value == $channel)
    | select(.installSource.installerUrl == $installer_url)
    | select(.installSource.updateChannel == "development")
    | select(.installSource.method == "direct")
    | select(.managedRuntime.path != null)
    | .contentIdentity
    | select(test("^[a-f0-9]{16}$"))
  ')" || fail "installed CLI did not preserve native dev-channel provenance"

[[ -n "$($openalice --version)" ]] || fail "installed OpenAlice CLI did not report a version"
[[ -n "$($openalice completion bash)" ]] || fail "installed OpenAlice CLI could not render completion"

runtime_status="$($openalice status --home "$HOME/runtime-smoke" --json)"
printf '%s' "$runtime_status" | jq -e '
  .schemaVersion == 1
  and .command == "status"
  and .ok == true
  and .result.status.class == "absent"
  and .result.status.state == "absent"
' >/dev/null || fail "installed CLI could not execute native Runtime status"

OPENALICE_INSTALL_URL="$installer_url" \
  bash "$installer_path" --yes --channel "$channel" --no-modify-path \
    --install-dir "$install_root"

second_content_identity="$($openalice version --json | jq -er '.contentIdentity')"
[[ "$second_content_identity" == "$first_content_identity" ]] \
  || fail "identical channel install did not reuse the same content identity"

release_count="$(find "$install_root/cli/releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$release_count" == "1" ]] || fail "identical channel install created $release_count releases"

for command in node npm pnpm bun pi opencode codex claude; do
  ! command -v "$command" >/dev/null 2>&1 \
    || fail "native install unexpectedly provided $command"
done

echo "[install-channel-smoke] passed $installer_url -> channel $channel ($first_content_identity)"
