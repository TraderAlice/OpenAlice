# Testing

This guide owns test taxonomy, command namespaces, selection, receipts, and
side-effect authority. Use [[docs/development-workflow.md]] to choose the
cumulative delivery gate, then follow the owning guide for browser, Electron,
Docker, remote, installer, or broker acceptance.

The catalog and selector live in `scripts/test-lanes.mjs` and
`scripts/run-tests.mjs`. Public commands describe ownership and risk; Vitest
projects remain internal execution environments.

## Scope and registration

| Scope | Location | Registration |
|---|---|---|
| Unit/component | Colocated same-name spec | Not required |
| Integration | `tests/integration/<topic>/` | Required per suite |
| E2E | `tests/e2e/<topic>/` or native/artifact runner | Required per suite/runner |

Unit tests verify a module's responsibility. Integration tests exercise
collaborating production modules. E2E exercises a user journey through the real
application entry and relevant runtime. A mocked browser, child fixture, or
in-process HTTP call is not automatically E2E.

`hermetic`, external-readonly, and live-paper describe execution conditions, not
scope. Register higher-tier suites in `tests/suites.json` with purpose, tier,
owner, lane, files/commands, and honest limitations. State which collaborators
are real and which are fixtures. The catalog rejects dangling entries, duplicate
ownership, registered unit suites, and unregistered higher-tier files.

`pnpm exec tsc -p tests/tsconfig.json --noEmit` checks central specs. Root,
selector, and UI runners use the aligned Vite+/Vitest dependency set; mixed
runner copies can split mock and assertion state.

After fresh install, real CLI child fixtures need the compiled update-lifecycle
entry and its dependencies:

```bash
pnpm --filter @traderalice/update-lifecycle... build
pnpm test
```

Vitest source aliases do not propagate into package-export child processes.
This prerequisite grants no external or broker authority.

## Command model

| Namespace | Meaning |
|---|---|
| `pnpm test` | Complete default hermetic catalog across Node and UI |
| `pnpm test:critical` | Entire immutable `critical-local` assertion gate with receipt |
| `pnpm test:changed` | Hermetic static changed-file closure against `origin/dev` |
| `pnpm test:owner:*` | Complete hermetic inventory for one product owner |
| `pnpm test:integration:*` | Deterministic isolated local product integration |
| `pnpm test:contract:*` | Named cross-folder hermetic contracts |
| `pnpm test:system:*` | Dedicated process/host/Docker/installer/artifact acceptance |
| `pnpm test:external:*` | Explicit read-only public/provider/TWS access |
| `pnpm test:live:*` | Explicit demo/paper account acceptance with writes |
| `pnpm test:select` | Composable catalog query and advanced Vitest entry |
| `pnpm test:suites` / `test:inventory` | Data-only suite/spec/runner inspection |
| `pnpm test:unit` / `test:e2e` | Colocated units or hermetic E2E only |

Owners are `alice`, `ui`, `uta`, `connector`, `runtime-cli`, `desktop`, and
`repo-tooling`. Inspect `test:suites` and `test:inventory` rather than guessing.

`test:integration` includes hermetic integration plus the serialized local
process lane. `test:e2e` excludes external, live, native, and artifact runners.
A suite with no executable specs in the selected lane fails closed.

Dedicated system commands own their prerequisites and effects. The generic
selector does not execute system inventory. Artifact builders, Electron smoke,
Broker Pack acceptance, and package-manager artifact checks retain their owner
commands rather than receiving decorative root test aliases.

## Required evidence and receipts

`pnpm test:critical --receipt artifacts/tests/critical-local.json` runs the
`critical-local` gate in `tests/gates.json`. It executes all declared hermetic
and deterministic integration evidence and rejects owner/lane/suite/tier/path/
changed filters and forwarded Vitest arguments. Every required assertion must
appear exactly once and pass; missing, ambiguous, skipped, or failed assertions
fail acceptance. Other green assertions in the same file do not substitute.

Every actual `test:select` execution writes a JSON receipt, at `--receipt` or a
reported temporary path. Data-only list/explain/JSON/suite/inventory modes write
none. Receipts record source commit/index tree, dirty state, host/Node,
selectors, assertion counts, required evidence, and unexecuted invocations.
The index tree identifies staged content, not unstaged edits; dirty receipts
are not clean-commit acceptance. `artifact: null` means source tests.

All-skipped/empty execution, nonzero exit, spawn error, missing report, hook/
file failure, and incomplete required evidence fail closed. Runner-owned
one-shot/report/output options cannot be overridden. Receipts retain assertion
identities/statuses, not raw stdout or failure messages. Passing cleanup hooks
prove only their own assertions, not blanket native or venue cleanup.

Critical local evidence does not certify browser onboarding, real Agent login,
native Dock/tray behavior, signed packages, or venue accounts. CI, platform,
and final artifact gates remain separate.

## Composable selection

```bash
pnpm test:select --owner ui --changed origin/dev
pnpm test:select --owner uta --package @traderalice/uta-service
pnpm test:select --lane integration --area workspace
pnpm test:select --suite conversation-recovery --lane integration
pnpm test:select --tier integration --owner uta --lane external-readonly --explain
```

Dimensions are `--lane`, `--owner`, `--area`, `--package`, repo-relative
`--path`, `--suite`, and `--tier`. Values within one dimension OR; different
dimensions AND. `--changed [base]` intersects the static import graph. Default
lane is hermetic; zero files fail closed.

`--list`, `--explain`, and `--json` enumerate selection, effects, prerequisites,
and planned invocations without loading tests or proving prerequisites exist.
Arguments after `--` forward to Vitest except runner-owned options. Focused name
filters are development feedback, not acceptance for excluded assertions;
required gates reject forwarding.

Static imports do not establish dynamic-import, generated-contract, registry,
child-process, or lifecycle impact. Select those suites explicitly. Use
`pnpm test:select --help` for the live catalog.

## Side effects and acceptance

| Lane | Allowed effects | Acceptance |
|---|---|---|
| Hermetic | Temporary local files and test-owned subprocesses | Every selected spec passes in isolated state |
| Integration | Temporary local files and test-owned local processes | Complete deterministic product journeys pass |
| System | Only effects documented by the dedicated command | Prerequisites present; complete journey passes and cleans up |
| External read-only | Network reads and documented local config; never order writes | At least one intended external scenario actually runs and passes |
| Live paper | Network and writes to verified demo/paper accounts | Scenario passes and positions/orders return to baseline even after failure |

An external/live run that skips everything is not run or accepted. Missing
Docker, network, credentials, TWS, published candidates, or other prerequisites
is a reported gap; unrelated green lanes do not replace it.

Every live command requires `OPENALICE_UTA_LIVE_PAPER=1`. First verify the exact
account is demo/paper and record positions/open orders. Use the provider-specific
command where possible. The Bybit diagnostic performs a raw buy with only
best-effort close and is not routine acceptance or part of the UTA sweep.
[[docs/uta-live-testing.md]] owns account safety and cleanup.

Docker fixtures under `scripts/` are disposable test hosts, not supported
OpenAlice deployment images or a container supervisor.

## Package-local tests and test design

A package's `test` script runs only its hermetic specs, never siblings or the
complete owner suite. Use `test:select --package` for combined selectors.
Package external/live scripts use root lane acknowledgements; credentials or a
reachable broker must never change ordinary `test` side effects.

Before adding an assertion, name the consumer-visible failure or invariant it
detects. Extend the existing behavior owner where practical while preserving
distinct failure, retry, authorization, and persistence cases. Test observable
behavior, not implementation copies, CSS declarations, utility classes,
decorative text, or versioned asset filenames. Layout, hit targets, cascade,
and reduced motion need rendered browser evidence.

Keep default execution isolated; never hide public requests, configured-home
reads, Docker, or broker writes behind hermetic skips. Moving tests preserves
owner/lane/package/area routing. Inventory must not import side-effectful
fixtures. New root aliases require durable repeated boundaries; one-off
intersections use `test:select`. Changes to collection or package contracts run
`pnpm test:contract:workflow`.

Do not create a Vitest project merely for a product label. Do not delete a test
only for being slow, flaky, large, owner-only, or failing; record lost behavior
and remaining real-surface gaps when pruning. Test counts and coverage are
inventory signals, not product acceptance.
