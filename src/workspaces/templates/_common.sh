# Shared bash helpers for workspace bootstrap scripts.
#
# Sourced by templates/<name>/bootstrap.sh via:
#   source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
#
# Each helper is self-contained and validates its own inputs. Helpers exit
# non-zero on irrecoverable errors so the launcher (workspace-creator.ts)
# surfaces the failure to the user via stderr.
#
# Templates that don't need a particular helper just don't call it —
# auto-quant for example only uses setup_git_excludes because it has its
# own clone-and-branch flow that init_workspace_dir would conflict with.

# init_workspace_dir <out_dir>
# Verifies $out_dir doesn't yet exist, creates it, cd's into it.
init_workspace_dir() {
  local out_dir="${1:?init_workspace_dir: out_dir required}"
  if [[ -e "$out_dir" ]]; then
    echo "outDir already exists: $out_dir" >&2
    exit 2
  fi
  mkdir -p "$out_dir"
  cd "$out_dir"
}

# extract_ws_id <out_dir>
# Echoes the workspace UUID — by convention the basename of $out_dir
# (the launcher names the directory with the random UUID it assigns).
extract_ws_id() {
  local out_dir="${1:?extract_ws_id: out_dir required}"
  basename "$out_dir"
}

# write_mcp_config <ws_id> <template_files_dir>
# Reads $template_files_dir/mcp.json, substitutes __WS_ID__ -> $ws_id,
# writes result to ./.mcp.json in the current dir. ${OPENALICE_MCP_URL}
# placeholder is left intact for the agent CLI to evaluate at spawn time.
write_mcp_config() {
  local ws_id="${1:?write_mcp_config: ws_id required}"
  local files_dir="${2:?write_mcp_config: template_files_dir required}"
  local src="$files_dir/mcp.json"
  if [[ ! -f "$src" ]]; then
    echo "write_mcp_config: missing $src" >&2
    exit 3
  fi
  sed "s|__WS_ID__|$ws_id|g" "$src" > .mcp.json
}

# compose_persona_claude_md <template_files_dir> [repo_root]
# Composes ./CLAUDE.md as: Alice persona + "---" separator + template CLAUDE.md.
# Persona source: prefers $repo_root/data/brain/persona.md (live user edit),
# falls back to $repo_root/default/persona.default.md (shipped default).
# If $repo_root is unset/missing, skips persona prepend gracefully — the
# template's own CLAUDE.md is still written. Also copies the result to
# AGENTS.md so Codex / other AGENTS.md-aware CLIs see the same identity.
compose_persona_claude_md() {
  local files_dir="${1:?compose_persona_claude_md: template_files_dir required}"
  local repo_root="${2:-${AQ_LAUNCHER_REPO_ROOT:-}}"
  local template_md="$files_dir/CLAUDE.md"
  if [[ ! -f "$template_md" ]]; then
    echo "compose_persona_claude_md: missing $template_md" >&2
    exit 4
  fi
  local persona_src=""
  if [[ -n "$repo_root" ]]; then
    if [[ -f "$repo_root/data/brain/persona.md" ]]; then
      persona_src="$repo_root/data/brain/persona.md"
    elif [[ -f "$repo_root/default/persona.default.md" ]]; then
      persona_src="$repo_root/default/persona.default.md"
    fi
  fi
  {
    if [[ -n "$persona_src" ]]; then
      cat "$persona_src"
      printf '\n\n---\n\n'
    fi
    cat "$template_md"
  } > CLAUDE.md
  cp CLAUDE.md AGENTS.md
}

# setup_git_excludes [extra_path...]
# Appends defensive entries to .git/info/exclude (per-clone, untracked).
# Always includes:
#   - .claude/settings.local.json   (workspace-specific Claude config)
#   - .codex/auth.json              (workspace-local Codex auth)
# Extra paths passed as args are appended too — useful for templates that
# clone third-party content (e.g. finance-research clones .finance-skills/
# and doesn't want git add . to swallow it).
# Caller must ensure .git/ exists (run after `git init` or `git clone`).
setup_git_excludes() {
  if [[ ! -d .git ]]; then
    echo "setup_git_excludes: no .git/ in $(pwd)" >&2
    exit 5
  fi
  {
    echo '.claude/settings.local.json'
    echo '.codex/auth.json'
    for extra in "$@"; do
      echo "$extra"
    done
  } >> .git/info/exclude
}

# commit_initial <tag> <template_name>
# `git add . && git commit` with a launcher-stamped author. Used by templates
# that init their own git repo (chat, finance-research). auto-quant doesn't
# call this — its `git clone --local` already produces a working tree at
# the source's HEAD, and its bootstrap creates a new branch instead.
commit_initial() {
  local tag="${1:?commit_initial: tag required}"
  local template_name="${2:?commit_initial: template_name required}"
  git add .
  git -c user.email=launcher@local -c user.name=launcher \
      commit -q -m "$template_name: $tag"
}
