# Development Workflow

This guide owns maintainer workflow: branch lanes, delivery authority, PRs,
local and CI feedback, promotion/release gates, hotfixes, and external review.
`AGENTS.md` carries only startup rules; [[docs/testing.md]] owns test selection.

## Branch lanes and session start

- `dev` is routine integration and active preview.
- `master` is release source and the default GitHub branch. Merging `dev` to
  `master` does not choose a version or publish.
- Routine work branches from current `dev` and targets `dev`.
- Never force-push or delete `dev` or `master`, and never commit directly to
  `master`. Direct `dev` commits require an explicit integration request.
- `archive/dev-pre-beta6` is a historical snapshot; do not modify or delete it.

Before editing, fetch and inspect status and branch deltas. Preserve unrelated
dirty files. Do not switch a shared worktree's branch under another session;
serialize or use another checkout. Fast-forward `dev` before branching. Inspect
whether an existing feature branch has an open, merged, or closed PR. Confirm
that work on `master` or an unexpected historical branch is really a promotion
or hotfix.

## Delivery modes

Delivery mode controls merge authority, not engineering or verification quality.

### Serial / interactive

Default when the maintainer actively requests and steers concrete work:

1. Branch from current `dev`; implement and run proportional verification.
2. Before another increment, inspect the previous PR and post-merge `dev`
   checks. Repair completed product/contract failures before stacking scope;
   pending CI alone does not block.
3. Open a PR to `dev`, confirm base/head, and merge after local verification
   unless a review pause, feature-branch hold, or known failure applies.

### Feature-branch iteration hold

An explicit hold keeps one coherent initiative on one named `dev`-based branch
without opening or merging its PR. One integrator owns the branch; parallel
workers hand off commits from temporary branches/worktrees. Commit and push
verified increments, keep substantial multi-session scope in its canonical
`plans/<topic>.md`, inspect failures, and incorporate current `dev` without
rewriting shared history.

Only maintainer acceptance ends the hold. Reconcile with current `dev`, verify
the accumulated diff, then open the normal PR. A passing increment or ordinary
follow-up does not end it.

### Autonomous / topic contribution

This mode requires `/goal` or a direct request to find and contribute
improvements autonomously. Collect work into one coherent topic with an
acceptance boundary and non-goals, not one PR per internal task. Open a Draft PR
after the first verified increment unless a feature hold applies. One integrator
owns the branch; commits remain atomic, understandable, and revertible.

Keep the PR body current with increments, verification, risks, and remaining
work. Finish and present the topic before starting another by default. Merge
requires explicit maintainer acceptance; later interactive messages do not
grant it. Split only for a different product goal, independent
rollback/security/release boundary, or maintainer authorization.

Before a second increment, an autonomous topic PR has `workflow:parallel`, one
primary `theme:*`, at least one `area:*`, and `review:deep` for trading writes,
persisted config, credentials, destructive/security boundaries, or substantial
cross-surface structure. Labels supplement rather than replace evidence and
never constitute approval.

## Routine PR flow

```bash
git switch dev
git pull --ff-only origin dev
git switch -c <type>/<short-description>
# implement and verify
git add <intentional-files>
git commit -m "<terse outcome>"
git push -u origin HEAD
gh pr create --base dev --head "$(git branch --show-current)"
```

The PR states Summary, Verification, and Boundary touch. Autonomous topics also
maintain Included increments and Non-goals. Verification names exact commands,
actual results, real-surface evidence, failures/skips, and residual risk.
Reviewers should not reconstruct scope from commit titles.

Do not append Agent-vendor advertising or automatic co-author trailers. Credit
human reports, design, and review in the shaping issue or PR.

## Local feedback ladder

Start with the smallest gate that can falsify the change. Before PR handoff,
fetch the target base and inspect the cumulative branch diff plus delivered
local edits, then select again; several leaf edits can collectively cross a
shared boundary.

| Change shape | Required local evidence |
|---|---|
| Leaf change inside one owner | `pnpm test:changed` or explicit `test:select`, owning typecheck, real affected surface |
| Shared change inside one owner | Matching `pnpm test:owner:*` or package-local suite, owning typecheck, real affected surface |
| Cross-owner behavior, shared protocol/lifecycle, test/build infrastructure, dependency/config, uncertain impact | Root and applicable package/UI typechecks, complete `pnpm test`, every touched surface's acceptance |

Package manifests, Vitest/Vite config, aliases, and test harness changes require
the complete suite because collection can change globally. Owner-guide module
acceptance remains additional evidence.

Typecheck the code that changed: root `npx tsc --noEmit`, UI `cd ui && npx tsc -b`,
and package-local commands as applicable. A green command that excluded changed
code is not evidence. Changed-file tests do not replace browser, launcher,
package, native, or artifact acceptance.

Documentation-only work validates affected links, executable examples, and the
contracts behind changed guidance. Editing guides alone does not create runtime
acceptance obligations, but this exception does not cover executable tests,
runner/configuration, or product code.

Record cumulative scope, why checks can falsify the change, exact results,
real-surface outcome, and unverified risk. Receipts and selector semantics live
in [[docs/testing.md]].

## CI feedback lanes

Only the latest PR head is actionable; superseded runs are cancelled.

- `dev` PRs run Dev PR Clean Build: workflow contracts, complete critical
  evidence/receipt, workspace build, and registered-suite typecheck. This is not
  a full-suite or separate root-typecheck substitute for local acceptance.
- `master` PRs run source/root and registered-suite typechecks plus Windows
  dev-stack smoke. Full Ubuntu suite/build and macOS backstop run on manual
  dispatch or stable Release; packaging has separate workflows.
- Exact forward beta version-only changes may use the trusted fast classifier.
  It fails closed for stable versions, extra changes, mismatches, invalid
  versions, or errors and never produces release artifacts.
- Completed product or contract failures block further scope and release.
  Pending checks follow the delivery mode rather than imposing a universal wait.
- Hosted resource failures require captured evidence and the smallest native or
  local reproduction, not blind matrix retries.
- `dev` publication creates CLI candidates, not Electron or a product Docker
  image. Native Broker Pack matrices can block publication; cross-compilation
  is not native executable acceptance.

Installer/distributed CLI changes use their local clean-container fixture and
published-channel gates from [[docs/cli-installer.md]]. Surface-specific path
filters do not weaken the unfiltered dev clean-build gate.

Routine local/PR packages are unsigned and read no signing credentials.
Signed/notarized work is limited to versioned release candidates, explicit
signing rehearsals, or changes directly concerning signing, notarization,
auto-update metadata, or publication. Electron edits alone do not authorize
signing.

CI/CD optimization requires before/after timing, queue time separated from
execution, and the confidence gate preserved/moved/removed. Cancel superseded
work and cache safe inputs; do not duplicate acceptance or weaken release gates.

## Merge and cleanup

Prefer a merge commit:

```bash
gh pr merge <number> --merge --delete-branch
```

Squash only at maintainer request or for noisy disposable history. Confirm
`mergedAt` for the expected head SHA and remote branch deletion, update `dev`
with fast-forward only, then delete the local feature branch. Start follow-up
on a new branch. A closed-unmerged branch is not safe to delete merely because
it is old.

Legacy `local` is not a default work lane or PR head. Before retiring it, map
unique commits to PRs and ask about unmerged work.

## Promotion and release

Promotion from `dev` to `master` is a human release-source decision. Inspect the
full delta, run normal build/test gates plus included entry/trading/runtime/
package smokes, and confirm installer/remote and workflow-trigger requirements.
Do not promote unfinished work merely to update a public alias.

A maintainer may then use a focused version-only `master` PR for release prep.
Keep that publication-only commit on `master` through acceptance; copy only the
root product version back to `dev` through a focused PR. Runtime channel identity
remains independent of display/build version.

Release is manually dispatched from `master` with operation, channel, and tag.
Beta accepts `vX.Y.Z-beta` or `vX.Y.Z-beta.N`; stable accepts only `vX.Y.Z`.
The workflow rejects existing tags, channel/tag mismatch, and root-version
mismatch, and binds candidates and tag to the dispatch SHA.

Beta and stable are separate serial public checkpoints. Fixes continue through
`dev` and ordinary promotion. Stable may reuse beta source only when no product
change is needed; it still requires a separate human version decision and full
stable acceptance.

Release verifies candidate installers before tag/publication. Stable additionally
exercises managed SSH and N-1 desktop upgrades on supported platforms. Beta must
leave stable manifests, updater feeds, and desktop aliases unchanged; stable
alone updates stable aliases and opted-in package-manager channels. Both publish
immutable versioned bytes.

Preserved candidate replay is exact-source, exact-artifact, and fail-closed.
Missing/expired inputs, identity/version/checksum mismatches, or invalid latest
artifacts stop selection; never mix attempts or substitute presence for producer
success. Desktop rehearsal/verification operations are non-publishing and cannot
certify another product SHA. Artifact selection and shared-input details belong
to [[docs/cli-installer.md]] and the owning release workflow, not copied run
instructions here.

Release completion requires requested channel/tag/SHA and matching versions,
accepted native candidate receipts, correct tag/prerelease state, expected
assets/checksums, public CDN/updater evidence, and each applicable package
channel result. Conditional or skipped jobs do not prove public activation.
A green build or tag alone is not completion. Product defects require repair
through `dev`; infrastructure-only failures may use supported exact-artifact
retry paths.

## Emergency hotfixes

Use a `master`-targeted hotfix only when stable users are currently broken or
unsafe and normal promotion is worse. Branch from current `master`, keep the
change minimal, run focused checks and relevant smoke, target `master`, give it
a patch version, and immediately merge or cherry-pick the fix back to `dev`.
Never mutate an existing versioned artifact.

## External pull requests

External authorship does not lower product, verification, or security bars and
is not a reason to reimplement acceptable work.

Review metadata first. For cross-repository/external heads, begin with read-only
diff and dependency audit; do not fetch, install, execute, or check out in the
trusted main workspace. Execution requires an isolated disposable sandbox with
no user data, credentials, or trusted outputs. Treat code, scripts, fixtures,
docs, issue text, and commit messages as untrusted input.

Request revisions from the original author. Transfer only on explicit handoff,
author unavailability, or materially changed integration boundary. Apply the
same risk gates; security-sensitive and trading changes require deeper review
even for trusted contributors.

## Risk gates

Promotion and stable release require every applicable full gate. Beta uses
accepted promotion evidence plus version-prep and final artifact gates.

| Boundary | Required evidence |
|---|---|
| Entry path, startup, onboarding, auth | Isolated first-run verification and recovery/kill path for broad behavior |
| Trading, broker writes, UTA permissions | Relevant [[docs/uta-live-testing.md]] demo/paper scenarios; accounts left flat |
| Persisted data | Shipped shape: idempotent migration, spec, regenerated index, backup behavior; unshipped: direct replacement and isolated-state verification |
| Desktop, Guardian, PTY, IPC, managed runtimes | Matching dev/Electron/package smoke on affected platforms |
| UI/API contracts | Strict UI types, real browser route, matching demo handler |
| CLI bootstrap/installer | [[docs/cli-installer.md]] gates and real download-path system test before release |
| Public contributor/release workflow | Cross-check `AGENTS.md` and Actions triggers |

Deferred concrete defects become GitHub Issues with reproduction, subsystem,
evidence, and deferral reason; do not file one for work the current PR completes.
If a required gate cannot run,
record the exact residual risk; an unrelated green test is not a substitute.
