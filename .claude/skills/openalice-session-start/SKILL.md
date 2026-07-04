---
name: openalice-session-start
description: Open-of-session checklist for OpenAlice — run before touching any code. Determines local vs cloud mode, syncs branches safely, and sets up the correct working branch. Triggers: "session start", "open of session", "which branch", "start working on OpenAlice".
---

# Open-of-session checklist (every session, first action)

Every session — local OR cloud — runs these three steps before touching code. They're the entire price you pay for not landing on stale or wrong state.

```bash
git fetch origin
git status                              # what branch are we on right now?
git log --oneline origin/master..HEAD   # what's ahead of master?
```

Then branch on the result:

1. **`HEAD` is `master`** — do NOT start work here. Ask the user: *"Local or remote session? If local, do you want to work on `local`, or branch off for a focused feature (`feat/<name>`)?"* Wait for direction; create/switch only after.

2. **`HEAD` is a `feat/<name>` (or similar solo-purpose branch)** — the cloud / solo-AI case. Bring it up to date with master so the eventual PR has a clean diff: `git merge origin/master` (or rebase, if no one else is on this branch). Then continue.

3. **`HEAD` is `local`** — the shared local-collab branch. First sync master in (cloud sessions may have shipped while you were away): `git pull origin local && git merge origin/master`. If the merge conflicts, resolve before doing anything else — another local session may be waiting for the working tree.

4. **`HEAD` is `dev` or another historical branch** — flag it to the user, don't assume it's intentional. `dev` is retired.

## Cloud / solo-AI sessions (the default)

Each cloud session gets its own branch, its own PR, its own review cycle.

```bash
git fetch origin
git checkout master && git pull origin master
git checkout -b feat/<short-desc>     # cloud auto-names claude/<desc>-XXXXX — fine too

# ... do the work ...

git push -u origin feat/<short-desc>
gh pr create --base master --head feat/<short-desc> --title "<title>" --body-file <(...)
```

PR body template:

```markdown
## Summary
<what changed and why — 1–4 bullets, written for a 30-second director-review>

## Test plan
- [ ] tsc --noEmit clean
- [ ] pnpm test passes
- [ ] (whatever manual verifications apply)

## Boundary touch
<flag if this PR touches trading / auth / broker credentials / migrations. Omit if none.>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

After merge: `git checkout master && git pull origin master`. Don't keep working on the post-merge branch.

## Local / shared `local` branch (multi-AI-on-one-worktree exception)

When the user confirms a session is local and wants `local`:

```bash
# First-time only, if `local` doesn't exist yet:
git fetch origin && git checkout master && git pull origin master
git checkout -b local && git push -u origin local
```

Subsequent local sessions: just `git checkout local` (the checklist above already pulled origin and merged master).

Shipping `local` — piecewise (one PR per coherent chunk, base `master`) or as a batch — is a director decision. Ask the user before opening the PR.
