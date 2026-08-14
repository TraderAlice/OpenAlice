# Plan: Unified persistent product Session records

**Status:** complete  
**Owner guides:** [[docs/conversation-provenance.md]], [[docs/workspace-lifecycle.md]], [[docs/workspace-issues-and-scheduling.md]]  
**Delivery:** serial PR to `dev` (`area:workspace`, `area:ui`, `review:deep`)

## Goal

Every OpenAlice product Session receives exactly one durable `SessionRecord` at
the same birth boundary as its `resumeId`, regardless of whether its first turn
is interactive or headless. Interactive TUI/WebPi materialization and headless
turns reuse that record instead of constructing competing representations.

The invariant is deliberately narrow and load-bearing:

```text
one resumeId
├── one ResumeIdentityRecord         signature/lifecycle/native mapping
├── one SessionRecord                durable product roster record
├── zero or more HeadlessTaskRecord  execution attempts / turns
└── zero or one active process       headless, terminal, or webpi
```

`resumeId` remains the canonical product conversation identity. This work does
not rename it, replace it with `SessionRecord.id`, expose native runtime ids, or
change Issue assignee / Inbox provenance / collaboration contracts.

## Why this change

Today a fresh headless conversation creates a Resume identity and task, while
its Session record appears only when that conversation is opened interactively.
The frontend therefore joins an asynchronous Directory response and invents a
fake paused Session record for headless-only rows. Route entry first renders the
interactive-only Workspace payload, then inserts and sorts headless coworkers,
which triggers the sidebar movement animation every time.

The split also leaves `running` / `paused`, titles, sticky names, runtime facts,
and activity timestamps with multiple owners. Every new Session surface must
remember how to synthesize the missing half.

## Decisions

### 1. Extend `SessionRecord`; do not create a fourth record type

`SessionRecord` becomes the durable product roster/presentation record. It is
born for headless and interactive Sessions alike. Its internal `id` remains the
launcher-owned roster and process-attachment key; `resumeId` remains the
product handle.

The record gains `surface: 'headless' | 'terminal' | 'webpi'`. State means:

| state | meaning |
|---|---|
| `running` | this product Session owns the single admitted process/turn |
| `paused` | the Session exists but owns no live process/turn |

The surface records the active or most recently used presentation. PID and
other process details remain read-side projections and are not persisted.

### 2. Keep `ResumeIdentityRecord` as the translation/lifecycle ledger

It continues to own `resumeId` allocation, Workspace/Agent ownership, native
session mapping, runtime binding, birth metadata, lifecycle, and floor presence.
Those fields are not copied to a new store. The Session Directory may still
join identity, Session, and latest execution for rich inspection, but it is no
longer required to discover that a Session exists.

### 3. Keep `HeadlessTaskRecord` as one execution attempt

One product Session can have many scheduled runs, comments, inquiries, retries,
or delegated turns. Those remain task records. A task updates its Session's
activity state but never becomes the Session.

### 4. Centralize birth and transitions

Add one launcher-owned coordinator for paired ResumeIdentity + SessionRecord
creation and state transitions. Routes and schedulers must not reproduce the
pairing rules independently.

The two files cannot be committed in one filesystem transaction, so startup
reconciliation is part of the contract:

- an identity missing its Session record is repaired deterministically;
- a Session record missing its identity stops startup as corruption;
- duplicate records for one `resumeId` are rejected;
- boot still converts orphaned `running` records to `paused`.

### 5. Reuse the record when switching surfaces

Opening a paused headless Session in TUI/WebPi updates the existing record and
launches the unchanged native conversation. It does not create another record.
An already-running interactive Session remains idempotent; an active headless
turn returns `409 busy`.

## Alternatives considered

1. **Only suppress the reorder animation.** Hides the symptom while headless
   Sessions stay second-class and every consumer keeps two data paths. Rejected.
2. **Merge ResumeIdentity into SessionRecord.** Mixes public roster state with
   native mapping, lifecycle, bindings, and shipped provenance semantics.
   Rejected as unnecessary risk to `resumeId`.
3. **Introduce `ProductSessionRecord`.** Leaves both existing records and adds
   another reconciliation layer. Rejected.
4. **Use `resumeId` as `SessionRecord.id`.** Changes routes, pool keys, stored
   URLs, and materialization contracts without solving a user problem. Rejected.

## Target lifecycle

```text
fresh headless
  dispatch accepted
  -> allocate resumeId + identity + SessionRecord(running/headless)
  -> create HeadlessTaskRecord -> launch -> capture native id
  -> finish/fail/interruption -> SessionRecord(paused/headless)

fresh interactive
  quick start
  -> allocate resumeId + identity + SessionRecord(running/terminal|webpi)
  -> spawn -> exit/pause -> SessionRecord(paused)

resume headless
  claim resumeId -> existing record(running/headless)
  -> child task -> run -> record(paused)

resume TUI/WebPi
  existing record -> verify no headless claim
  -> record(running/terminal|webpi) -> native resume -> record(paused)
```

If admission fails before a durable task exists, the paired birth remains a
paused, possibly non-resumable Session; signatures are never recycled.

## Implementation increments

### 1. Persisted model and coordinator

- Extend backend/UI surface unions with `headless`.
- Enforce one Session record per `(wsId, resumeId)`.
- Add a coordinator that owns identity + Session birth, sticky naming, fallback
  title, source-run provenance, state transitions, and repair.
- Move interactive creation through it without changing route contracts.
- Keep runtime binding in Workspace files and native ids in Resume registry.

### 2. Headless lifecycle uses the same record

- Fresh dispatch creates the paired record before returning its task.
- Existing-resume dispatch claims and updates the same record.
- Completion, launch failure, timeout, cancellation, and async rejection all
  return it to paused and release the claim.
- Update activity/title timestamps without storing task output in the record.
- Treat claim/lease guards as process truth; do not trust a stale persisted bit
  as the concurrency lock.

### 3. Interactive attachment reuses the record

- A paused headless record is a launch target, not an early-return result.
- The spawn boundary accepts an existing record id/name/resumeId and updates it.
- Preserve idempotent return for a live terminal/WebPi process.
- Preserve `409` for a running headless turn or competing claim.
- Do not mutate Issue ownership, task lineage, native mapping, or `resumeId`.

### 4. Complete Workspace payload; simplify frontend

- `workspace.sessions` includes headless-first Sessions on the first response.
- Directory remains an enriched read model for presence, creator, latest task,
  and resumability; it decorates rows but never creates rows.
- Remove `sessionRecordForRow` and fake `resume:<resumeId>` records.
- Directory-only identities become repair/loading errors rather than UI rows.
- Persisted state/timestamps own initial ordering, so enrichment cannot insert
  or re-key rows and trigger route-entry reorder motion.
- Keep backend data reads in domain hooks and update their unit coverage.

### 5. Released-state migration and reconciliation

`0.89.3-beta` shipped the split shape, so add the next idempotent migration:

- scan active/departed Workspace and Manager Session files, excluding only
  Workspaces already in `purging` or `purged` catalog state;
- join `resume-identities.json` and latest headless tasks;
- preserve all existing record ids and every `resumeId`;
- create deterministic internal ids/names for missing records;
- migrate missing rows as paused/headless when execution provenance exists;
- derive only safe titles/timestamps, never native ids or secrets;
- fail on conflicting duplicates instead of guessing;
- add specs, register it, and regenerate `src/migrations/INDEX.md`.

Startup reconciliation remains crash repair, not a hidden migration substitute.

Presence and lifecycle never tear the pair apart: archived, deleted, and
retired Sessions keep their rows and are hidden or disabled by projections.
Only explicit Workspace purge destroys the durable row.

### 6. Documentation and cleanup

- Update provenance, lifecycle, project structure, and Issue scheduling guides.
- Document Session vs identity mapping vs task vs live process.
- Remove stale “interactive wrapper” and “Directory-only Session” language,
  fixtures, and synthetic-record tests.
- Keep this plan's progress synchronized with repository truth.

## Verification

### Focused backend

- Duplicate `resumeId` Session records are rejected.
- Fresh headless dispatch returns after durable identity + Session + task exist.
- Repeated turns keep one Session and many tasks.
- Every terminal outcome pauses the record and releases its claim.
- Native id capture makes that same record resumable.
- TUI/WebPi reuses record id/name/native conversation.
- Competing headless/TUI turns return deterministic busy errors.
- Boot repair handles interrupted running and missing paired records.
- Issue assignment modes, comments, Inbox follow-up, reconstruction, and task
  lineage keep their current `resumeId` semantics.

### Focused frontend

- Initial Workspace payload contains headless-first Sessions.
- Directory enrichment does not insert or re-key roster rows.
- No fake record reaches Resume CTA, runtime editor, Browse, or row actions.
- Headless running, paused resumable, latest failure, presence, and retirement
  remain distinct projections.

### Commands

```text
npx tsc --noEmit
cd ui && npx tsc -b
pnpm vitest run <targeted Session/resume/headless/workspace/UI specs>
pnpm build:migration-index
pnpm test
```

### Real surfaces

1. Start `pnpm dev` with an isolated AliceProject if the default root is owned.
2. Run an Issue that recruits a new Session. Its sidebar row must exist on the
   first payload, show running once, and pause without route-entry reordering.
3. Run a second turn on the exact `resumeId`: one row/record, two tasks.
4. Open it in TUI/WebPi: same signature/transcript, no new record.
5. Reload Chat, enter from another page, and exercise Browse/presence.
6. Run the matching Electron/PTY smoke with an isolated AliceProject and the
   unsigned development package path.

## Acceptance

- [x] Every `resumeId` has exactly one durable Session record
- [x] Fresh headless Sessions appear in the first Workspace payload
- [x] Headless and interactive turns share one record and signature
- [x] TUI/WebPi process attachment reuses the existing record
- [x] Frontend no longer synthesizes Session records
- [x] Route entry no longer causes a second roster insertion/reorder animation
- [x] Presence, lifecycle, Issue ownership, provenance, and native resume stay unchanged
- [x] 0.89.3-beta migrates idempotently without changing any `resumeId`
- [x] Types, tests, browser, and Electron checks pass
- [x] Owner guides describe the implemented model
- [ ] Serial PR is merged to `dev` and branch cleaned up

## Progress

- [x] Added the paired product-Session coordinator and strict one-record-per-
  `resumeId` registry invariants.
- [x] Routed fresh/resumed headless dispatch and interactive attachment through
  the same durable record and shared admission guard.
- [x] Made the first Workspace payload the sole roster source; Directory data
  now decorates rows without synthesizing or re-keying them.
- [x] Added and indexed the released-state migration with deterministic ids,
  idempotence coverage, and no `resumeId` rewrites.
- [x] Updated the owner guides and focused backend/frontend/demo tests.
- [x] Passed root/UI/Desktop typechecks, the complete Vitest suite, isolated
  real-browser acceptance, restart persistence, and the unsigned packaged
  Electron Workspace smoke.
- [ ] Merge the serial PR to `dev`, clean the branch, then delete this completed
  plan and its `PLANS.md` index entry.

- [x] Architecture and release-boundary audit
- [x] Alternatives compared and target invariant selected
- [x] Persisted model + coordinator
- [x] Headless lifecycle integration
- [x] Interactive reuse
- [x] API/UI simplification
- [x] Migration + documentation
- [ ] Verification + delivery
