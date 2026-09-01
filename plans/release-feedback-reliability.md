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
release gate. The second batch separates a fast beta candidate lane from the
complete stable compatibility lane.

Beta still proves every published desktop, CLI, Broker Pack, installer,
checksum, update-metadata, and channel-isolation artifact, including signed and
notarized macOS bytes and current-candidate runtime startup. Cross-version and
package-manager compatibility belong to stable: N-1 desktop upgrades, managed
SSH deployment, legacy CLI cutover, Broker Pack upgrades, and npm/Bun/Homebrew/
Linuxbrew/AUR acceptance remain full stable release gates. Routine local and PR
verification remains unsigned; release-only credentials stay confined to the
versioned release lane.

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
- Keep the existing desktop build and N-1 matrices. Beta stops after signed or
  packaged candidate construction, current Workspace smoke, update-byte
  verification, and artifact upload. The downstream N-1 matrix runs only for
  stable. Preserve candidate artifacts for at least three days so delayed
  diagnosis does not immediately lose the release bytes.
- Treat a master-targeted release-preparation PR as a narrow semantic fast lane
  only when its complete diff is exactly the matching top-level `version`
  change in `package.json` and `packages/cli/package.json`. It still runs Linux
  build/test plus workflow contracts, and the exact merged `master` SHA still
  runs every release candidate/publication gate. Any extra path, JSON field,
  mismatch, invalid version, or classifier failure keeps the full PR matrix.
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

### Batch 2: beta fast lane and provenance redesign

- [x] Beta publication requires every current desktop, CLI, Broker Pack, and
  installer candidate plus integrity/channel-isolation checks, but does not
  wait for cross-version or package-manager compatibility suites.
- [x] Stable publication still requires desktop N-1, managed SSH, legacy CLI
  cutover, Broker Pack N-1, public-channel authority, and every supported
  package-manager acceptance gate.
- [ ] A trusted promotion receipt binds the accepted commit tree to the exact
  required PR checks. A `master` release may reuse it only for the identical
  tree; direct hotfixes or missing/stale receipts run the full master CI gates.
- [ ] Release status presents one coherent view of publication and CI evidence,
  so a green release beside an unrelated red duplicate workflow is no longer
  the normal successful path.
- [x] An exact two-manifest release-preparation PR takes the bounded semantic
  fast lane, while near misses demonstrably fall back to the ordinary full PR
  matrix.
- [ ] Successful beta timing is measured before and after the channel split;
  signing, notarization, current-candidate startup, artifact integrity, and
  stable-alias isolation are never removed from beta.

## Work

### Batch 1

- [x] Stage the packaged Workspace shell handshake and preserve phase evidence.
- [x] Parse and report the Workspace acceptance receipt on every exit path.
- [x] Add job-level timeouts and remove the redundant `master` package-smoke
  trigger.
- [x] Extend workflow and receipt contract tests.
- [x] Run required TypeScript, test, and unsigned packaged acceptance.

### Batch 2

- [x] Define the minimal beta candidate contract and the complete stable
  compatibility contract.
- [x] Implement and validate the beta/stable release split while retaining
  downloadable desktop candidates for three days.
- [x] Add the exact release-preparation semantic classifier and use it to skip
  only redundant host/package PR jobs, never the final Release gates.
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

The successful `v0.91.0-beta.1` Release run took 35:03 without a failed job or
rerun. Its beta publication spent about 37 runner-minutes on compatibility
checks that remain appropriate for stable but do not validate whether a beta
candidate is installable now: desktop N-1, Broker Pack N-1, npm/Bun packaging,
managed SSH, and legacy cutover. Keeping final candidate construction, signing,
notarization, current-runtime smoke, installer fixture, integrity, and channel
isolation makes the Intel signed desktop build the expected critical path. The
new beta lane is therefore expected to finish in roughly 22-25 minutes, while
stable retains the former full gate set. The same checkpoint's version-only PR
changed only the two product manifest versions but waited about 15 minutes for
Docker, unsigned desktop, and CLI host matrices; its independent Linux
build/test completed in under four minutes. That evidence motivates the strict
semantic release-preparation fast lane above rather than a title-, label-, or
commit-message bypass.

PR #1271's exact two-manifest bump consumed about 72 runner-minutes across 18
Actions checks, with the Windows desktop package lane setting a roughly
15-minute wall-clock path. The semantic fast lane keeps Linux build/test plus
the desktop workflow-contract/typecheck preflight and removes roughly 65 of
those runner-minutes; its expected PR wall time is about four minutes. The
classifier executes from the trusted base commit and accepts only a byte-exact,
synchronized, forward beta version change. Stable bumps, near misses, and
classifier failures run the complete suite. `master` push reuse remains out of
scope until the accepted-tree receipt can prove the associated PR, tree, and
successful checks without adding an ad hoc trust tower.

## Completion

Batch 1 is complete: criteria, local verification, and serial PR #1061 are
merged to `dev`. The overall plan remains active until the second-batch DAG
and provenance criteria are implemented and measured.
