#!/usr/bin/env bash
# Bootstrap a chat workspace: an empty git directory wired to OpenAlice's
# MCP server, with Alice's persona dropped in as both CLAUDE.md (Claude
# Code's convention) and AGENTS.md (Codex / general convention) so the
# agent — whichever the user picks — boots already "as Alice".
#
# Contract:
#   argv:  $1 = tag, $2 = outDir
#   env:   AQ_TEMPLATE_FILES_DIR  — abs path to this template's files/
#          AQ_LAUNCHER_REPO_ROOT  — abs path to the OpenAlice repo root
#                                   (used to find Alice's live persona)
# exit:  0 ok, non-zero on any failure

set -euo pipefail

TAG="${1:?tag required}"
OUT_DIR="${2:?outDir required}"
: "${AQ_TEMPLATE_FILES_DIR:?AQ_TEMPLATE_FILES_DIR must be set by the launcher}"

source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"

init_workspace_dir "$OUT_DIR"
WS_ID="$(extract_ws_id "$OUT_DIR")"

write_mcp_config "$WS_ID" "$AQ_TEMPLATE_FILES_DIR"
compose_persona_claude_md "$AQ_TEMPLATE_FILES_DIR"

git init -q
setup_git_excludes
commit_initial "$TAG" chat

echo "bootstrapped chat workspace '$TAG' at $OUT_DIR"
