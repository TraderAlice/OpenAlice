#!/usr/bin/env bash
# Bootstrap a chat-cli workspace: a bare git repo + README, nothing more.
#
# Context injection — `.mcp.json` (inbox-only; see template.json `injectMcp`),
# Alice persona composed into CLAUDE.md / AGENTS.md, and bundled skills
# (including openalice-cli) — is done by the launcher AFTER this script, gated
# by template.json flags (see context-injector.ts). The launcher also makes the
# initial commit. This script just lays down the bare workspace and inits git.
#
# Contract:
#   argv:  $1 = tag, $2 = outDir
#   env:   AQ_TEMPLATE_ROOT  — abs path to this template's root (for README)
# exit:  0 ok, non-zero on any failure

set -euo pipefail

TAG="${1:?tag required}"
OUT_DIR="${2:?outDir required}"

source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"

init_workspace_dir "$OUT_DIR"
copy_readme

git init -q
setup_git_excludes

echo "bootstrapped chat-cli workspace '$TAG' at $OUT_DIR"
