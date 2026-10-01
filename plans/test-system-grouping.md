# Existing test hierarchy and registration cleanup

Status: active, maintainer-directed work from `dev` on
`codex/test-value-pruning`. This plan supersedes the previous evidence-expansion
plan. Delivery follows the normal interactive workflow; historical Draft-only
restrictions belonged to earlier increments, not this cleanup.

Owner guides: [[docs/testing.md]], [[tests/README.md]],
[[docs/development-workflow.md]], and each migrated subsystem's guide in
[[docs/README.md]].

## Agreed scope (2026-10-02)

Process existing tests only. Move, rename, consolidate, delete low-value checks,
and repair discovery/registration references. Do not add test cases, expand
assertions to cover new behavior, invent product journeys, or fix unrelated
product behavior as part of this migration. Record real defects in GitHub
Issues; missing coverage is not permission to add tests in this work.

- Colocated, same-name specs are unit/component tests of their module's own
  responsibility. They require no registration. Do not classify by mocking
  syntax, jsdom, file size, or current directory alone.
- Integration tests exercise collaborating production modules. Put them under
  `tests/integration/<topic>/` and register the suite.
- E2E tests exercise a user workflow through the actual application entry and
  relevant runtime. Put them under `tests/e2e/<topic>/`, or keep an existing
  artifact/system runner as the registered entry. A local child fixture or
  in-process Hono request does not become E2E because of its filename.
- Register integration/E2E suites, not individual leaf unit assertions. Keep
  topic, purpose, tier, entry files/commands, owner, execution requirements and
  honest limitations. Scenario and protocol are topic labels, not test tiers.
- Test tier is independent of side effects. Preserve isolated, external-readonly,
  live-paper and native/artifact execution boundaries. In particular, ordinary
  tests must never acquire external/trading side effects during relocation.
- Keep one catalog/selector. Simplify the existing metadata rather than adding
  a second inventory framework. Derive redundant file ownership when possible.
- Preserve existing required evidence while migrating its references. Changing
  general suite registration must not weaken `critical-local`, skipped/missing
  evidence rejection, or paper-account acknowledgement.

## Baseline and what is not finished

At the current pre-delivery working tree: 920 specs, 70 registered commands,
18 semantic groups and 57 requirement rows (5 mapped, 51 partial, 1 missing).
Only 47 specs are referenced by semantic groups; 873 are owner-only. These are
legacy inventory labels, not 873 missing registrations under the new policy:
unit tests are intentionally unregistered, and higher-tier tests still need
case-level classification. No line-coverage or full-product acceptance claim.

Earlier framework increments #1667/#1672 and lifecycle follow-ups established
selection and required-run safeguards. #1695 removed 50 Office CSS-text cases
and consolidated PNG checks. Historical execution details remain in Git/PRs.

## Ordered implementation

1. [x] Record the maintainer's hierarchy, registration boundary and no-new-tests
   constraint in this canonical plan and the owner guide.
2. [x] Finish the already-started pruning batch: consolidate Tools fixtures and
   icon fallback checks; remove unsupported visual/copy assertions and duplicate
   command contracts. Preserve existing failure/retry/keyboard/fallback cases.
   Do not retain newly added behavior assertions from the preceding audit.
3. [x] Relocate the five existing deterministic local integration specs to
   `tests/integration/`: first-run, conversation-recovery, workspace-creation,
   trading-approval and alice-uta. Drop misleading `.e2e` names; preserve file
   contents, owner, lane, package filters, required references and side effects.
4. [ ] Simplify registration to suites. Migrate `coverage.json`/selector consumers
   together; remove unit/component references and ordinary per-`it` duplication.
   Preserve the current required-gate evidence explicitly before removing any
   row it uses. Do not keep a permanent dual registry/compatibility parser for
   this unreleased development metadata.
5. [ ] Review existing higher-tier candidates by owner, one coherent topic at a
   time: Runtime/CLI and Workspace lifecycle; Alice/Connector; UTA/protocol;
   UI/Desktop; repository tooling. Read actual setup, dependencies and assertions.
   Leave true units beside their module, lift real integration/E2E suites,
   consolidate shared setup and duplicate behavior, and document deletions in
   the matching PR. Review non-colocated leaf specs rather than assuming E2E.
6. [ ] Converge commands and inventory: expose tier separately from execution
   conditions; an unregistered unit is normal, an unregistered integration/E2E
   suite is an error. Reuse existing catalog checks to catch missing entries,
   dangling paths and duplicate execution. Reduce obsolete aliases/metadata.
7. [ ] Reconcile the complete repository inventory, docs and CI selections;
   record remaining limitations without filling coverage gaps. Delete this plan
   and its PLANS entry only after the migration is accepted.

Steps 4–6 are not complete when only paths have moved. During the bounded first
increment, `tests/scenarios/` and `tests/contracts/` still contain legacy
assertion-level metadata and some PTY specs; that transitional state must remain
explicit in docs and must not be called full semantic classification.

## Verification and completion criteria

For each relocation, compare original and moved content, imported fixtures,
collected test identities/counts and selector results. Preserve package/owner/
area routing and ensure each test executes once. Run the existing relevant
suite and typecheck; metadata/runner changes also need root/UI/central-tests
typechecks, full `pnpm test`, local integration and the indivisible critical
gate. Real UI checks apply to the earlier UI pruning batch. No new tests are
required or authorized as validation of this cleanup.

Completion requires every existing retained integration/E2E suite to have an
accurate registration, no unit registration requirement, physical locations and
names matching scope, no dangling metadata, no silently omitted required case,
and no new test cases. Existing skips or unrun native/external gates must be
reported, not converted into acceptance.

## Current findings and bounded evidence

- Removing SVG mask styles temporarily left all six old icon tests green.
  Restore was byte-for-byte. The pruning keeps unknown-brand fallbacks and
  retires unsupported brand/transparency claims; rendered icon correctness
  remains outside those unit checks.
- The earlier pruning working tree passed 892 hermetic files: 7,577 passed,
  8 skipped, zero failed. The critical gate accepted its whole evidence set.
  These results precede the hierarchy migration and must not certify it.
- Real demo Tools interaction checked independent group toggling, keyboard
  activation and collapsed controls being skipped by Tab. Demo acceptance does
  not establish real backend persistence or native application behavior.
- Existing boundary defects remain separate: IBKR delayed write acknowledgement
  [#1680](https://github.com/TraderAlice/OpenAlice/issues/1680), cross-bundle Decimal
  identity [#1513](https://github.com/TraderAlice/OpenAlice/issues/1513), Office
  navigation [#1440](https://github.com/TraderAlice/OpenAlice/issues/1440), and PTY
  probe timing [#1671](https://github.com/TraderAlice/OpenAlice/issues/1671).

## First increment acceptance (2026-10-02)

- Three fewer spec files and 275 fewer spec lines than the branch base; 12
  low-value/duplicate cases retired, no cases added. Icon unit fallbacks remain
  in same-name files; the two Tools cases share their existing module fixture.
- Five integration files moved with byte-identical contents. Their 30 existing
  cases pass; catalog selectors retain owner, lane, area and package routing.
- Root, UI and central-test TypeScript checks pass. Full hermetic verification:
  893 files, 7,577 passed, 8 skipped, zero failed. Workflow selection: 105 passed.
- The indivisible critical gate passes 18 cases, including all 15 required
  assertion references. No gate row was removed or narrowed.
- Product source is unchanged. No real broker, external-provider, packaged
  desktop or native-platform acceptance was executed or claimed.
- Next increment is step 4: replace ordinary assertion-level mapping with suite
  registration while preserving required-gate evidence. Do not report the
  directory migration as completion of registration cleanup.
