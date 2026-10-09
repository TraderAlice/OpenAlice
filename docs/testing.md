# Testing

This guide owns the developer-facing test taxonomy, command namespace, and
side-effect contract. It does not replace the surface-specific acceptance
guides: use this guide to select the right lane, then follow the owning guide
for browser, Electron, Docker, remote-host, installer, or broker evidence.

The catalog and selector live in `scripts/test-lanes.mjs` and
`scripts/run-tests.mjs`. Vitest projects remain execution environments; the
public commands describe product ownership and risk instead of exposing that
internal topology.

The root and selector commands run through Vite+ (`vp test`), while test sources
import Vitest APIs from `vitest`. The root, UI, and package-local runners
declare Vitest directly for TypeScript resolution, all pinned to the version
bundled by `vite-plus@1.0.0` (5.0.1). Their Vite aliases and the workspace
`vite@*` override resolve to the same Vite+ core package. Keep those pins
aligned when upgrading Vite+; mixed runner copies can split mock and expect
state.

After a fresh install, the full suite's native CLI subprocess fixtures need
the compiled `@traderalice/update-lifecycle` entry point:

```bash
pnpm --filter @traderalice/update-lifecycle... build
pnpm test
```

Vitest aliases workspace packages to source in its own process. Real CLI
children use package exports and do not inherit those aliases. Build the
package's dependencies too: its Node entry imports Guardian runtime. This local
build prerequisite does not grant any external or broker acceptance authority.

## Test scope and registration

The maintainer's convention separates scope from execution conditions:

| Scope | Location | Registration |
|---|---|---|
| Unit/component | Same-name spec beside its implementation | Not required |
| Integration | `tests/integration/<topic>/` | Required per suite |
| E2E | `tests/e2e/<topic>/`, or an existing native/artifact runner | Required per suite/runner |

Unit tests verify a module's own responsibility. Integration tests exercise
collaborating production modules; E2E exercises a user workflow through the
actual application entry and relevant runtime. A mocked browser, local child
fixture or in-process HTTP request does not itself establish E2E coverage.
`hermetic`, external-readonly and live-paper describe execution conditions and
side effects, not these scope levels.

Register higher-tier suites in `tests/suites.json`, with purpose, tier, owner,
execution lane, files or dedicated commands, and honest scope limits. A module
with several focused unit files may use `<module>.<topic>.spec.ts` beside its
implementation. Higher-tier files containing some unit cases remain registered
as a whole; state which collaborators are real and which are fixtures.

## Suite discovery and selection

```bash
pnpm test:suites
pnpm test:suites --tier e2e --explain
pnpm test:inventory --json
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:select --suite conversation-recovery --lane integration
pnpm test:select --tier integration --owner uta --lane external-readonly --explain
```

Selector composition is defined in [Composable Selection](#composable-selection).
`test:integration` covers hermetic module integration plus the existing serialized
local-process profile (still called the `integration` lane). `test:e2e` runs
hermetic E2E only. External reads, live-paper writes and native/artifact runners
remain explicit opt-ins, independent of test tier. A suite with no executable
specs in the selected lane fails closed; use `test:suites` to inspect separate
command entries and their prerequisites instead of running them implicitly.

`suites.json` registers files/commands, not individual `it()` titles. The catalog
rejects dangling entries, duplicate file/runner ownership, registered unit suites
and unregistered higher-tier files. Inventory reports tier and suite separately;
a unit's null suite is normal. Scope review must still inspect real collaborators:
renaming a file is not evidence of its integration or E2E fidelity.

Central suites keep their owner's Node/jsdom Vitest project. Their direct
harness imports are root development dependencies at the same installed
versions used by the owning packages; production dependency ownership does
not change. `pnpm exec tsc -p tests/tsconfig.json --noEmit` checks moved specs,
including JSX. Both source-contract and dev clean-build CI run this check so
relocation does not silently remove test code from TypeScript verification.

## Required local evidence and run receipts

`pnpm test:critical --receipt artifacts/tests/critical-local.json` runs the
`critical-local` gate declared in `tests/gates.json`. It pins the existing 15 required assertions directly, independently of ordinary
suite registration. Its five
bounded requirements cover broker-free Chat/restart, real local child failure
and shutdown recovery, loopback approval HTTP, run-result integrity and
complete packaged-Workspace receipt validation. These are source/local checks;
they do not certify browser onboarding, a real agent login, native Dock/tray
interaction, or a venue account.

The gate runs its entire declared hermetic and integration evidence. It rejects
owner/lane/suite/tier/path/changed filters and forwarded Vitest arguments. Each
required assertion must appear exactly once and actually pass: missing,
ambiguous, skipped and failed assertions all fail acceptance. Merely passing
some other assertions in the same file is insufficient.

Every actual `test:select` execution writes a JSON receipt. Use `--receipt` to
choose a durable output location; otherwise the runner prints its temporary
receipt path. JSON/list/explain/suite/inventory modes remain data-only and do
not write a run receipt. Receipts record source commit and index tree, dirty
state, host/Node identity, selectors, per-invocation executed/passed/failed/
skipped assertion counts, required evidence and unexecuted invocations. The
index tree identifies staged content, not unstaged edits; dirty receipts must
not be mistaken for clean-commit acceptance. `artifact: null` explicitly means
source tests, not packaged bytes.

All-skipped/empty execution, nonzero exits, spawn errors, missing reports,
file/hook failures and incomplete required evidence fail closed. Changed-file
runs report only the actual import-graph intersection, and fail when nothing
executes. Runner-owned one-shot/report/output options cannot be overridden.
Receipts retain assertion identities/statuses without raw stdout or failure
messages. Console warnings remain diagnostics and are explicitly uncollected;
the receipt does not turn a required failed check into an advisory warning.

Temporary reporter files are removed before acceptance is written. Passing
hooks establish only the test's cleanup assertions, not blanket native/venue
cleanup. Packaged Workspace receipt validation separately requires every
producer check, including `cleanupComplete`; an empty/truncated check object
cannot pass.

CI invocation belongs to [CI Feedback Lanes](development-workflow.md#ci-feedback-lanes);
native/platform and final artifact gates remain separate from this local gate.

## Command Model

Choose the delivery gate with the [Local Feedback Ladder](development-workflow.md#local-feedback-ladder).

| Namespace | Meaning |
|---|---|
| `pnpm test` | Complete default hermetic catalog across Node and UI. This is the deterministic full-suite backstop, not every test-like operation in the repository. |
| `pnpm test:critical` | Entire immutable `critical-local` assertion gate across hermetic and deterministic integration evidence, with a run receipt. |
| `pnpm test:changed` | Hermetic tests in Vitest's static changed-file dependency closure against `origin/dev`. |
| `pnpm test:owner:*` | Complete hermetic inventory for one product owner. |
| `pnpm test:integration:*` | Deterministic local product integration with isolated state; no public network, configured account, or trading write. |
| `pnpm test:contract:*` | Named hermetic contracts whose ownership crosses implementation folders, such as workflow or platform behavior. |
| `pnpm test:system:*` | Dedicated process, host, Docker, installer, or artifact acceptance. These commands are never part of `pnpm test`. |
| `pnpm test:external:*` | Explicit read-only access to public services, configured providers, or local TWS. |
| `pnpm test:live:*` | Explicit demo/paper account acceptance that can submit, cancel, close, or otherwise mutate broker state. |
| `pnpm test:select` | Composable catalog query and advanced Vitest entry point. |
| `pnpm test:suites` | Data-only registered integration/E2E suite inspection. |
| `pnpm test:unit` | Colocated unit/component tests; no registration required. |
| `pnpm test:e2e` | Hermetic E2E specs; dedicated/native commands remain explicit. |
| `pnpm test:inventory` | Complete data-only spec, manifest-check, and registered standalone acceptance inventory. |

The owner suites are:

| Owner | Command | Scope |
|---|---|---|
| Alice | `pnpm test:owner:alice` | Core/domain/server/tool code and Alice-owned shared packages |
| UI | `pnpm test:owner:ui` | Browser UI |
| UTA | `pnpm test:owner:uta` | UTA service, protocol, broker packages, and IBKR package |
| Connector | `pnpm test:owner:connector` | Connector Service and Connector protocol |
| Runtime/CLI | `pnpm test:owner:runtime-cli` | Workspace Runtime, native CLI, and Guardian runtime |
| Desktop | `pnpm test:owner:desktop` | Electron desktop shell |
| Repository tooling | `pnpm test:owner:repo-tooling` | Build, test, release, and repository scripts |

Use `pnpm test:integration` for every deterministic local integration spec, or
`test:integration:workspace` / `test:integration:uta` for the named surface.
The stable cross-folder contracts are `test:contract:workflow`,
`test:contract:platform`, and `test:contract:connector-replay`.

System commands intentionally expose their prerequisite and artifact boundary:

| Command | Boundary |
|---|---|
| `pnpm test:system:dev-stack` | Starts a real temporary local development process tree. |
| `pnpm test:system:guardian` | Starts and kills test-owned Guardian process trees. |
| `pnpm test:system:connector` | Starts a built Connector Service against test-owned state. |
| `pnpm test:system:installer` | Builds disposable Docker images and exercises the checked-out installer payload. |
| `pnpm test:system:installer:dev` | Downloads the current dev installer and uses disposable Docker images. This command requires network access and a published dev candidate. |
| `pnpm test:system:remote` | Creates a disposable Docker/SSH target and transfers a built or selected CLI payload. |

Some acceptance commands primarily own an artifact lifecycle rather than a
test selection. Keep their established owner namespace instead of adding a
decorative `test:*` alias: examples include `pnpm electron:smoke:*`, Electron packing, Broker Pack acceptance, and release
candidate builders. Likewise, the package-manager artifact smoke requires
explicit artifact arguments and is not a parameterless root test command.

## Composable Selection

Use the stable aliases above for normal work. Use `test:select` when a change
needs an intersection that does not deserve another permanent package script:

```bash
pnpm test:select --owner ui --changed origin/dev
pnpm test:select --owner uta --package @traderalice/uta-service
pnpm test:select --lane integration --area workspace
pnpm test:select --lane external-readonly --area market-data --explain
pnpm test:select --owner alice --path src/server/inbox-origin.spec.ts -- --testNamePattern=origin
```

Selectors in one dimension are ORed; different dimensions are ANDed. For
example, two `--owner` values select either owner, while `--owner uta
--package @traderalice/uta-service` selects only the package portion of that
owner. Supported dimensions are `--lane`, `--owner`, `--area`, `--package`,
repo-relative `--path`, `--suite`, and `--tier`. `--changed [base]` intersects the
candidates using Vitest's static import graph; `test:changed` compares committed
and working-tree changes against freshly fetched `origin/dev`. The default lane
is `hermetic`; a zero-file result fails closed rather than counting as a pass.

`--list`, `--explain`, and `--json` are dry-run modes. They enumerate catalog
selection, side effects, prerequisites, and the planned invocation without
loading a test module, probing credentials, or proving that those prerequisites
exist. Arguments after `--` are forwarded to Vitest except runner-owned
reporter/output and one-shot execution options, which are rejected. Focused
name filters are development feedback, not acceptance for excluded assertions;
required gates reject all forwarded arguments.

Use the [Local Feedback Ladder](development-workflow.md#local-feedback-ladder)
for cumulative-delivery acceptance. Inspect affected unit/owner/package tests
beyond suite registration: static imports do not establish dynamic-import,
generated-contract, registry or child-process impact.

Docker fixtures under `scripts/` are disposable installer and SSH test hosts;
they are not supported deployment images. OpenAlice does not ship a backend
Dockerfile, Compose recipe, or container supervisor.

The generic selector does not execute the `system` inventory; use the matching
`test:system:*` command. Run `pnpm test:select --help` for the live catalog.

## Side Effects and Acceptance

Lane names are safety contracts:

| Lane | Allowed effects | Acceptance rule |
|---|---|---|
| Hermetic | Temporary local files and test-owned subprocesses only | Every selected spec passes in isolated repository state. |
| Integration | Temporary local files and test-owned local processes only | Every selected deterministic product journey runs and passes. |
| System | Only the host/container/network effects documented by the dedicated command | The command's prerequisites are present and its complete owned journey passes and cleans up. |
| External read-only | Network reads and the selected spec's documented local configuration; never an order write | At least one intended external scenario actually runs and passes. |
| Live paper | Network access and writes to verified demo/paper accounts | The selected scenario runs, passes, and the account returns to its pre-run positions/orders baseline even after failure. |

An external or live command that skips every selected test is **not run**, not
accepted. Missing Docker, network access, credentials, TWS, a published dev
candidate, or another prerequisite is a reported gap; an unrelated green lane
does not replace it.

Every live command requires `OPENALICE_UTA_LIVE_PAPER=1`. Before setting it,
verify the exact selected account is demo/paper and record its positions and
open orders. Prefer a provider command such as
`test:live:ibkr-paper`, `test:live:bybit-paper`, `test:live:okx-paper`,
`test:live:alpaca-paper`, or `test:live:hyperliquid-paper`.
`test:live:uta-paper` is the configured provider sweep.

`test:live:bybit-diagnostic` is deliberately separate: it performs a raw
market buy and only a best-effort close. It is never selected by the UTA paper
sweep and must not be used as routine live acceptance. Follow
[[docs/uta-live-testing.md]] for account safety and cleanup.

## Package-Local Tests

A workspace package's `test` script means that package's hermetic specs only:

```bash
pnpm -F @traderalice/openalice-cli test
pnpm -F @traderalice/uta-service test
```

It must not recursively run sibling packages or the complete product owner.
Conversely, an owner suite may cross several packages and application roots.
Use `test:select --package <workspace-name>` when combining a package boundary
with an owner, area, changed graph, or non-hermetic lane.

Package-local external or live scripts must route through the same root lane
and acknowledgement contract. The presence of a credential or reachable broker
must never silently turn a package's ordinary `test` into external or trading
acceptance.

## Adding or Moving a Test

Before adding an assertion, name the user-visible failure or boundary invariant
it can detect. Prefer extending the existing test that owns that behavior over
creating another file with the same fixture and mocks. Keep distinct failure,
retry, authorization and persistence cases even when setup is shared.

Test observable results rather than copying implementation: CSS declarations,
utility class names, decorative text and versioned asset filenames are usually
poor contracts. Layout, hit targets, cascade and reduced motion need a rendered
browser check. Asset tests can instead follow the production manifest and check
that files exist with the dimensions/format required by their consumer. Static
checks remain appropriate when source is the actual contract, such as release
authority or forbidden dependency boundaries.

When pruning, record what stops being asserted and why, what useful behavior
remains covered, and any real surface gap. Do not delete a test merely because
it is slow, flaky, large, owner-only or currently failing. A focused mutation
can establish whether a supposedly covered regression actually fails the test;
restore the mutation before accepting the change. Test counts and line coverage
are inventory signals, not product acceptance.

1. Choose [scope and registration](#test-scope-and-registration) independently
   of [execution conditions](#side-effects-and-acceptance).
2. Keep owner/lane/package/area routing intact when moving tests, and do not
   import side-effectful fixtures during inventory.
3. Keep the default environment isolated. Never hide a public request,
   configured-home read, Docker dependency, or broker write behind a skip in
   the hermetic catalog.
4. Add a named root alias only for a durable owner, risk, contract, or system
   boundary that developers will select repeatedly. One-off intersections use
   `test:select`; artifact builders keep their owning command namespace.
5. Update package-local scripts when the package contract changes, then run
   `pnpm test:contract:workflow`. Its catalog contract requires every collected
   spec to have exactly one owner and one lane and protects the root command
   namespace.
6. Verify under the [Local Feedback Ladder](development-workflow.md#local-feedback-ladder).

Do not create a new Vitest project merely to obtain a product label. Add or
change execution environments only when isolation or runtime behavior actually
requires one.

All runnable Vitest configs share `scripts/test-collection-inputs.mjs` metadata
triggers, including deterministic integration and the explicit external/live
lanes. A metadata-only `--changed` edit invalidates collection across the
selected lane; it does not change that lane's side-effect authorization or make
static import analysis complete for dynamic runtime dependencies.

## Dynamic lifecycle consumers

The registered `startup-project-selection` suite includes real Supervisor PTY
startup, selection and recovery with controlled Runtime fixtures. It does not
establish native Electron, real SSH or signed-artifact behavior. Static changed
imports do not follow child-process entry paths; select affected suites and
owner/package tests explicitly. Shutdown completion-drain tests also do not
certify that every storage layer propagates disk write failures.
