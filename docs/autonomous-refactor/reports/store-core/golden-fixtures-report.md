# Store Core Golden Fixtures Report

## Summary

Captured the Phase 1 legacy TypeScript behavior baseline for `store_core` without editing production source or existing tests.

- Fixture bundle: `docs/autonomous-refactor/fixtures/store-core/`
- Contract read: `docs/autonomous-refactor/module-contracts/store-core.md`
- Source commit captured in fixture: `8efdd96fe680792974ca2381e536afac1c606a10`
- Raw JSONL fixture files: 7
- Behavior expectation bundle: `docs/autonomous-refactor/fixtures/store-core/legacy-behavior-fixtures.json`
- Production source edits: none
- Existing test edits: none

## Fixture Files

| Fixture | Purpose |
| --- | --- |
| `event-log/legacy-events.jsonl` | Legacy `createEventLog().append()` output plus restart append, preserving seq, timestamp, causedBy, and newline-delimited records. |
| `event-log/recovery-mixed.jsonl` | Event-log recovery tolerance for malformed JSONL lines and append-after-recovery sequence continuation. |
| `session/legacy-session.jsonl` | Deterministic `SessionStore.appendRaw()` JSONL for user, assistant, meta, compact boundary, compact summary, tool, and image entries. |
| `session/append-probe-session.jsonl` | Legacy `appendUser()` / `appendAssistant()` output with generated UUIDs, parent chaining, timestamps, metadata, and normalized `cwd`. |
| `session/malformed-session.jsonl` | Current session-reader behavior for malformed JSONL: `readAll()` throws instead of skipping malformed lines. |
| `news/legacy-news.jsonl` | Legacy `NewsCollectorStore.ingest()` output and duplicate-dedup non-append behavior. |
| `news/recovery-mixed.jsonl` | News-store malformed-line recovery, retained historical dedup keys, publication-time sorting, and append-after-recovery sequence continuation. |

## Behaviors Frozen

- Event log append, disk replay, `afterSeq`, exact `type` filtering, limit handling, newest-first pagination, recent-buffer recovery, missing-log empty behavior, malformed-line skip behavior, and append-after-recovery sequence behavior.
- Session JSONL read behavior for `user`, `assistant`, `system`, and excluded `meta` entries; active-window slicing from the last compact boundary; restore parent chaining; malformed-line failure behavior; and converter outputs for model messages, Responses input, text history, and chat history.
- News ingestion, duplicate rejection, full-history dedup recovery, retention-aware memory recovery, exclusive lower/inclusive upper time filtering, lookback filtering, tail limit behavior, and archive search/read outputs.
- Archive search fixtures cover title regex search, content regex search, case-insensitivity, metadata exact-match filters, result limits, metadata truncation, grep context ellipses, untitled news, invalid index, and empty archive behavior.

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `git status --short` | PASS | Clean before fixture generation. |
| `pnpm exec tsx <<'TS' ...` | PASS | Generated JSONL fixtures and behavior expectations from current TypeScript code. |
| `node <<'JS' ...` | PASS | Parsed all valid JSONL fixtures, confirmed mixed malformed fixtures contain both valid and invalid lines, and validated key behavior-bundle invariants. |
| `pnpm test -- src/core/event-log.spec.ts src/core/session.spec.ts src/domain/news/store.spec.ts src/domain/news/query/archive.spec.ts` | PASS | 4 files passed, 122 tests passed. |
| `git diff --check` | PASS | No whitespace errors. |

## Gaps

- No Rust implementation, Node binding, feature flag, or production integration was added.
- Session `appendUser()` / `appendAssistant()` fixture UUIDs are intentionally captured values; only `cwd` is normalized for portability.
- Invalid UTF-8 behavior and OS-level partial-write behavior are not covered by these JSON-text fixtures.
- Archive tool factory `new Date()` behavior is covered through the pure archive functions and provider `getNewsV2()`, not by invoking the AI tool wrapper itself.

## Recommended Sequencing

1. Add a parity harness that consumes `legacy-behavior-fixtures.json` and the raw JSONL files against the current TypeScript path.
2. Implement Rust read-only parsers/replay kernels first and compare them with these fixtures before adding append support.
3. Add Rust append support behind an opt-in flag only after TypeScript can read Rust-written JSONL and Rust can read the legacy fixtures.
4. Treat JavaScript regex semantics in archive search as an explicit compatibility dependency; use a shim or request Architecture approval before changing pattern behavior.
