# Integration and E2E suites

Unit/component specs stay beside the implementation they exercise and require
no registration. Higher-tier tests live in `tests/integration/<topic>/` or
`tests/e2e/<topic>/`. Existing native/artifact acceptance scripts retain their
entry points. Both higher tiers are registered in [suites.json](suites.json).

A suite records its id, purpose, tier, owner, execution lane, areas, optional
workspace package, files or dedicated commands, and scope limitations. Files
are registered once. Individual `it()` names are not copied into this catalog.
No unit registration or artificial product-coverage percentage is required.

```bash
pnpm test:suites
pnpm test:suites --tier e2e --explain
pnpm test:inventory --json
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:select --suite conversation-recovery --lane integration
pnpm test:select --tier integration --owner uta --lane external-readonly --explain
pnpm test:critical --receipt artifacts/tests/critical-local.json
```

`--suite` values are ORed. Tier, owner, lane, package, area and path intersect.
The default execution lane is hermetic. `test:integration` includes both
hermetic module integration and the existing serialized local-process profile
(named `integration`). Neither it nor `test:e2e` grants external/native/trading
permission. Dedicated commands are listed with prerequisites and never invoked
automatically. Empty runnable selections fail; use `test:suites` to inspect a
command-only suite. JSON/list/explain modes never import specs or probe a host.

## Required gate

[gates.json](gates.json) independently pins the existing 15 required assertions.
This is the bounded critical gate's acceptance contract, not the unit/suite
registration catalog. It cannot be narrowed by selectors, changed-file filters
or test-name arguments. Missing, duplicate, skipped or failed required evidence,
cleanup-hook errors and all-skipped runs fail acceptance. Every executed selector
run writes a source/host/outcome receipt; registration and collection are not
executed acceptance. No required assertion was removed during catalog migration.

## Limits

The old scenario/contract assertion matrix is retired. Its unit references never
proved browser onboarding, native Dock/tray/quit, real agent authentication,
external Connector recovery, venue timing or complete remote process cleanup.
Those limits remain; directory moves and green local fixtures do not close them.
Suite scopes and dedicated-runner prerequisites describe bounded evidence.

The hierarchy migration reorganized and pruned existing tests without adding
test cases or expanding product coverage. Missing product evidence remains a
separate concern from complete registration of the tests that already exist.
