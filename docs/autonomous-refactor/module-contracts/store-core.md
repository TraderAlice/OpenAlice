# Store Core Module Contract

## Contract metadata

- Module ID: `store_core`
- Status: contract draft for architecture review
- Canonical path: `docs/autonomous-refactor/module-contracts/store-core.md`
- Source playbook: `docs/autonomous-refactor/PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md`
- Source manifest: `docs/autonomous-refactor/openalice-rust-refactor.manifest.yaml`
- Baseline report: `docs/autonomous-refactor/reports/baseline/phase-1-baseline-report.md`

This contract defines the stable boundary for a future Rust `store_core`
migration. It does not authorize source code edits by itself. Every
implementation issue must restate its exact allowed files before editing and
must keep the legacy TypeScript path available until parity, rollback, QA, and
release gates pass.

## Objective

Define the storage/log boundary that can move from TypeScript to Rust while
preserving OpenAlice's existing append-only JSONL persistence, session replay
behavior, event-log recovery behavior, news archive search behavior, and public
TypeScript-facing data shapes.

The Rust migration is a compatibility-preserving replacement of deterministic
storage internals, not a storage-format redesign.

## Scope

### In-scope OpenAlice paths

Future implementation issues may target only these OpenAlice paths when the
issue explicitly allows them:

- `src/core/event-log.ts`
- `src/core/session.ts`
- `src/domain/news/`

The news scope is limited to deterministic persistent store, archive query, and
search behavior. RSS collection, feed configuration, connector routing, UI, and
network fetch behavior remain TypeScript orchestration concerns unless a later
architecture-approved contract update expands this boundary.

### Future Rust deliverable paths

- `crates/store-core/`
- `packages/node-bindings/store-core/`

The Rust crate owns deterministic JSONL parsing, append, scan, replay, recovery,
filtering, and search kernels. The Node binding owns TypeScript-facing DTO
conversion and error normalization. TypeScript remains the outer orchestration
shell during migration.

### Explicitly excluded paths

- `ui/`
- `src/connectors/`
- `src/ai-providers/`
- `src/tool/` unless a later issue explicitly permits a thin integration shim
- RSS/network fetching behavior outside persistence DTO ingestion
- changes to on-disk storage format
- broad cleanup or formatting churn outside the issue's allowed files

## Public Behavior Rule

The public behavior rule for this module is:

`preserve_jsonl_compatibility`

The Rust-backed path must read existing JSONL files, append compatible JSONL
records, and preserve observable ordering, filtering, recovery, and archive
search results. Existing data files must not require migration to remain usable.

## Current Storage Surfaces

### Event log

Current default path:

- `data/event-log/events.jsonl`

Current record shape:

- `seq`: global monotonic sequence number
- `ts`: event timestamp in epoch milliseconds
- `type`: event type string
- `payload`: arbitrary JSON-serializable payload
- `causedBy`: optional parent event sequence number

Current behavior to preserve:

- appends write one JSON object plus `\n` to disk before updating memory state
- in-memory recent buffer contains the latest configured number of entries
- `read()` scans disk in file order and returns ascending sequence order
- `read({ afterSeq })` returns entries with `seq > afterSeq`
- `read({ type })` returns exact type matches only
- `read({ limit })` stops after the first matching entries in file order
- `query()` returns newest-first paginated disk results
- `recent()` reads the in-memory buffer in buffer order and supports the same
  `afterSeq`, `type`, and `limit` filters
- `lastSeq()` returns `0` when no valid entries exist
- startup recovery loads the tail of valid disk entries into memory and
  continues appends after the recovered sequence
- missing files are treated as empty logs
- malformed JSONL lines are skipped during event-log disk reads and recovery
- listener fan-out happens after successful append and must not let listener
  exceptions fail the append
- registered event payload validation remains TypeScript-owned unless an issue
  explicitly moves or mirrors the validator

### Session store

Current default path:

- `data/sessions/{sessionId}.jsonl`

Current record shape is a Claude Code-compatible subset:

- `type`: `user`, `assistant`, `meta`, or `system`
- `message.role`: `user`, `assistant`, or `system`
- `message.content`: string or content-block array
- `uuid`
- `parentUuid`
- `sessionId`
- `timestamp`: ISO timestamp string
- optional `provider`
- optional `cwd`
- optional `metadata`
- optional compaction fields: `subtype`, `compactMetadata`, `isCompactSummary`

Current behavior to preserve:

- user and assistant appends create new UUIDs and chain `parentUuid` from the
  last appended or restored entry
- append writes one JSON object plus `\n`
- `appendRaw()` persists caller-provided entries without reshaping them
- `readAll()` returns persisted `user`, `assistant`, and `system` entries and
  excludes `meta` entries from the returned active conversation stream
- `readActive()` returns the active window from the last compact boundary onward
- `restore()` recovers the last persisted UUID so later appends continue the
  parent chain
- missing session files read as an empty session
- converter behavior for model messages, text history, chat history, and
  Responses API input must remain TypeScript-visible and fixture-backed before
  any Rust parser is wired in
- malformed session JSONL handling must remain compatible with the legacy path
  unless an ADR approves a stricter or more tolerant recovery rule

### News collector store and archive tools

Current default path:

- `data/news-collector/news.jsonl`

Current `NewsRecord` shape:

- `seq`: monotonic ingestion sequence number
- `ts`: ingestion timestamp in epoch milliseconds
- `pubTs`: publication timestamp in epoch milliseconds
- `dedupKey`: `guid:...`, `link:...`, or `hash:...`
- `title`
- `content`
- `metadata`: `Record<string, string | null>`

Current behavior to preserve:

- ingestion appends one JSON object plus `\n` to disk before updating memory
- duplicate `dedupKey` values are rejected without a second append
- recovery rebuilds the full dedup set from disk, including items outside the
  retention window
- recovery loads only retained items into the in-memory buffer and sorts that
  buffer by `pubTs` ascending
- recovery tracks sequence so later appends do not collide with existing records
- malformed JSONL lines are skipped during news-store recovery
- `getNews(startTime, endTime)` returns items where
  `pubTs > startTime && pubTs <= endTime`, sorted ascending by publication time
- `getNewsV2({ endTime, startTime })` and `getNewsV2({ endTime, lookback })`
  preserve the current exclusive lower-bound and inclusive upper-bound behavior
- `limit` keeps the most recent matching tail while returning results in
  ascending publication-time order
- `globNews()` uses case-insensitive JavaScript regular expressions on titles
  and returns index, title, content length, and truncated metadata
- `grepNews()` uses case-insensitive global JavaScript regular expressions over
  `title + "\n" + content`, includes configurable context, resets regex state
  between records, and returns the first match per item
- `readNews()` reads by the stable index from the matching news list and returns
  `null` for invalid indices in pure function form

## JSONL Compatibility Requirements

Rust-backed storage must preserve the existing JSONL contract:

- one UTF-8 JSON object per line
- line terminator is `\n`
- no binary encoding, envelope format, compression requirement, or sidecar index
  may become required for compatibility
- existing files written by the TypeScript path must remain readable
- files written by the Rust path must remain readable by the TypeScript path
- appends must not rewrite or reorder existing lines
- persisted field names, timestamp representations, optional-field omission, and
  JSON value types must remain compatible with existing fixtures
- unknown fields in existing records must not cause data loss when records are
  scanned, filtered, or returned through existing TypeScript DTOs
- any intentional format normalization requires an ADR, migration plan, rollback
  plan, compatibility fixtures, Architecture approval, QA approval, and release
  approval before it can ship

## Append, Replay, and Recovery Expectations

The Rust path must preserve these operational invariants:

- append operations are ordered exactly as callers observe them
- append success means the JSONL line has been accepted by the persistence layer
  before in-memory indexes, subscribers, or query buffers expose the record
- monotonic sequence behavior must be preserved for event and news records
- replay from existing JSONL must produce the same visible state as the legacy
  TypeScript path for event-log buffers, session parent chains, active sessions,
  news dedup state, and archive query results
- missing files and empty files must match legacy behavior for each store
- malformed-line tolerance must be store-specific and fixture-backed
- partial-line, truncated-file, and invalid-UTF-8 behavior must be characterized
  with fixtures before Rust replaces a reader in production
- startup recovery must be deterministic for the same file contents, retention
  settings, buffer sizes, and clock fixture
- recovery must not perform schema migrations or destructive cleanup unless a
  separate approved issue explicitly authorizes it

## Archive Search Parity Requirements

News archive parity is part of `store_core`, not an optional integration detail.

The Rust-backed path must preserve:

- `globNews`, `grepNews`, and `readNews` result ordering and indexing
- JavaScript regex compatibility or an explicitly approved compatibility shim
- case-insensitive title and content matching
- metadata filter exact-match semantics
- metadata preview truncation behavior
- content-length reporting
- context-window and ellipsis behavior for grep results
- untitled news behavior
- empty archive behavior
- invalid-index behavior
- consistent indices between a search and a read when the same time window is
  used

If Rust uses a different regex engine internally, implementation issues must add
compatibility tests for the JavaScript regex patterns already accepted at the
TypeScript tool surface. Unsupported pattern behavior cannot change silently.

## DTO and Error Boundary Expectations

DTOs crossing the TypeScript/Rust boundary must be JSON-compatible and stable at
the existing TypeScript API boundary.

Implementation work must preserve:

- public field names and optional/required status
- timestamp units and ISO string versus epoch millisecond distinctions
- session content-block shapes
- sequence number semantics
- news metadata value types, including `null`
- error meaning for missing files, invalid indices, duplicate news records, and
  malformed inputs
- current query defaults, pagination defaults, and buffer-size defaults

Rust-specific errors must be normalized before crossing into TypeScript. Public
callers must not need to know whether the legacy or Rust path handled a request.

## Feature Flag Expectation

The Rust-backed path must be guarded by:

```text
OPENALICE_RUST_STORE_CORE=0|1
```

Rules:

- `OPENALICE_RUST_STORE_CORE=0` is the default legacy TypeScript path.
- unset, empty, or invalid values must behave like `0`.
- `OPENALICE_RUST_STORE_CORE=1` may route approved store-core operations through
  Rust only after parity fixtures and rollback tests exist.
- the flag must be reversible without data migration.
- tests must exercise both legacy and Rust paths while the flag exists.
- default-on rollout requires release approval after compatibility, recovery,
  archive-search, benchmark, and rollback evidence is recorded.

## Required Test and Evidence Matrix

Future implementation issues must provide evidence for:

- event-log append, disk read, recent buffer, pagination, type filtering,
  `afterSeq`, `limit`, recovery, malformed-line, listener, and `causedBy`
  behavior
- session append, raw append, read-all, active-window, restore, content-block,
  compaction-boundary, converter, missing-file, and malformed-line behavior
- news ingest, duplicate rejection, recovery, retention, max-in-memory trimming,
  dedup persistence, time-window query, lookback query, limit, and ordering
  behavior
- archive `globNews`, `grepNews`, and `readNews` parity against golden fixtures
- JSONL round-trip compatibility in both directions:
  TypeScript-written file read by Rust and Rust-written file read by TypeScript
- feature-flag tests proving `OPENALICE_RUST_STORE_CORE=0` uses the legacy path
  and `OPENALICE_RUST_STORE_CORE=1` uses only the approved Rust-backed slice
- rollback tests proving a file touched by the Rust path remains readable after
  switching back to `OPENALICE_RUST_STORE_CORE=0`

Minimum command set for implementation review:

```bash
pnpm build
pnpm test
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace -- -D warnings
```

Run `pnpm test:e2e` when implementation touches user-facing session, archive,
chat, cron, task-router, heartbeat, or connector workflows. The Phase 1 baseline
currently records a trading lifecycle e2e failure caused by numeric/string
expectation mismatches; that known trading failure is not a store-core blocker,
but full release readiness must account for any remaining repository-wide e2e
failures.

## Benchmark Plan and Targets

Benchmarks must compare the legacy TypeScript path against the Rust-backed path
using the same fixtures, file sizes, process conditions, and command
environment.

Required benchmark scenarios:

- event-log append throughput for small and large payloads
- event-log cold recovery from representative and large `events.jsonl` files
- event-log disk scan, `afterSeq`, type filter, and paginated newest-first query
- session append and restore for short, medium, and long session histories
- session conversion overhead for model-message, text-history, chat-history, and
  Responses API shapes where Rust participates in parsing
- news ingest throughput with duplicate and non-duplicate records
- news recovery with retained and expired records
- news archive glob, grep, metadata filter, read-by-index, and lookback windows
- TypeScript/Rust binding overhead for small operations where crossing the
  boundary may dominate runtime

Minimum benchmark reporting fields:

- command executed
- machine/runtime metadata, including Node, pnpm, Rust, and operating system
  versions
- fixture file sizes, record counts, payload sizes, and iteration counts
- median, p95, and worst observed duration where practical
- memory and allocation notes where available
- comparison against the legacy TypeScript baseline
- whether benchmark input files came from TypeScript, Rust, or mixed writes

Targets:

- Rust-backed append paths must not regress median latency by more than 10% for
  small records unless Architecture and QA approve the tradeoff.
- Recovery and scan workloads for medium and large JSONL files should show a
  measurable improvement over the TypeScript baseline.
- Archive search must not regress median runtime by more than 10% for small
  archives and should improve for larger archives.
- Binding overhead must be reported separately so small-operation regressions are
  visible.
- No benchmark result can justify a JSONL compatibility break without an
  approved contract update.

## Required Approval Gates

- Architecture approval is required before the first source code edit for the
  Rust store-core crate, binding strategy, or DTO boundary.
- Integration approval is required before any TypeScript store, session, or
  archive path calls into Rust.
- QA approval is required before relying on Rust parity for recovery, JSONL
  compatibility, or archive search behavior.
- Release approval is required before enabling the Rust path by default in any
  shared environment.

Any issue that changes on-disk data shape, malformed-line handling, search
semantics, query ordering, timestamp representation, or benchmark acceptance
thresholds must update this contract and receive Architecture plus QA approval
before implementation continues.

## Rollback Plan

If the Rust migration causes JSONL incompatibility, append ordering regression,
replay/recovery mismatch, archive-search mismatch, performance collapse, or
operational instability:

1. Set `OPENALICE_RUST_STORE_CORE=0`.
2. Route all store-core behavior back to the legacy TypeScript path.
3. Confirm TypeScript can still read any JSONL file touched by the Rust path.
4. Preserve the failing fixture, command output, and benchmark or regression
   evidence.
5. Revert only the smallest TypeScript integration slice if disabling the flag
   is insufficient.
6. Do not continue later store-core rollout steps until the failure is fixed,
   approved as an intentional behavior change, or the phase is formally
   descoped.

Rollback is not complete until the issue comment records the failing command,
the restored command result, whether files were Rust-written or TypeScript-
written, and whether follow-up remediation is required.

## First Future Implementation Issue

Name: `store_core: capture JSONL compatibility and archive search fixtures`

Purpose:

- capture representative event-log, session, and news JSONL fixtures written by
  the legacy TypeScript path
- add parity tests that freeze append, replay, recovery, filtering, session
  conversion, dedup, and archive search behavior with
  `OPENALICE_RUST_STORE_CORE=0`
- characterize malformed and partial-line behavior before any Rust reader is
  wired into production
- leave the Rust implementation disabled until Architecture and QA accept the
  fixture baseline

This issue should be assigned only after Architecture accepts this contract and
the allowed-file list is written explicitly in the issue body.

## Contract Checklist

- [x] Module ID is defined as `store_core`.
- [x] In-scope paths are listed.
- [x] JSONL compatibility requirements are explicit.
- [x] Append ordering is defined.
- [x] Replay and recovery expectations are defined.
- [x] Archive-search parity requirements are defined.
- [x] Benchmark plan and targets are defined.
- [x] Feature-flag expectation uses `OPENALICE_RUST_STORE_CORE=0|1`.
- [x] Rollback plan is defined.
- [x] No Rust implementation is authorized by this contract.
- [ ] Golden JSONL fixtures captured from the legacy TypeScript path.
- [ ] Malformed-line and partial-line behavior characterized with fixtures.
- [ ] Rust implementation parity evidence attached.
