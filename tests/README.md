# Integration and E2E topics

Same-name unit/component specs belong beside their implementation and need no
registration. Integration suites belong in `tests/integration/<topic>/`; E2E
suites belong in `tests/e2e/<topic>/` or an existing registered native/artifact
runner. Both higher tiers require suite registration. Scope is independent of
external access, trading writes and other execution conditions.

Migration is in progress: the five deterministic integration suites have moved,
while `scenarios/` and `contracts/` still hold legacy `coverage.json` manifests
and some PTY specs. The legacy fields below describe what the current selector
consumes, not the final registration contract. Ordinary unit assertion mappings
will be removed as suite/gate consumers migrate together. No new cases or
coverage expansion are part of this work. See [[plans/test-system-grouping.md]].

## Browse and run

```bash
pnpm test:groups
pnpm test:groups --scenario desktop-lifecycle --explain
pnpm test:groups --contract alice-uta --json
pnpm test:inventory --json
pnpm test:critical --receipt artifacts/tests/critical-local.json
pnpm test:select --scenario workspace-creation --lane integration
pnpm test:select --scenario first-run --contract alice-uta --owner alice --explain
pnpm test:select --contract ui-api
pnpm test:select --scenario startup-project-selection --explain
```

`--scenario` and `--contract` OR values within their own dimension and AND
with one another and the existing lane/owner/area/package/path dimensions.
Execution selects the **spec evidence referenced by requirements**, not every
test that happens to live in a related folder. The default lane remains
hermetic. Choose integration explicitly. Empty executable selections fail.

`--groups` inspects complete requirements, including rows with no test yet.
It accepts scenario/contract filters and output modes, but rejects file/lane
filters so it cannot hide a gap behind an unrelated selection. `--inventory`
is complete and unfiltered: every spec appears once, with its owner/lane and
group references, and every discovered manifest check/registered standalone
acceptance appears with its runner and prerequisites. Both modes read only
repository data and never import tests, inspect user credentials, or execute
acceptance commands.

Dedicated commands are additional evidence to obtain separately. A group's
paper, Docker, package-manager, or Electron command is never implicitly
executed by selecting that group. Established owner command namespaces remain
authoritative. Artifact builders/publication operations are not part of this
test inventory or the selector; a verification task in a publishing workflow
does not authorize invoking the entire workflow.

## Scenarios

| Group | Product behavior | Responsible owner |
| --- | --- | --- |
| [first-run](scenarios/first-run/coverage.json) | Initialization, login, and broker-free Chat | Alice |
| [startup-project-selection](scenarios/startup-project-selection/coverage.json) | Shared Default migration, explicit overrides, and verified/cancelled Project selection | Runtime/CLI |
| [workspace-creation](scenarios/workspace-creation/coverage.json) | Bootstrap, injection, and source ancestry | Runtime/CLI |
| [conversation-recovery](scenarios/conversation-recovery/coverage.json) | Interrupt, resume, and durable Session recovery | Runtime/CLI |
| [scheduling-delivery](scenarios/scheduling-delivery/coverage.json) | Occurrence claims, retries, and observable CLI side effects | Runtime/CLI |
| [trading-approval](scenarios/trading-approval/coverage.json) | Staging, approval, lifecycle, precision, and venue baseline | UTA |
| [connector-delivery](scenarios/connector-delivery/coverage.json) | Inbox projection, replay, and adapter recovery | Connector |
| [desktop-lifecycle](scenarios/desktop-lifecycle/coverage.json) | Startup Home/owner handoff, request retirement, close/reopen, and explicit quit | Desktop |
| [update-recovery](scenarios/update-recovery/coverage.json) | Persisted state, N-1 app/CLI artifacts, and restart | Desktop |

## Boundaries

| Group | Contract | Responsible owner |
| --- | --- | --- |
| [ui-api](contracts/ui-api/coverage.json) | UI, authenticated HTTP, request identity, and error behavior | Alice |
| [alice-uta](contracts/alice-uta/coverage.json) | Optional carrier, shared errors, and trading permissions | UTA |
| [cli-tool-gateway](contracts/cli-tool-gateway/coverage.json) | Workspace scope, strict arguments, and real socket transport | Alice |
| [guardian-process](contracts/guardian-process/coverage.json) | Runtime ownership, takeover, recovery, and cleanup | Runtime/CLI |
| [desktop-ipc](contracts/desktop-ipc/coverage.json) | Renderer/preload/main/child requests and PTY | Desktop |
| [alice-connector](contracts/alice-connector/coverage.json) | Validated claims and directed optional-service delivery | Connector |
| [persisted-state](contracts/persisted-state/coverage.json) | Shipped formats, migration journal, and Session dossiers | Alice |
| [development-workflow](contracts/development-workflow/coverage.json) | Test selection, collection, and source/publication authority | Repository tooling |
| [native-platform](contracts/native-platform/coverage.json) | Native shell arguments, toolchain, and platform evidence | Runtime/CLI |

## Interpret the matrix

- `mapped`: reviewed assertion/runner evidence is linked; no additional gap is
  recorded for that bounded requirement. It does not mean a run passed.
- `partial`: evidence exists, but the row names an unproved behavior or
  environment. A fake BrowserWindow can prove a callback while native
  close/reopen with an active Session remains partial.
- `missing`: no assertion or runner evidence is linked for the requirement.
- `unreviewed`: the behavior/evidence needs review before drawing a conclusion.
- `owner-only` in the inventory: a leaf spec is accounted for by owner/lane but
  has not been claimed as evidence for one of these product requirements.
  Do not infer that its assertions prove a full scenario, or that it has no
  value merely because it remains owner-only.

The initial matrix is a reviewed starting set of important behaviors, not an
exhaustive catalog of all product behavior or every assertion in every leaf
spec. P0/P1/P2 rank follow-up review and gap work; Stage 1 introduces no new
CI policy, native acceptance receipt, broker run, or product coverage claim.
Stage 2 adds bounded local Chat/restart, real child recovery/shutdown and
loopback approval evidence, plus strict required-run and packaged receipt
checks. The broader native close/reopen/quit, browser onboarding and venue
requirements retain their explicit gaps.

## Required acceptance

The bounded startup/lifecycle pilot references existing leaf assertions without
moving files or changing their owner/lane. `startup-project-selection` separates
shared Default persistence from verified attachment; `desktop-lifecycle` also
maps controller, dialog, IPC retirement and shutdown helpers; `guardian-process`
includes capability/remaining-lock stop completion and real descendant cleanup.
Fake Electron callbacks, local socket fixtures and real Node children remain
distinct evidence levels. They do not establish native chooser/Dock/tray/menu
behavior, a real SSH connection, or complete Runtime process/port cleanup.

To inspect both Desktop and Guardian evidence, query them separately: a scenario
plus a contract is an intersection, not a union. Their default hermetic
selections do not execute the listed system or Electron commands. Keep
`critical-local` whole; this pilot does not change its required rows.

`gates.json` names reviewed bounded requirements by group and row ID. The
`critical-local` gate resolves their spec assertions from the coverage manifests
and checks actual passing results. It cannot auto-run a dedicated Electron,
Docker, external or paper command. Adding evidence to a required row changes
its gate: keep its scope deliberate and verify the entire gate.

`pnpm test:critical` rejects narrowing filters and all forwarded runner arguments.
Generic scenario selection remains composable but is not equivalent to required
acceptance. Actual run receipts are kept separate from `coverage.json`; a static
mapping is never a run result. See [the testing guide](../docs/testing.md) for
receipt identities, skips, failure and cleanup limits.

## Maintain evidence

Add a required behavior row before claiming its coverage. Reference an existing
spec by exact repo-relative path and an assertion title/unique stable fragment,
or a command by its inventory id (`<package>#<script>`; standalone ids are in
`commands.json`). State the fidelity and what its environment does and does not
prove. `review` is `reviewed` or `unreviewed`; `gap` is explicit, including an
empty string only when no additional gap has been identified for that row.

Every central spec declares its owner, lane, named areas, and optional package
association in exactly one group's `centralTests`; it must also appear in an
evidence row. This preserves package selection after moving a package-owned
integration test. Other groups may reference the same spec without claiming
its ownership. New central hermetic specs are included by their owner's Node
or UI execution environment. New central integration specs feed the existing
integration config. Adding another risk lane requires updating its dedicated
config/selection contract rather than assuming the default runner collects it.

`commands.json` records dedicated runner metadata, not copies of manifest
command strings. Root/package manifests supply those strings at query time.
Named test/smoke/verify/package-inspection commands are discovered automatically;
a new non-Vitest command needs explicit effects and prerequisites. Standalone
artifact acceptances retain their argument-bearing invocation and owning
runner. Runner discovery is intentionally explicit for standalone files:
helper libraries and arbitrary scripts are not presumed executable checks.

Run `pnpm test:contract:workflow` after changing evidence or classification.
Its integrity checks reject removed assertions/tasks, duplicate or missing
central ownership, and catalog references that drift. Collection-wide metadata
changes invalidate changed-test selection. Follow [the testing guide](../docs/testing.md)
for the full verification ladder and side-effect boundaries.

Central TypeScript specs and the catalog guard have an explicit typecheck
because the root `src/` typecheck does not include their new locations:
`pnpm exec tsc -p tests/tsconfig.json`.

The bounded lifecycle follow-up registers the Supervisor PTY journey files in
`startup-project-selection`, installer integrity in `update-recovery`, and terminal
settings saves in `persisted-state`. These are executable mappings in the existing
selector, not an inventory-only classification. Named assertions limit claims;
file-granular selection still runs all cases in each selected file. Real terminal
interaction, synthetic Runtime success, loopback protocol identity and native
artifact acceptance remain separate evidence. Three central PTY journey specs declare Runtime/CLI ownership once; terminal
presentation remains CLI-owned. They share support code, with no assertion copies.
