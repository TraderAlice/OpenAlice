# Release pipeline efficiency

Status: active, planning accepted for implementation on 2026-09-05.
Branch: `codex/release-pipeline-efficiency`; one topic Draft PR targeting dev.
Delivery: ordered increments on one owned branch; leave the topic unmerged for
maintainer acceptance. Do not promote master or publish a product for a rehearsal.

## Outcome and boundaries

Reduce stable release wall time and failure-induced repeated work without
weakening source, native runtime, upgrade, signing, integrity, or channel gates.
The unit of reuse is an identified artifact, not a green workflow badge.
Use existing GitHub Actions, artifact storage, and repository scripts; do not
build a release service, provider-specific deployer, or generic workflow engine.

Owner contracts: [[../docs/development-workflow.md]],
[[../docs/cli-package-managers.md]], [[../docs/cli-installer.md]],
[[../docs/managed-workspace-runtime.md]], [[../docs/testing.md]].
The earlier distribution work remains in [[bun-cli-distribution.md]]; this plan
alone owns release orchestration optimization, not product packaging redesign.

## Measured baseline

Live evidence gathered on 2026-09-05, before changing workflows:

| Run | Wall time | Observation |
| --- | --- | --- |
| [Beta 33950551159](https://github.com/TraderAlice/OpenAlice/actions/runs/33950551159) | 26m14s | Intel desktop is the critical path |
| [Stable source 33954704340](https://github.com/TraderAlice/OpenAlice/actions/runs/33954704340) | 12m09s | Source validation precedes candidate construction |
| [Stable 33955286757](https://github.com/TraderAlice/OpenAlice/actions/runs/33955286757) | 43m59s | About 154 aggregate job-minutes |

Stable Windows desktop finished at 08:37:54 UTC. Its upgrade job was created
only at 08:49:36 and started at 08:49:42: matrix dependency, not runner queue,
accounts for almost twelve minutes of idle time. Intel upgrade finished at
08:55:31; Windows upgrade finished at 09:05:04. Holding all job durations fixed,
per-platform pipelines would save about 9m33s of this run's critical path.
Combined source/build concurrency suggests roughly 34-35 minutes rather than
57 minutes for a clean journey; this is a model, not a measured guarantee.

Windows N-1 acceptance spent about 5m37s installing the previous version and
6m48s installing the candidate. New-version launch/restart took about seven
seconds. Intel packaging spent about 10m38s between signing start and
notarization success; available logs do not separate those costs.
Neither Defender nor Apple service latency is established as a root cause.

Failure amplification: stable run 33953350725 hit an AUR fixture defect and
an Intel signing timestamp failure; fixture repair required a new source/run.
By contrast npm repairs #1374/#1375 reused public 0.91.1 bytes and completed
publication in run 33958504645. Extend that bounded reuse principle to candidates.

## Chosen design

1. Each platform builds and preserves its candidate, then its own downstream
   acceptance starts immediately. Final publication still joins all required
   platform results. Keep build and acceptance separate for selective retries.
2. Identify candidates by product source SHA, version/channel, platform, exact
   filenames and cryptographic hashes. Acceptance records bind these bytes plus
   verifier revision and relevant previous-release identity. Verify records at
   the publication boundary, not just during upload.
3. A repaired verifier may inspect an existing candidate without rebuilding it.
   It must not relabel old bytes as a new product commit or silently waive a
   failure. Product changes require new candidates. Explicit trusted verifier
   selection and mismatched/missing/expired artifact rejection are mandatory.
4. Full source validation and candidate construction can run concurrently for
   one explicit stable intent, but publication waits for both on the same
   product SHA. No version/tag/channel mutation happens during rehearsal.
5. Reuse the existing commit-bound platform-neutral CLI input mechanism where
   appropriate; native dependencies and target acceptance remain native-owned.

Rejected: merging build+upgrade into one retriable job; removing Windows/stable
gates; arbitrary cross-run artifact selection without identity checks; automatic
beta-to-stable promotion; installing a permanent runner on the user's daily Mac.

## Ordered work and acceptance

- [x] Gather live job/step timing, distinguish dependency wait from runner queue,
  record the baseline and inspect existing artifact/retry mechanisms.
- [ ] Increment 1: introduce reusable per-platform desktop build/acceptance
  pipelines; remove Windows dependency from POSIX-only package acceptance where
  artifact generation permits. Preserve required final aggregation and beta rules.
  Verify dependency contracts and exercise fast/slow platform ordering without
  signing or publishing; failed acceptance must not rerun successful builds.
  In progress: extracted release-desktop-platform.yml with separate build and
  stable-only upgrade jobs. The caller matrix now joins complete platform
  pipelines rather than placing a matrix-wide barrier before upgrade. Existing
  signing, startup, update-metadata checks and artifact names are preserved.
  POSIX system-package fixtures now use a strict four-target system-only mode;
  byte-equivalence tests preserve Homebrew/AUR output while omitting unnecessary
  npm materialization. Public channel generation still requires all six targets.
  All 26 release/generator tests and root typecheck pass. actionlint 1.7.7
  passes with only its stale macos-15-intel label diagnostic excluded; no shell
  checker is installed. Actions semantics rehearsal and full
  local regression completed: 719 files, 6,430 passes and three expected skips
  in 220 seconds (/tmp/openalice-release-pipeline-step1-tests.log). Final
  generator changes have additional focused coverage. Hosted Actions semantics
  rehearsal remains outstanding; no measured speedup is claimed yet.
- [ ] Increment 2: implement candidate identity, artifact-bound acceptance, and
  bounded replay of existing candidates using repaired trusted verification.
  Test wrong hash/source/channel/platform, missing receipt, failed checks,
  artifact expiry and tampering. Prove identical candidate hashes before/after
  a verifier-only retry; prove a product change cannot reuse old acceptance.
  In progress: release-candidate-identity.mjs fingerprints exact regular-file
  contents with source/version/channel/target identity, requires an explicitly
  selected candidate hash at verification, and binds acceptance to a verifier
  commit plus required named checks. Fifteen initial rejection/identity tests
  pass. This module is not yet wired into workflow production/publication and
  does not by itself prove trusted cross-run selection or replay support.
- [ ] Increment 3: join exact-SHA full source validation at publication instead
  of serializing before candidate builds; reuse verified neutral CLI inputs.
  Test source failure/mismatch blocks publication, beta gates stay separate,
  and neutral inputs cannot cross commits or include host-native outputs.
- [ ] Complete a non-publishing workflow rehearsal of the new dependency and
  replay paths. Prefer local Mac/OrbStack for tests; use hosted jobs only for
  Actions semantics/native-host evidence unavailable locally. A routine rehearsal
  uses unsigned candidates and no signing credentials. Report signing risk as
  residual unless a specifically authorized signing rehearsal is needed.
- [ ] Update owner guides and applicable release skill instructions to match
  the implemented operation and acceptance boundaries; remove stale serial rules.
- [ ] Record measured timings separately from estimates, inspect latest PR
  checks, and present the single topic PR for acceptance. Once accepted, move
  durable operational truth to owner guides and remove this plan/index entry.

For workflow/shared infrastructure changes, run root typecheck, complete hermetic
suite and focused workflow/receipt tests at meaningful integration checkpoints.
Do not rerun the entire suite for every prose or test iteration. Run applicable
native/unsigned package checks when execution paths change; keep user state,
broker accounts and runtime credentials outside every test.

## Non-goals and follow-up boundaries

No ASAR conversion, Windows installer redesign, UTA version split, release
version bump, channel activation, or dropping an artifact target. Installer
phase instrumentation may establish a later performance investigation but must
not silently expand this orchestration topic. AUR registration stays deferred.
Any concrete unrelated defect belongs in a GitHub issue, not another local TODO.

Completion requires working retry/dependency paths and an evidence-backed timing
comparison, not merely green YAML tests. No unperformed native or signing
acceptance may be described as passed.
