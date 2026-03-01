#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
BLOCK_START="# >>> openalice post-pull sync >>>"
BLOCK_END="# <<< openalice post-pull sync <<<"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "hooks directory not found: $HOOKS_DIR" >&2
  exit 1
fi

strip_managed_block() {
  local target="$1"
  local tmp
  tmp="$(mktemp)"
  awk -v s="$BLOCK_START" -v e="$BLOCK_END" '
    BEGIN { skip = 0 }
    $0 == s { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip { print $0 }
  ' "$target" > "$tmp"
  mv "$tmp" "$target"
}

ensure_shebang() {
  local target="$1"
  local first
  first="$(head -n 1 "$target" 2>/dev/null || true)"
  if [[ "$first" == "#!"* ]]; then
    return 0
  fi
  local tmp
  tmp="$(mktemp)"
  {
    echo "#!/usr/bin/env sh"
    cat "$target"
  } > "$tmp"
  mv "$tmp" "$target"
}

install_hook() {
  local hook_name="$1"
  local target="$HOOKS_DIR/$hook_name"
  touch "$target"
  strip_managed_block "$target"
  ensure_shebang "$target"

  cat >> "$target" <<EOF
$BLOCK_START
if command -v pnpm >/dev/null 2>&1; then
  pnpm sync:post-pull >/tmp/openalice.postpull.${hook_name}.log 2>&1 || {
    echo "[openalice] post-pull sync failed for ${hook_name}. See /tmp/openalice.postpull.${hook_name}.log" >&2
  }
else
  echo "[openalice] pnpm not found. skip sync:post-pull" >&2
fi
$BLOCK_END
EOF

  chmod +x "$target"
  echo "installed managed block into $target"
}

install_hook "post-merge"
install_hook "post-checkout"

echo "openalice post-pull hooks installed."
