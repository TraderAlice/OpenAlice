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
- Do not add an accepted-tree receipt or a second release-provenance trust path
  in this iteration. The strict version-only classifier removes the expensive
  preparation duplicate, while the tagged release still rebuilds and accepts
  its own bytes. Revisit provenance reuse only if measured master duplication
  remains material after the simpler lane split.
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
- Keep rolling `dev` publication CLI-only. The four native candidates already
  exercise packaged Guardian/Alice, Web, Workspace, PTY, and Git behavior; do
  not add Electron or Docker to the commit path, and do not repeat the separate
  source-mode post-merge smoke. Sample the heavier multiprocess/Broker Pack
  recovery once on Linux x64 rather than four times. Preserve all four targets
  and activate their checksummed manifest atomically rather than publishing
  partial platform state.
- Run platform-neutral build and unit coverage once on Ubuntu for routine
  integration PRs. macOS and Windows run the focused native CLI, Guardian,
  filesystem, shell, and process contracts plus their real runtime/package
  smokes. The full cross-platform build/test matrix belongs to `master`, stable
  promotion, scheduled validation, and explicit manual rehearsal. Classify a
  hosted-runner failure from captured evidence and a proportional local/native
  rerun; do not make blind whole-matrix retries part of the contract.
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

### Batch 2: beta fast lane and CI lane redesign

- [x] Beta publication requires every current desktop, CLI, Broker Pack, and
  installer candidate plus integrity/channel-isolation checks, but does not
  wait for cross-version or package-manager compatibility suites.
- [x] Stable publication still requires desktop N-1, managed SSH, legacy CLI
  cutover, Broker Pack N-1, public-channel authority, and every supported
  package-manager acceptance gate.
- [x] An exact two-manifest release-preparation PR takes the bounded semantic
  fast lane, while near misses demonstrably fall back to the ordinary full PR
  matrix.
- [ ] Successful beta timing is measured before and after the channel split;
  signing, notarization, current-candidate startup, artifact integrity, and
  stable-alias isolation are never removed from beta.
- [x] Each `dev` commit publishes only the four accepted native CLI candidates
  plus the live installer check; Electron, Docker, generic CI, package-manager,
  legacy, and cross-version lanes are absent.
- [x] Routine integration PRs run the full suite once on Ubuntu and a focused
  native contract suite on macOS/Windows; `master`, stable, scheduled, and
  manual validation retain the complete cross-platform matrix.

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
- [x] Remove the redundant generic CI `dev` push smoke after proving that the
  native CLI candidate smoke covers the real packaged runtime on every target.
- [x] Keep one Linux x64 multiprocess/Broker Pack recovery acceptance per dev
  commit instead of repeating that identical semantic gate on four candidates.
- [x] Replace routine macOS/Windows copies of the complete Vitest suite with
  the focused platform contract command, while retaining full host coverage in
  stable and scheduled lanes.
- [ ] Record the first authorized beta run's actual wall and runner timing; this
  is observational follow-up, not a publication blocker or a reason to add a
  second provenance system.

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
later promotion, version-only, and release gates all passed. The strict
version-only fast lane captures the useful part of that evidence without
making ordinary development depend on a new signed receipt or another release
trust boundary.

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
scope because its modest savings do not currently justify another release
trust path.

Recent successful `dev` pushes confirmed that rolling publication already had
no Electron, Docker, release, or full-test job. Four native CLI candidates,
atomic R2 activation, and the live network installer took a median of about
8.25 minutes wall time and 14.9 runner-minutes; Intel macOS was consistently the
critical native leg. The removed source-mode smoke cost about one runner-minute
in parallel and duplicated packaged runtime evidence. Sampling the heavier
multiprocess/Broker Pack recovery only on Linux x64 saves roughly another
minute of aggregate runner time and tens of seconds on the Intel critical path.
All four final candidate smokes, checksums/content identities, manifest-last
activation, cancellation of superseded builds, and the public dev install stay
intact.

The CI lane redesign passed root TypeScript, the complete local suite (5,359
passing, 13 skipped), 44 focused workflow/desktop contracts, current
`actionlint`, the 67-file platform contract command (774 passing, 6 skipped),
and the real `build:server -> build:bun-runtime:feasibility ->
build:bun:release` sequence on Apple Silicon. A local unpacked Electron journey
also launched the latest published beta profile, launched the current dev
candidate, and immediately restarted that candidate with all eleven persistence
checks passing. Because the dev manifest still declares `0.90.1`, that journey
is evidence for the macOS profile-release/restart repair, not a forward beta.2
upgrade claim.

## Completion

Batch 1 is complete: criteria, local verification, and serial PR #1061 are
merged to `dev`. Batch 2 implementation is complete. The plan remains active
only to record the first authorized beta fast-lane timing; publication itself
still requires a separate maintainer decision.
