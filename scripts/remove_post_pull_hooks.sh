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
  if [ ! -f "$target" ]; then
    echo "hook not found, skip: $target"
    return 0
  fi

  local tmp
  tmp="$(mktemp)"
  awk -v s="$BLOCK_START" -v e="$BLOCK_END" '
    BEGIN { skip = 0 }
    $0 == s { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip { print $0 }
  ' "$target" > "$tmp"
  mv "$tmp" "$target"

  if [ -s "$target" ]; then
    chmod +x "$target"
  fi
  echo "removed managed block from $target"
}

strip_managed_block "$HOOKS_DIR/post-merge"
strip_managed_block "$HOOKS_DIR/post-checkout"

echo "openalice post-pull hooks removed."
