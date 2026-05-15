#!/usr/bin/env bash
# Bootstrap script for Auto-Quant workspaces.
#
# Contract with the launcher (workspace-creator.ts):
#   argv:  $1 = tag (validated by the launcher: ^[a-z0-9][a-z0-9_-]{0,32}$)
#          $2 = outDir (absolute path the launcher wants the workspace at)
#   env:   AQ_LAUNCHER_ROOT       — optional; defaults to ~/.openalice/workspaces
#          AQ_TEMPLATE_DIR        — optional power-user override pointing at an
#                                   existing Auto-Quant clone. If unset or
#                                   invalid, we manage our own mirror clone of
#                                   https://github.com/TraderAlice/Auto-Quant
#                                   under $AQ_LAUNCHER_ROOT/auto-quant-mirror.
#   exit:  0 on success, non-zero on any failure (stderr surfaces to the API caller)
#
# Zero-config by default: a fresh OpenAlice install clones the public
# Auto-Quant repo on the first workspace creation. Subsequent creations
# reuse the local mirror via `git clone --local` (fast, disk-cheap
# hardlinks). To refresh the mirror, `cd $AQ_LAUNCHER_ROOT/auto-quant-mirror
# && git pull`, or `rm -rf` it to force a re-clone.
#
# Workspace isolation: each workspace owns its own `user_data/data/` (real
# directory, not a shared symlink). First-run inside the workspace, the
# user runs `uv run prepare.py` to fetch OHLCV from Binance into that
# workspace's data dir. Other workspaces don't see those bytes — they each
# fetch their own. This is deliberate: Auto-Quant's data schema may evolve
# between releases (different timeframes, different asset sets, different
# .feather column layouts), and a shared cache would silently mix incompat-
# ible files across workspace generations with no clean migration path.
# Disk cost (a few GB per workspace) is the trade.

set -euo pipefail

TAG="${1:?tag required}"
OUT_DIR="${2:?outDir required}"

if [[ -e "$OUT_DIR" ]]; then
  echo "outDir already exists: $OUT_DIR" >&2
  exit 2
fi

# ── Resolve Auto-Quant source ───────────────────────────────────────────────

AUTO_QUANT_UPSTREAM="https://github.com/TraderAlice/Auto-Quant.git"
LAUNCHER_ROOT="${AQ_LAUNCHER_ROOT:-$HOME/.openalice/workspaces}"
MIRROR="$LAUNCHER_ROOT/auto-quant-mirror"

SOURCE=""
if [[ -n "${AQ_TEMPLATE_DIR:-}" && -d "$AQ_TEMPLATE_DIR/.git" ]]; then
  # Power-user override: use the user's pre-existing Auto-Quant clone as-is.
  SOURCE="$AQ_TEMPLATE_DIR"
else
  # Default path: maintain our own mirror under the launcher root.
  if [[ ! -d "$MIRROR/.git" ]]; then
    echo "[auto-quant] no local mirror at $MIRROR; cloning $AUTO_QUANT_UPSTREAM ..." >&2
    mkdir -p "$(dirname "$MIRROR")"
    git clone --quiet "$AUTO_QUANT_UPSTREAM" "$MIRROR" >&2
  fi
  SOURCE="$MIRROR"
fi

if [[ ! -d "$SOURCE/.git" ]]; then
  echo "[auto-quant] no Auto-Quant source available at $SOURCE" >&2
  exit 3
fi

# ── Materialise the workspace ───────────────────────────────────────────────

# 1. local clone — hardlinks .git/objects, fast and disk-cheap.
git clone --local "$SOURCE" "$OUT_DIR" >/dev/null

cd "$OUT_DIR"

# 2. autoresearch branch from whatever master/main the source points at.
git checkout -b "autoresearch/$TAG" >/dev/null

# ── Agent-config excludes ────────────────────────────────────────────────
# Preemptive defense: if the user later configures workspace-specific AI
# provider via the OpenAlice UI (writing `.claude/settings.local.json` /
# `.codex/auth.json`), the per-clone exclude keeps those secrets out of any
# push to upstream Auto-Quant. Claude itself auto-ignores its file; this
# entry is defense-in-depth.
source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
setup_git_excludes

# 3. user_data/data is a real per-workspace directory. Auto-Quant's
#    `.gitignore` already excludes `user_data/data/`, so prepare.py's output
#    is untracked. If the SOURCE happens to ship pre-fetched data
#    (power-user override pointing at a clone with cached OHLCV), copy it
#    in so the user doesn't have to re-fetch.
mkdir -p user_data/data
if [[ -d "$SOURCE/user_data/data" ]]; then
  if [[ -n "$(ls -A "$SOURCE/user_data/data" 2>/dev/null)" ]]; then
    echo "[auto-quant] copying pre-fetched data from $SOURCE/user_data/data" >&2
    cp -R "$SOURCE/user_data/data/." user_data/data/
  fi
fi

# 4. results.tsv header — the agent appends rows from here on out.
printf 'commit\tevent\tstrategy_name\tsharpe\tmax_dd\tnote\n' > results.tsv

echo "bootstrapped autoresearch/$TAG at $OUT_DIR"
