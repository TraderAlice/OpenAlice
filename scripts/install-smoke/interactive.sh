#!/usr/bin/env bash
set -euo pipefail

if [[ ! -t 0 || ! -t 1 ]]; then
  echo "[install-playground] an interactive terminal is required" >&2
  exit 1
fi

server_log="$(mktemp)"
node /fixture/static-server.mjs >"$server_log" 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true
  [[ -z "${runtime_fixture_bin:-}" ]] || rm -rf "$runtime_fixture_bin"
  [[ -z "${runtime_deps_log:-}" ]] || rm -f "$runtime_deps_log"
  rm -f "$server_log"
}
trap cleanup EXIT

export OPENALICE_INSTALL_URL="http://127.0.0.1:18080/install"
export OPENALICE_INSTALL_BASE_URL="http://127.0.0.1:18080/packages/cli/"
runtime_fixture_bin="$(mktemp -d)"
runtime_deps_log="$(mktemp)"
cp /fixture/fake-package-manager.sh "$runtime_fixture_bin/fake-package-manager"
chmod +x "$runtime_fixture_bin/fake-package-manager"
ln -s fake-package-manager "$runtime_fixture_bin/apt-get"
ln -s fake-package-manager "$runtime_fixture_bin/sudo"
export OPENALICE_RUNTIME_DEPS_SHIM_DIR="$runtime_fixture_bin"
export OPENALICE_RUNTIME_DEPS_LOG="$runtime_deps_log"
export PATH="$runtime_fixture_bin:$PATH"

for _ in $(seq 1 100); do
  if curl --fail --silent --output /dev/null "$OPENALICE_INSTALL_URL"; then
    break
  fi
  sleep 0.1
done
curl --fail --silent --output /dev/null "$OPENALICE_INSTALL_URL" || {
  cat "$server_log" >&2
  exit 1
}

printf '\n[install-playground] Clean container ready: non-root, empty HOME, no pnpm, no external network.\n'
printf '[install-playground] Starting the same curl installer a user will see.\n\n'
printf '[install-playground] The installer first asks about source build tools, then pauses at the complete plan.\n'
printf '[install-playground] Choose either path and inspect every command before approving it.\n\n'
curl -fsSL "$OPENALICE_INSTALL_URL" | bash

if [[ -x "$HOME/.openalice/bin/openalice" ]]; then
  export PATH="$HOME/.openalice/bin:$PATH"
fi

printf '\n[install-playground] You are now in the container after the installer.\n'
printf 'Try: command -v openalice; openalice --version; cat ~/.bashrc\n'
printf 'Re-run: curl -fsSL "$OPENALICE_INSTALL_URL" | bash\n'
printf 'Preview only: curl -fsSL "$OPENALICE_INSTALL_URL" | bash -s -- --plan\n'
printf 'Runtime plan: curl -fsSL "$OPENALICE_INSTALL_URL" | bash -s -- --plan --with-runtime-deps\n'
printf 'Package log: cat "$OPENALICE_RUNTIME_DEPS_LOG"\n'
printf 'After a successful re-run: source ~/.bashrc\n'
printf 'Leave: exit\n\n'
export PS1='openalice-install> '
bash --noprofile --norc -i
