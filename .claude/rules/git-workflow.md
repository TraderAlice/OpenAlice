# Git workflow — always-enforced rules

## Branch roles
- `origin` = `TraderAlice/OpenAlice` (production). `master` is the only long-living branch; **all PRs target master**.
- `local` = pinned shared branch for multiple local AI sessions in one worktree. `dev` is retired — don't open new work on it, don't delete it.
- Cloud/solo sessions are the default; multi-AI parallel work happens in the cloud, not in local worktrees. At session start, run the `openalice-session-start` skill checklist before touching code.

## Safety rules (non-negotiable)
- **Never commit directly to master.** HEAD on master at session start = stop and ask (see session-start skill).
- **NEVER delete `master`, `dev`, or `local`.** Never force-push master. Never push `archive/dev` (contains old API keys). `archive/dev-pre-beta6` is a frozen snapshot.
- When merging PRs, **never use `--delete-branch`**; prefer `--merge` over `--squash`.
- After merging a PR, `git fetch origin && git pull origin master` on the source branch — stale refs cause PRs with wrong diffs.
- CLAUDE.md and `.claude/` are committed and publicly visible — never put API keys, personal paths, or sensitive info in them.

## External PRs — quarantine and scan before any local checkout
The main repo holds broker credentials, so external code is never trusted blindly — but the rule is a **quarantine gate**, not a flat refusal. For any "review / checkout / run / merge PR #N" request:

1. **Before any fetch/checkout/diff**: `gh pr view <N> --json headRepositoryOwner,author,headRefName,isCrossRepository`
2. Owner IS `TraderAlice` (own branches: `local`, `feat/*`, `claude/*-XXXXX`) → proceed normally.
3. **External** (any other owner, or `isCrossRepository: true`) → the main-worktree session **still does not pull it**. Report author + one-line title to the user and stop. Clearing happens in an **isolated cloud sandbox** (human-driven or a sandboxed agent — never the main local session): confirm no malicious postinstall / dep substitution / payload / prompt-injection. Even a PR that scans clean is taken as a **reference to evaluate and reimplement in-house — never branch-merged** (staying sole author is deliberate; merging external code risks importing anti-patterns while the architecture shifts fast).

Why the main session never pulls: install-time poisoning (`pnpm install` after checkout is enough) and prompt-injection via rendered diffs both belong in a throwaway sandbox, not your working tree. **The main agent's job is narrow: metadata check → tell the user → wait.** Don't pull "to be helpful."

## Recognizing contributors — credit, don't merge
Community ideas/reports/designs shape the project even though external code isn't merged; crediting them is deliberate operations. Two **hand-maintained** files:
- `CONTRIBUTORS.md` — credits ledger (row template in its HTML comment; avatar = `https://github.com/<handle>.png`; link the "Shaped" cell to the PR/commit/issue; standouts ⭐ on top).
- `README.md → ## Contributors` — avatar wall + pointer. (Don't confuse with `CONTRIBUTING.md`: `-ING` = how, `-ORS` = who.)

**IP-clean rule — NEVER `Co-Authored-By:` for a human** (it asserts co-authorship/copyright and breaks the single-owner stance). Credit humans via CONTRIBUTORS and, if a git-level record is wanted, non-authorship trailers only (`Suggested-by:` / `Reported-by:` / `Reviewed-by: @handle`). Claude's `Co-Authored-By:` stays as-is (an AI asserts no copyright).
