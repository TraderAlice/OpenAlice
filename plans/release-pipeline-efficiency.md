# Release pipeline efficiency

Status: implementation and non-publishing acceptance complete on 2026-09-05;
Draft PR awaits maintainer acceptance.
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

- [x] Record baseline timings and distinguish queue time from dependency waiting.
- [x] Independent desktop pipelines plus POSIX-only system-package fixtures.
  Three-platform native rehearsal 33961658342 passed. ARM upgrade started
  seven seconds after its build, while Intel/Windows were still building.
  Intel upgrade started three seconds after its build. Final aggregation,
  signing paths and beta/stable distinctions remain in the workflow contracts.
- [x] Candidate identity, trusted selection and independent recovery acceptance.
  Implemented exact-byte manifests, source/version/channel/platform pinning,
  required N-1 receipts, expiry/run/repository checks and fail-before-staging
  verification. Wrong source was rejected in hosted run 33960665604.
  Verifier-only native replay passed in 33962998628 (details below).
  Same-source three-platform reuse 33962287156 passed. All three restored
  receipts exactly match their originals, including candidate IDs, verifier,
  previous tag and all 11 successful checks, verified from downloaded JSON.
- [x] Concurrent same-product-SHA full source validation and verified shared CLI
  inputs. Release calls local ci.yml at the dispatch SHA; no candidate builder
  depends on its completion, but stable publication requires success. Reusable
  source workflow retains complete source/native checks. Workflow tests inspect
  these dependencies and checkouts. Shared-input rejection tests and real
  native CLI benchmark 33960910945 passed; measured tradeoff is above.
- [x] Finish non-publishing rehearsal and final evidence audit. Full desktop
  build/acceptance and independent cross-verifier replay passed; three-platform
  restored-candidate acceptance passed. No signed full release was run.
- [x] Update owner guide and local release skills. Development workflow documents
  recovery, verifier authority and unsigned rehearsal isolation. Local
  openalice-desktop-release-smoke and openalice-large-change-flow skills were
  adjusted and validated with quick_validate.py; they are not repository files.
- [x] Refresh final PR evidence/checks and present Draft PR #1377 for acceptance.
  Leave it unmerged. Once accepted, remove this plan and its PLANS.md entry;
  the owner guide and Git history retain the durable contract and evidence.

## Native rehearsal measurements

First build/upgrade run [33961658342](https://github.com/TraderAlice/OpenAlice/actions/runs/33961658342)
used product commit 997dd0c249713544568bd821be16e4cb78a2cb05 and completed
successfully at 11:18:27 UTC: 29m28s from dispatch. It was desktop-only and
unsigned, so it is not an end-to-end signed-release benchmark.

| Platform | Build | Upgrade acceptance | Build-to-upgrade gap |
| --- | --- | --- | --- |
| macOS ARM64 | 5m32s | 3m17s | 7s |
| macOS Intel | 8m36s | 4m06s | 3s |
| Windows x64 | 11m02s | 18m18s | 3s |

Windows candidate launch/write/restart took approximately six seconds after
installer exit; installer execution still dominates that native path. Do not
attribute it to Defender or runner scarcity without further evidence.

Same-source retry [33962287156](https://github.com/TraderAlice/OpenAlice/actions/runs/33962287156)
is frozen at the same product SHA. It waited behind the original rehearsal
because it was submitted early; report that deliberate waiting separately.
All build jobs skipped, authenticated restore jobs passed: ARM 58s, Intel
1m46s, Windows 32s. Fresh upgrade acceptance followed each restore and passed.
ARM upgrade took 1m47s; Intel 5m09s; Windows 15m14s. Full JSON equality was
checked for all three receipts against the original run, not inferred from
job success. Windows candidate ID is
5b3b6d1ce9c17f45cb6c74b28400ad5be822e836ad7db4c14d51801dfa9ac92c;
Intel is bfdd1076a6b38834549c221c8f8575c1b4913bd3f00cf09236a1a7065288e9bb.

First native job to last completion: original 29m23s, reuse 15m49s, observed
reduction 13m34s (46.2%). This includes runtime variance: Windows acceptance
itself was 3m04s faster, so not every saved second is attributable to reuse.
Aggregate build work was 25m10s versus 3m16s for restore (21m54s removed).
The retry was submitted at 11:03:20, first started at 11:18:30, and completed
at 11:34:19 UTC. Its separate 15m10s pre-start wait was deliberately caused
by queuing it before the producing run completed; total dispatch time was
30m59s. Do not present that as a faster dispatch-to-completion run.

Cross-verifier replay [33962998628](https://github.com/TraderAlice/OpenAlice/actions/runs/33962998628)
passed in 2m56s dispatch-to-completion (native job 2m48s), with verifier
1a626328fefefb5d8df26d3e04425d65c5719535 and the original ARM product bytes.
Downloaded original/replay receipts and asserted identical candidate ID
1576e4579c1db7cb16a12716e0d67b7aad142803787a4e89e9e329a980b6a86a,
the two expected verifier SHAs, identical previous tag and all 11 successful
N-1 checks. Evidence is in /tmp/openalice-release-receipts.xBW8cp under
original/ and new-verifier/. No product build or publication job ran.

Rehearsal artifacts use a distinct prefix; ordinary production selection
rejects them. Diagnostic replay receipts are not imported as publication
authority. Normal recovery restores authenticated product bytes into the
current run, performs fresh acceptance with an explicitly trusted verifier,
and verifies that bound receipt before staging. Product source remains fixed.

## Local verification and known failures

- Latest complete suite: `pnpm test --maxWorkers=1`, 723 files, 6,482 passes,
  three skips, 406.82s. Log: /tmp/openalice-release-pipeline-final-tests.log.
  Concurrency changed, not assertions. Root typecheck passed.
- Final receipt/workflow regression: 43 passes, including rejection of changed
  product SHA, version or channel before any staging directory is created.
  Earlier combined identity/selector/verifier/workflow checkpoint: 71 passes.
- Real temporary-git fixtures reject short, missing and unintegrated verifier
  revisions. CLI binding tests preserve product bytes while changing verifier.
  Final neutral-input/verifier fixtures passed 11 tests, including wrong commit,
  modified bytes, extra files and manifest-envelope tampering rejection.
- A prior full suite had 6,478 passes, three skips and one unchanged Connector
  UI five-second timeout (722 files, 308.13s). Its complete 32-test file passed
  independently in 12.03s, and the later complete suite passed. Resource
  sensitivity is suspected, not a proven root cause; do not erase this record.
- actionlint 1.7.7 passes with its obsolete macos-15-intel label diagnostic
  excluded; shellcheck and pyflakes were unavailable.
- Hosted rehearsal 33961558999 exposed a missing actions:read grant at the
  reusable-workflow caller despite local YAML lint passing. Fixed in 997dd0c2
  with a regression assertion; subsequent native rehearsal passed.

For shared workflow infrastructure, use complete local regression at meaningful
integration checkpoints, focused contracts for subsequent small edits, and real
native evidence for changed execution paths. Never substitute unsigned rehearsal
for signing/notarization, nor a diagnostic receipt for public-byte acceptance.

## Non-goals and follow-up boundaries

Final audit: the owned branch is clean after delivery, targets unchanged dev
5e209e9e, and remains an unmerged Draft PR. Product package versions are
unchanged. Required source/publication gates, signing steps and channel checks
remain in current workflow source and focused contracts. Current tests and
native rehearsal establish this change's acceptance; a complete signed release,
Apple notarization latency and public channel activation were not exercised.
The modeled 34-35m clean stable release remains an estimate until a separately
authorized release. No product tag or public release was created by this work.

No ASAR conversion, Windows installer redesign, UTA version split, release
version bump, channel activation, or dropping an artifact target. Installer
phase instrumentation may establish a later performance investigation but must
not silently expand this orchestration topic. AUR registration stays deferred.
Any concrete unrelated defect belongs in a GitHub issue, not another local TODO.

Completion requires working retry/dependency paths and an evidence-backed timing
comparison, not merely green YAML tests. No unperformed native or signing
acceptance may be described as passed.
