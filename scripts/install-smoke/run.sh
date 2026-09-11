#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '[install-docker-smoke] %s\n' "$*" >&2
  exit 1
}

platform=linux
case "$(uname -m)" in
  x86_64|amd64) architecture=x64 ;;
  arm64|aarch64) architecture=arm64 ;;
  *) fail "unsupported fixture architecture" ;;
esac
fixture_root=/tmp/openalice-native-fixture

make_release() {
  local version="$1"
  local identity="$2"
  local release_name="openalice-cli-${version}-${platform}-${architecture}"
  local release="$fixture_root/$release_name"
  rm -rf "$release"
  mkdir -p "$release/bin" "$release/share/openalice/ui/dist"
  cat >"$release/bin/openalice" <<EOF
#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then printf '%s\\n' '$version'; exit 0; fi
if [ "\${1:-}" = "debug-env" ]; then
  printf '%s|%s|%s|%s|%s\\n' "\$OPENALICE_INSTALL_ROOT" "\$OPENALICE_RELEASE_DIR" "\$OPENALICE_INSTALL_SOURCE" "\$OPENALICE_CONTENT_IDENTITY" "\$OPENALICE_INSTALL_METHOD"
  exit 0
fi
printf 'fixture %s\\n' '$version'
EOF
  chmod 755 "$release/bin/openalice"
  printf '<!doctype html>\n' >"$release/share/openalice/ui/dist/index.html"
  cat >"$release/release.json" <<EOF
{"schemaVersion":1,"version":"$version","platform":"$platform","arch":"$architecture","contentIdentity":"$identity"}
EOF
  tar -czf "$fixture_root/$release_name.tar.gz" -C "$fixture_root" "$release_name"
  sha256sum "$fixture_root/$release_name.tar.gz" | awk '{print $1}' >"$fixture_root/$release_name.sha256"
}

prepare_fixtures() {
  mkdir -p "$fixture_root"
  make_release 0.91.0 aaaaaaaaaaaaaaaa
  make_release 0.92.0 bbbbbbbbbbbbbbbb
}

prepare_fixtures
if [[ "${1:-}" == --prepare-only ]]; then
  printf '%s\n' "$fixture_root"
  exit 0
fi

[[ "$(id -u)" -ne 0 ]] || fail "container must run as a non-root user"
for forbidden in node npm pnpm bun; do
  command -v "$forbidden" >/dev/null 2>&1 && fail "$forbidden must be absent from the clean fixture"
done

install_root="$HOME/.openalice"
archive_v1="$fixture_root/openalice-cli-0.91.0-${platform}-${architecture}.tar.gz"
archive_v2="$fixture_root/openalice-cli-0.92.0-${platform}-${architecture}.tar.gz"
sha_v1="$(cat "$fixture_root/openalice-cli-0.91.0-${platform}-${architecture}.sha256")"
sha_v2="$(cat "$fixture_root/openalice-cli-0.92.0-${platform}-${architecture}.sha256")"

plan="$(bash /fixture/install --archive "$archive_v1" --sha256 "$sha_v1" --install-dir "$install_root" --plan)"
grep -Fq 'OpenAlice does not manage: Agent Runtime executables' <<<"$plan" \
  || fail "plan omitted the Agent Runtime ownership boundary"
[[ ! -e "$install_root" ]] || fail "plan changed the install root"

refusal="$(mktemp)"
if bash /fixture/install --archive "$archive_v1" --sha256 "$sha_v1" --install-dir "$install_root" >"$refusal" 2>&1; then
  fail "non-interactive install proceeded without consent"
fi
grep -Fq -- '--yes' "$refusal" || fail "non-interactive refusal omitted --yes guidance"

bash /fixture/install --archive "$archive_v1" --sha256 "$sha_v1" --install-dir "$install_root" --yes
[[ "$("$install_root/bin/openalice" --version)" == 0.91.0 ]] || fail "first native release is not runnable"
[[ "$(readlink "$install_root/cli/current")" == "releases/0.91.0-${platform}-${architecture}-aaaaaaaaaaaaaaaa" ]] \
  || fail "first active pointer is wrong"
[[ ! -e "$install_root/bin/pi" ]] || fail "installer unexpectedly created a managed Pi launcher"
for helper in openalice alice alice-workspace alice-uta traderhub; do
  [[ -x "$install_root/bin/$helper" ]] || fail "missing launcher $helper"
done

mkdir -p "$install_root/data"
printf 'preserved\n' >"$install_root/data/state"
rm "$install_root/bin/openalice"
mkdir "$install_root/bin/openalice"
if bash /fixture/install --archive "$archive_v2" --sha256 "$sha_v2" --install-dir "$install_root" --yes >/tmp/failed-update.log 2>&1; then
  fail "post-activation launcher failure unexpectedly succeeded"
fi
[[ "$(readlink "$install_root/cli/current")" == "releases/0.91.0-${platform}-${architecture}-aaaaaaaaaaaaaaaa" ]] \
  || fail "failed install did not restore the exact previous pointer"
grep -Fq '"state": "rolled_back"' "$install_root/cli/activation.json" \
  || fail "failed install did not record rolled-back activation"
[[ "$(cat "$install_root/data/state")" == preserved ]] || fail "failed install changed user data"
rm -rf "$install_root/bin/openalice"

OPENALICE_INSTALL_KEEP_RELEASES=1 bash /fixture/install \
  --archive "$archive_v2" --sha256 "$sha_v2" --install-dir "$install_root" --yes
[[ "$("$install_root/bin/openalice" --version)" == 0.92.0 ]] || fail "updated native release is not runnable"
[[ "$(readlink "$install_root/cli/current")" == "releases/0.92.0-${platform}-${architecture}-bbbbbbbbbbbbbbbb" ]] \
  || fail "update did not atomically switch the active pointer"
[[ -d "$install_root/cli/releases/0.91.0-${platform}-${architecture}-aaaaaaaaaaaaaaaa" ]] \
  || fail "retention removed the pending rollback release"
grep -Fq '"state": "pending"' "$install_root/cli/activation.json" \
  || fail "update did not record pending activation"
grep -Fq '# >>> OpenAlice CLI >>>' "$HOME/.bashrc" || fail "installer did not add its managed PATH block"
[[ ! -e "$install_root/.cli-install.lock" ]] || fail "installer lock was not released"

printf '[install-docker-smoke] passed without Node, npm, pnpm, Bun, or an Agent Runtime\n'
