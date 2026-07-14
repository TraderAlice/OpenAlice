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
  rm -f "$server_log"
}
trap cleanup EXIT

export OPENALICE_INSTALL_URL="http://127.0.0.1:18080/install"
export OPENALICE_INSTALL_BASE_URL="http://127.0.0.1:18080/packages/cli/"

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
printf '[install-playground] The installer will pause at its plan. Type y and press Enter to approve it.\n\n'
curl -fsSL "$OPENALICE_INSTALL_URL" | bash

if [[ -x "$HOME/.openalice/bin/openalice" ]]; then
  export PATH="$HOME/.openalice/bin:$PATH"
fi

printf '\n[install-playground] You are now in the container after the installer.\n'
printf 'Try: command -v openalice; openalice --version; cat ~/.bashrc\n'
printf 'Re-run: curl -fsSL "$OPENALICE_INSTALL_URL" | bash\n'
printf 'Preview only: curl -fsSL "$OPENALICE_INSTALL_URL" | bash -s -- --plan\n'
printf 'After a successful re-run: source ~/.bashrc\n'
printf 'Leave: exit\n\n'
export PS1='openalice-install> '
bash --noprofile --norc -i
