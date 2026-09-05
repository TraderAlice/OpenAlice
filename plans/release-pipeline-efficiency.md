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

### Incremental measurement (2026-09-05)

Maintainer requested measured feedback after each optimization, rather than
only a final theoretical timing estimate. On 8948bacd, local macOS ARM64
production server compilation with Turbo `--force` (dependencies already
installed) took 36.34 seconds wall time. Preparing the actual 988-file neutral
artifact took 215.71 ms. Installing and hash-verifying it into six distinct
empty temporary consumers took 193.78, 165.30, 166.31, 158.06, 168.92 and
170.71 ms. Temporary consumers were removed; the checkout stayed clean.
Build log: /tmp/openalice-neutral-benchmark-build.log. This comparison excludes
dependency installation, GitHub upload/download and runner queue latency; it
demonstrates removed local repeated work, not total release wall-time savings.

Negative hosted replay [33960665604](https://github.com/TraderAlice/OpenAlice/actions/runs/33960665604)
used an intentionally wrong product SHA. The native job ran 12 seconds and
failed at trusted selection as expected; artifact download, dependencies,
upgrade acceptance and all release/publication jobs were skipped. This proves
early rejection and operation isolation, not positive replay or speedup.

Hosted real CLI comparison [33960910945](https://github.com/TraderAlice/OpenAlice/actions/runs/33960910945)
completed successfully on 438e695b via `operation=benchmark-cli`. The input producer builds
once and uploads the verified inventory; two identical Ubuntu consumers then
compare rebuild versus download/restore, each running multiprocess feasibility
and real native archive acceptance. Producer cost is recorded separately, since
both consumers deliberately start after it. No public artifacts or signing
credentials are involved.

Measured hosted results: producer job 115 seconds (server build 84 seconds,
upload 2 seconds); original consumer 157 seconds (repeated server build 88
seconds); shared consumer 65 seconds (download/verify approximately 2 seconds).
Both consumers passed multiprocess Runtime and actual native archive acceptance.
Per-consumer execution fell by 92 seconds, but producer start through restored
consumer completion took 183 seconds: about 26 seconds longer than the original
single consumer's execution. This is a repeated-compute reduction, not evidence
of a faster first CLI artifact. Six-target aggregate savings require a model
and cannot be presented as measured multi-platform time. Retain provisionally
for shared work reduction; desktop/source dependency changes, not this input
split alone, own the expected stable critical-path improvement.

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
  checker is installed. Full local regression completed: 719 files,
  6,430 passes and three expected skips
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
  pass. Desktop build now records identity, upgrade checks the restored bytes
  against its build output and binds the N-1 checks, and publication verifies
  all three platform directories plus stable receipts before staging any file.
  The raw previous-release identity and every named N-1 check are required;
  beta retains byte verification without stable N-1. Initial integrated tests
  pass (45 tests including primitive/workflow contracts); trusted cross-run
  selection, candidate replay and real workflow rehearsal remain unfinished.
  Added a GitHub-backed candidate selector which requires an exact completed
  master Release run, product SHA and unique unexpired artifact from this
  repository (including its head repository). Fourteen rejection/selection
  tests pass. A read-only live selection against run 33955286757 resolved
  macOS ARM64 artifact 9966357063 for source 52b51f29809178594b7b57bf666133829368b7b4.
  This proves metadata selection only: historical assets predate the new
  candidate identity manifest and cannot be represented as newly accepted
  candidates. The selector is now wired into `operation=verify-desktop`:
  an explicitly selected platform downloads only the authenticated artifact ID,
  verifies its manifest and bytes before dependency installation, runs final
  artifact N-1 acceptance, and binds the resulting receipt to the product bytes
  and current verifier SHA. The operation has read-only repository permissions,
  no signing secrets, and a separate concurrency group. Forty-nine focused
  tests pass. Final publication consumption of replay receipts and actual
  positive native replay remain outstanding.
  Same-source release recovery is now wired: `operation=release` plus an
  existing `candidate-run` skips desktop builds, authenticates and verifies the
  three preserved candidates, then performs normal stable upgrade acceptance
  and final staging. Product SHA must equal the current dispatch SHA. This
  consumes reused bytes through the real publication gate, but does not yet
  consume a separate verifier-only replay receipt or prove positive hosted
  desktop recovery. Thirty-seven focused workflow/receipt tests pass.
  Verifier-only recovery follow-up:
  `desktop-verifier-sha` is restricted to full commits integrated into dev/master;
  only upgrade acceptance changes checkout. Product builds/source gates/tag SHA
  remain unchanged; selected verifier identity is required again at final
  staging. Real temporary-git trust tests and CLI receipt binding pass (41
  focused tests initially; final identity/workflow selection checkpoint passes
  71 tests and root typecheck). Native cross-verifier acceptance is still unproved.
- [ ] Increment 3: join exact-SHA full source validation at publication instead
  of serializing before candidate builds; reuse verified neutral CLI inputs.
  Test source failure/mismatch blocks publication, beta gates stay separate,
  and neutral inputs cannot cross commits or include host-native outputs.
  In progress: the release now prepares the existing approved neutral input
  inventory once, shares it with all six native CLI targets, and verifies its
  exact commit and file hashes before installation. Windows uses a named input
  artifact while dev retains its existing default. Native build, feasibility,
  and channel-appropriate acceptance remain per-target. Source-validation
  concurrency is now wired through the existing Full Source Validation reusable
  workflow on the same dispatch SHA. Stable publication requires its success;
  candidate jobs have no source-validation dependency, and beta does not call
  the full workflow. Workflow contracts pass; real artifact and hosted
  dependency rehearsal remain outstanding.
  Local checkpoint: root typecheck passed; complete hermetic suite passed
  (721 files, 6,458 passes, three skips, 201.31 seconds;
  /tmp/openalice-release-pipeline-neutral-tests.log). Final source-concurrency
  contracts were additionally checked after editing (35 passes), along with
  actionlint under the previously documented tool limitations. These timings
  measure local validation, not the optimized release critical path.
- [ ] Complete a non-publishing workflow rehearsal of the new dependency and
  replay paths. Prefer local Mac/OrbStack for tests; use hosted jobs only for
  Actions semantics/native-host evidence unavailable locally. A routine rehearsal
  uses unsigned candidates and no signing credentials. Report signing risk as
  residual unless a specifically authorized signing rehearsal is needed.
  `operation=rehearse-desktop` now calls the production platform pipelines for
  all three hosts, with explicit unsigned Mac packaging and no passed signing
  secrets. Rehearsal artifacts have a separate name prefix and may only be
  restored through the explicitly selected rehearsal branch; ordinary release
  selection rejects them. The next two runs will build/accept real candidates
  and then restore/accept those same bytes on the unchanged commit, measuring
  dependency ordering and build work avoided. Forty-three focused workflow and
  selection tests pass; positive hosted results are not yet available.
  Run 33961558999 was rejected during workflow parsing because the production
  caller did not pass actions:read to the reusable candidate reader. Fixed with
  an explicit minimal caller grant and regression assertion. Run 33961658342 on
  997dd0c2 is active: ARM build succeeded at 10:54:40 UTC and its upgrade started
  at 10:54:47 while Intel/Windows builds continued, proving removal of that
  cross-platform barrier. Full positive/reuse results remain pending.
  Local full checkpoint: 6,478 passes, three skips, one existing Connector UI
  test timed out at five seconds (722 files, 308.13 seconds). The unchanged
  Connectors.demo.spec.tsx file passed all 32 tests in isolation in 12.03 seconds.
  Record the timeout rather than claiming a green full run; resource sensitivity
  is suspected, not established as the sole cause.
  Both local release-related skills were updated using skill-creator and pass
  quick_validate.py: remove nonexistent master-push waiting, defer to current
  same-SHA parallel source gates, and distinguish measured job savings from
  release latency and diagnostic replay from publication authority.
  Same-byte restore rehearsal 33962287156 has been dispatched and is pending
  behind the first run. Both are confirmed pinned to 997dd0c2, so later topic
  commits do not change this comparison. Both Mac builds/upgrades are accepted;
  first-run Windows upgrade remains active.
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
