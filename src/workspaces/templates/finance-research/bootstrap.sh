#!/usr/bin/env bash
# Bootstrap a finance-research workspace: same skeleton as `chat`
# (OpenAlice MCP wiring + Alice persona) plus a fresh clone of
# himself65/finance-skills with SKILL.md trees copied into both Claude
# Code's and Codex's project-local discovery paths.
#
# Contract:
#   argv:  $1 = tag, $2 = outDir
#   env:   AQ_TEMPLATE_FILES_DIR  — abs path to this template's files/
#          AQ_LAUNCHER_REPO_ROOT  — abs path to the OpenAlice repo root
# exit:  0 ok, non-zero on any failure
#
# Design notes (do not "optimize" without re-reading):
#   - Skill is a DISCOVERY structure, not a registration structure.
#     `.claude/skills/<name>/SKILL.md` is auto-discovered by Claude Code
#     when launched in this dir; `.agents/skills/<name>/SKILL.md` is
#     auto-discovered by Codex (per developers.openai.com/codex/skills,
#     verified 2026-05-15). So bootstrap is just: clone + cp. No
#     `claude plugin install`, no `npx skills add`, no marketplace
#     registration, no `~/.claude/plugins/` writes.
#   - We git clone himself65/finance-skills FRESH on every workspace
#     creation, intentionally NOT mirror-cached like Auto-Quant. Upstream
#     clone-traffic is co-promotion of an open-source author who's part
#     of the ecosystem we want to grow.
#   - Plugin selection (PLUGINS array) skips finance-startup-tools (not
#     trading-related), finance-ui-tools (generative UI, off-scope), and
#     finance-skill-creator (developer meta tool). Anyone wanting a
#     different selection edits this array — there's no need for a
#     config layer until that becomes a real ask.

set -euo pipefail

TAG="${1:?tag required}"
OUT_DIR="${2:?outDir required}"
: "${AQ_TEMPLATE_FILES_DIR:?AQ_TEMPLATE_FILES_DIR must be set by the launcher}"

source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"

FINANCE_SKILLS_REPO="https://github.com/himself65/finance-skills.git"
FINANCE_SKILLS_DIR=".finance-skills"
PLUGINS=(market-analysis social-readers data-providers)

init_workspace_dir "$OUT_DIR"
WS_ID="$(extract_ws_id "$OUT_DIR")"

write_mcp_config "$WS_ID" "$AQ_TEMPLATE_FILES_DIR"
compose_persona_claude_md "$AQ_TEMPLATE_FILES_DIR"

git init -q
# .finance-skills/ is the upstream clone; users shouldn't bake it into
# their own commits. Per-skill excludes (added below) keep user-authored
# skills in .claude/skills/<custom>/ trackable while keeping the bundled
# upstream ones invisible to git status.
setup_git_excludes "$FINANCE_SKILLS_DIR/" ".openalice-finance-info"

# ── Clone finance-skills (best effort) ──────────────────────────────────
FINANCE_OK=false
FINANCE_COMMIT=""
echo "[finance-research] cloning $FINANCE_SKILLS_REPO (shallow) ..." >&2
if git clone --depth=1 --quiet "$FINANCE_SKILLS_REPO" "$FINANCE_SKILLS_DIR" >&2; then
  FINANCE_OK=true
  FINANCE_COMMIT="$(git -C "$FINANCE_SKILLS_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "[finance-research] cloned at $FINANCE_COMMIT" >&2
else
  echo "[finance-research] WARN: git clone failed; workspace usable without finance-skills" >&2
fi

# ── Copy SKILL.md trees into discovery paths ────────────────────────────
SKILLS_INSTALLED=()
SKILLS_FAILED=()
if [[ "$FINANCE_OK" == "true" ]]; then
  mkdir -p .claude/skills .agents/skills
  for plugin in "${PLUGINS[@]}"; do
    src="$FINANCE_SKILLS_DIR/plugins/$plugin/skills"
    if [[ ! -d "$src" ]]; then
      echo "[finance-research] WARN: missing $src in upstream" >&2
      SKILLS_FAILED+=("$plugin/* (not in upstream)")
      continue
    fi
    for skill_dir in "$src"/*/; do
      [[ -d "$skill_dir" ]] || continue
      name="$(basename "$skill_dir")"
      # Loud-fail on collision rather than silent overwrite — if upstream
      # ever ships two skills with the same name across plugins, we want
      # to know.
      if [[ -e ".claude/skills/$name" ]] || [[ -e ".agents/skills/$name" ]]; then
        echo "[finance-research] WARN: skill name collision '$name'; skipping" >&2
        SKILLS_FAILED+=("$name (collision)")
        continue
      fi
      cp -R "$skill_dir" ".claude/skills/$name"
      cp -R "$skill_dir" ".agents/skills/$name"
      # Per-skill excludes — keep the bundled skills out of `git add .`
      # while leaving room for the user to author their own under
      # .claude/skills/ or .agents/skills/.
      echo ".claude/skills/$name" >> .git/info/exclude
      echo ".agents/skills/$name" >> .git/info/exclude
      SKILLS_INSTALLED+=("$name")
    done
  done
fi

# ── Debug breadcrumb ────────────────────────────────────────────────────
{
  echo "# OpenAlice finance-research workspace"
  echo "createdAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "tag: $TAG"
  echo "wsId: $WS_ID"
  echo "financeSkillsRepo: $FINANCE_SKILLS_REPO"
  echo "financeSkillsCloned: $FINANCE_OK"
  echo "financeSkillsCommit: ${FINANCE_COMMIT:-n/a}"
  echo "skillsInstalled: ${SKILLS_INSTALLED[*]:-none}"
  echo "skillsFailed: ${SKILLS_FAILED[*]:-none}"
  echo "discoveryPaths:"
  echo "  - .claude/skills/   (Claude Code)"
  echo "  - .agents/skills/   (Codex)"
} > .openalice-finance-info

commit_initial "$TAG" finance-research

if [[ ${#SKILLS_FAILED[@]} -gt 0 ]]; then
  echo "[finance-research] bootstrapped with WARN: ${SKILLS_FAILED[*]}" >&2
fi

echo "bootstrapped finance-research workspace '$TAG' at $OUT_DIR with ${#SKILLS_INSTALLED[@]} skills"
