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

# write_mcp_config + compose_persona_claude_md moved into the launcher
# (src/workspaces/context-injector.ts) — the launcher now owns MCP and persona
# injection, gated per template by template.json flags.

# copy_readme [template_root]
# Copies $template_root/README.md into the current dir (the workspace root)
# so the workspace is self-describing on disk. The instance README is the
# agent's territory from this point on — body and frontmatter (including
# `version:`) can both drift. The pristine template README stays in source
# tree under $template_root and is what the showcase page renders.
#
# $template_root defaults to $AQ_TEMPLATE_ROOT (injected by the launcher).
# No-op if no README.md exists at the template root — templates without a
# README work fine, they just don't get a self-description file. That's a
# soft convention, not a hard contract.
copy_readme() {
  local template_root="${1:-${AQ_TEMPLATE_ROOT:-}}"
  if [[ -z "$template_root" ]]; then
    echo "copy_readme: no template_root (set AQ_TEMPLATE_ROOT or pass arg)" >&2
    return 0
  fi
  local src="$template_root/README.md"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  cp "$src" README.md
}

# setup_git_excludes [extra_path...]
# Appends defensive entries to .git/info/exclude (per-clone, untracked).
# Always includes:
#   - .claude/settings.local.json   (workspace-specific Claude config)
#   - .codex/auth.json              (workspace-local Codex auth)
#   - .codex/env.json               (workspace-local Codex API-key bridge)
#   - .codex/config.toml            (workspace-local Codex provider config)
#   - opencode.json                 (workspace-local opencode provider config)
#   - .pi-agent/                    (workspace-local Pi provider + settings)
# All five carry a per-workspace API key once a provider is configured (UI or
# template-injected), so they must never reach a commit.
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
    echo '.codex/env.json'
    echo '.codex/config.toml'
    echo 'opencode.json'
    echo '.pi-agent/'
    for extra in "$@"; do
      echo "$extra"
    done
  } >> .git/info/exclude
}

# commit_initial moved into the launcher (workspace-creator.ts `commitInitial`).
# Every workspace's initial commit is now made uniformly by the launcher after
# context injection — the "Harness rule": fresh git, one clean initial commit.
