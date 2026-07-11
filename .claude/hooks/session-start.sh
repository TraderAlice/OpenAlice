#!/bin/bash
set -euo pipefail

# Bootstrap for Claude Code on the web / remote sandboxes only. Local
# machines manage their own `pnpm install` (and may want the real Electron
# binary, which this script deliberately skips).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Remote sandboxes route outbound HTTPS through a proxy that rejects the
# Electron binary CDN (403), and a headless sandbox can't use the binary
# anyway. Everything except Electron packaging works without it.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export ELECTRON_SKIP_BINARY_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"
fi

pnpm install
