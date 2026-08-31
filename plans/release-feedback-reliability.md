# Release Feedback Reliability

Status: Active

Related evidence:

- [0.89.3-beta release run 31495757352](https://github.com/TraderAlice/OpenAlice/actions/runs/31495757352)
- [master CI run 31495757321](https://github.com/TraderAlice/OpenAlice/actions/runs/31495757321)
- [promotion PR #1060](https://github.com/TraderAlice/OpenAlice/pull/1060)
- [Batch 1 serial PR #1061](https://github.com/TraderAlice/OpenAlice/pull/1061) — merged to `dev` on 2026-08-11
- [0.91 test-isolation PR #1272](https://github.com/TraderAlice/OpenAlice/pull/1272)
- [0.91 source-promotion PR #1273](https://github.com/TraderAlice/OpenAlice/pull/1273)
- [0.91 version-only PR #1271](https://github.com/TraderAlice/OpenAlice/pull/1271)
- [0.91.0-beta.1 release run 33329951354](https://github.com/TraderAlice/OpenAlice/actions/runs/33329951354)

Owner guides:

- [[../docs/development-workflow.md]]
- [[../docs/managed-workspace-runtime.md]]

## Scope

Make release failures arrive earlier and carry enough evidence to diagnose
without rerunning an hour-long pipeline. The first batch repairs deterministic
feedback defects observed during the 0.89.3-beta release without changing any
release gate. The second batch records the dependency and provenance redesign
needed to shorten the successful release critical path.

This initiative does not weaken signing, notarization, N-1 upgrade, native
platform, package-content, installer, or publication checks. Routine local and
PR verification remains unsigned; release-only credentials stay confined to
the versioned release lane.

## Decisions

- Treat the packaged Workspace PTY failure as a harness synchronization defect:
  terminal attachment is not proof that the login shell is ready to accept two
  back-to-back command lines.
- Preserve the structured Workspace acceptance receipt on both success and
  failure. A failed package smoke must print its receipt error and incomplete
  checks before temporary state is removed.
- Bound jobs at the job level as well as individual steps. A lost runner that
  never returns step completion must not consume the full platform default.
- Remove the separate Desktop Package Smoke `master` push matrix. The same
  source tree is already exercised on the promotion PR, while the release
  workflow builds and accepts the signed candidate bytes. Manual dispatch and
  `dev`/`master` pull-request coverage remain available.
- Defer DAG fan-in removal and accepted-tree provenance to a second batch. Both
  need explicit artifact/provenance contracts rather than YAML-only shortcuts.
- Keep beta and stable as separate serial release intents. A changed source tree
  invalidates prior candidate evidence and must be accepted again; unchanged
  beta source may be selected only through a later explicit stable decision.
  Even then, stable has independent version preparation and full release
  acceptance.

## Acceptance Criteria

### Batch 1: deterministic and early feedback

- [x] Packaged Workspace acceptance waits for three distinct acknowledgements:
  PTY attachment, a shell-ready probe, and helper installation. The real CLI
  contract is sent only after all three complete.
- [x] Each PTY phase has a bounded timeout whose error includes the terminal
  tail and identifies the phase that failed.
- [x] Workspace acceptance receipts are parsed after both successful and failed
  packaged runs. Failed receipts surface their error plus incomplete checks;
  successful receipts still require every check and both managed-Pi mock turns.
- [x] `cross-platform-test` has a 30-minute job timeout; release desktop builds
  have a 45-minute job timeout; release Broker Pack builds have a 30-minute job
  timeout.
- [x] Desktop Package Smoke no longer runs on `master` pushes. Manual dispatch
  and relevant pull requests targeting `dev` or `master` still run it.
- [x] Workflow contract tests prove the timeout values, retained triggers, and
  unchanged release publication dependencies.
- [x] Root TypeScript, UI-independent monorepo tests, and an unsigned real
  packaged Workspace smoke pass locally. Native Intel/Windows, signing, and
  notarization remain CI/release evidence and are not claimed locally.

### Batch 2: critical-path and provenance redesign

- [ ] Each platform's N-1 desktop acceptance begins as soon as its matching
  candidate artifact is available; it does not wait for the entire desktop
  build matrix. Per-platform artifact identity and retriable acceptance remain
  explicit.
- [ ] A trusted promotion receipt binds the accepted commit tree to the exact
  required PR checks. A `master` release may reuse it only for the identical
  tree; direct hotfixes or missing/stale receipts run the full master CI gates.
- [ ] Release status presents one coherent view of publication and CI evidence,
  so a green release beside an unrelated red duplicate workflow is no longer
  the normal successful path.
- [ ] Successful-path timing is measured before and after the DAG change, and
  no signing, notarization, upgrade, cross-platform, installer, or publication
  gate is removed to achieve the reduction.

## Work

### Batch 1

- [x] Stage the packaged Workspace shell handshake and preserve phase evidence.
- [x] Parse and report the Workspace acceptance receipt on every exit path.
- [x] Add job-level timeouts and remove the redundant `master` package-smoke
  trigger.
- [x] Extend workflow and receipt contract tests.
- [x] Run required TypeScript, test, and unsigned packaged acceptance.

### Batch 2

- [ ] Choose and document either explicit per-platform build/accept pairs or a
  reusable per-platform workflow; retain downloadable candidate artifacts.
- [ ] Define the signed accepted-tree receipt, trust boundary, invalidation
  rules, and hotfix fallback.
- [ ] Implement the release DAG and master-CI provenance changes with timing
  telemetry and native release rehearsal evidence.

## Verification

- `npx tsc --noEmit`
- `pnpm test`
- `pnpm exec vitest run scripts/ci-workflow.spec.ts scripts/desktop-package-workflow.spec.ts scripts/release-workflow.spec.ts`
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

Batch 1 completed locally with 4,053 passing monorepo tests, root TypeScript,
13 focused workflow/receipt/renderer contract tests, and a real unsigned Apple
Silicon packaged Workspace journey. Its twelve receipt checks passed through
Electron IPC, staged PTY login-shell readiness, all injected CLIs, scheduled
managed Pi, and cleanup. Intel macOS, Windows, signing, and notarization remain
native CI/release evidence.

The 0.91 beta checkpoint supplied concrete Batch 2 evidence. The promotion and
version-only PRs each tested a synthetic merge tree identical to their final
merge tree, yet the resulting `master` pushes still started duplicate CI and
Docker workflows. Those duplicate runs were cancelled only after tree identity
was established. The tagged release then separately ran its candidate, signing,
N-1 upgrade, installer, and publication gates. Two intermittent failures were
test-environment defects rather than product regressions: a hard-coded port
collided with a hosted runner, and Windows cleanup exceeded an implicit
five-second test budget. PR #1272 replaced the port assumption with a reserved
fixture window and gave the bounded Git cleanup path an explicit budget. The
later promotion, version-only, and release gates all passed. This supports a
future accepted-tree receipt that skips only identical post-merge CI; it does
not justify reusing evidence after additional commits, weakening release gates,
or combining beta and stable publication.

## Completion

Batch 1 is complete: criteria, local verification, and serial PR #1061 are
merged to `dev`. The overall plan remains active until the second-batch DAG
and provenance criteria are implemented and measured.
