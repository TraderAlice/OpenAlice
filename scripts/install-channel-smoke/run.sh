#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "[install-channel-smoke] $*" >&2
  exit 1
}

installer_url="${OPENALICE_CHANNEL_INSTALLER_URL:?OPENALICE_CHANNEL_INSTALLER_URL is required}"
branch="${OPENALICE_CHANNEL_BRANCH:-dev}"
install_root="$HOME/.openalice"
installer_path="$(mktemp)"
plan_path="$(mktemp)"

cleanup() {
  rm -f "$installer_path" "$plan_path"
}
trap cleanup EXIT

[[ "$(id -u)" -ne 0 ]] || fail "container must run as a non-root user"
[[ -z "$(find "$HOME" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail "HOME is not empty"

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
  bash "$installer_path" --plan --branch "$branch" --no-modify-path >"$plan_path"
grep -Eq "^  Branch[[:space:]]+${branch}$" "$plan_path" \
  || fail "plan did not select branch $branch"
[[ ! -e "$install_root" ]] || fail "plan changed the install root"

OPENALICE_INSTALL_URL="$installer_url" \
  bash "$installer_path" --yes --branch "$branch" --no-modify-path \
    --install-dir "$install_root"

openalice="$install_root/bin/openalice"
pi="$install_root/bin/pi"
[[ -x "$openalice" ]] || fail "openalice launcher was not installed"
[[ -x "$pi" ]] || fail "managed Pi launcher was not installed"

version_json="$($openalice version --json)"
first_content_identity="$(node -e '
const value = JSON.parse(process.argv[1]);
const expectedBranch = process.env.OPENALICE_CHANNEL_BRANCH || "dev";
const expectedUrl = process.env.OPENALICE_CHANNEL_INSTALLER_URL;
if (value.installSource?.selector?.kind !== "branch") process.exit(1);
if (value.installSource?.selector?.value !== expectedBranch) process.exit(1);
if (value.installSource?.installerUrl !== expectedUrl) process.exit(1);
if (!/^[a-f0-9]{16}$/.test(value.contentIdentity || "")) process.exit(1);
process.stdout.write(value.contentIdentity);
' "$version_json")" || fail "installed CLI did not preserve dev-channel provenance"

[[ -n "$($openalice --version)" ]] || fail "installed OpenAlice CLI did not report a version"
[[ -n "$($pi --version)" ]] || fail "installed managed Pi did not report a version"

server_status="$($openalice server status --home "$HOME/runtime-smoke" --json)"
node -e '
const value = JSON.parse(process.argv[1]);
if (value.class !== "absent" || value.state !== "absent") process.exit(1);
' "$server_status" || fail "installed CLI could not execute server status"

OPENALICE_INSTALL_URL="$installer_url" \
  bash "$installer_path" --yes --branch "$branch" --no-modify-path \
    --install-dir "$install_root"

second_content_identity="$($openalice version --json | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => process.stdout.write(JSON.parse(input).contentIdentity || ""));
')"
[[ "$second_content_identity" == "$first_content_identity" ]] \
  || fail "identical channel install did not reuse the same content identity"

release_count="$(find "$install_root/cli-versions" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$release_count" == "1" ]] || fail "identical channel install created $release_count releases"

echo "[install-channel-smoke] passed $installer_url -> branch $branch ($first_content_identity)"
