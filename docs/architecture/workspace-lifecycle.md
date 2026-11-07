# Workspace and Session Lifecycle

This guide owns Workspace and Session identity, provenance, execution authority,
Web conversation surfaces, offboarding/restore/purge, template upgrades,
Workspace Absorb, and the launcher-level Workspace Manager. Context/Skill/model
injection belongs to [[docs/alice-harness.md]], and Issues/scheduling/Inbox
delivery belong to [[docs/workspace-issues-and-scheduling.md]].

---

## 1. Identity and Provenance (`resumeId`)

`resumeId` is OpenAlice's canonical, durable product Session identity across
interactive and headless turns; `@resumeId` is its visible signature. Every live
Agent receives `OPENALICE_RESUME_ID` and `OPENALICE_SIGNATURE`, while
server-side request origin remains authoritative for Inbox, Issue, and trade
attribution.

| Identity | Scope | Product exposure |
|---|---|---|
| `workspaceId` | Durable context and capability boundary | Public |
| `resumeId` | One stateful product Session across interactive and headless turns | Public follow-up handle |
| `SessionRecord.id` | Durable launcher roster and process-attachment key | Attachment surfaces only |
| `taskId` / `runId` | One headless execution turn | Public execution evidence |
| `agent` | Runtime kind (`claude`, `codex`, `pi`, `opencode`, `agy`, …) | Display/selection metadata |
| `agentSessionId` | Native CLI conversation locator | Backend only (`ResumeRegistry`) |

- `ResumeRegistry` binds one `resumeId` immutably to one Workspace and runtime.
  `SessionRecord` is born with `resumeId` and survives surface/lifecycle changes
  without duplicating roster rows.
- Optional mutable `displayName` lives beside the secret-free `ai` binding in
  `.alice/sessions/<resumeId>.json`.
- **Provenance edges**: Attributable occurrences (reports `{ workspaceId, path, revision? }`,
  Inbox `{ inboxEntryId }`, Issues `{ workspaceId, issueId }`, and trade
  decisions `{ accountId, decisionId }` keyed by UTA Git commit hash) carry a
  server-stamped `SessionOrigin`. Agents cannot spoof origin via tool arguments.
- **Follow-up resolution** (`src/workspaces/conversation-control.ts`):
  1. Known usable `resumeId` continues that exact Session (`exact`).
  2. Known unavailable Session returns `unavailable` with preserved origin/reason.
  3. Unknown origin in a known Workspace recruits a new Session labeled
     `reconstructed` (never presented as original author).
  4. Unknown Workspace returns `unavailable`.
- **Dispatch communication** (`buildDispatchCommunication`): Separates caller
  origin, execution target, subject, and reply ownership (`caller`,
  `issue-comment`, `issue-run`, `none`) in an immutable task snapshot.
  `workspaces/state/agent-conversations.jsonl` is an append-only private
  dispatch/reply projection, never a dispatch authority.

---

## 2. Session Execution Authority and Takeover

`WorkspaceService.executions` (`SessionExecutionManager`) is the sole entry point
for starting or stopping Session processes across HTTP, IPC, tools, Issues,
schedules, Connector, offboarding, and shutdown.

- Phases are `starting → running → stopping → ended` (or `failed`). The manager
  persists admission before spawn, excludes concurrent writers of one `resumeId`,
  waits for real process exit on stop/handoff, and rejects stale callbacks.
  Failed execution-journal writes block new admission.
- **Interactive takeover**: Background dispatch to an occupied Session enters
  FIFO takeover admission. Approval and inactivity timeout require observed GUI
  idle (`working`, `compacting`, `retrying`, and `awaiting-input` cannot be
  interrupted by idle takeover; terminal handoff requires explicit approval).
- **Emergency interrupt & admission blocks**: `interrupt(resumeId, executionId, actor)`
  requires the exact `executionId` and escalates process-tree termination. HTTP
  interrupt and release routes are always user-attributed (client-supplied actor
  fields are rejected). `user-cooldown` follows explicit user interruption;
  `execution-fault` follows consecutive failures and requires explicit user
  release. Takeover approval never overrides an active admission block, and
  release endpoints clear only the block without launching work.

---

## 3. Web Conversation Surface (`WebSessionHost`)

The Web surface attaches to an existing Workspace Session through its runtime's
structured stdio protocol (`pi-rpc`, `acp`, `claude-stream-json`,
`codex-app-server`) instead of a PTY.

- **Layer separation**: Adapters declare `capabilities.web` (`agentSupportsWeb`
  is the sole launch gate) and compose argv; Transports speak one wire over
  stdio and drive neutral state; `WebSessionHost` supervises the child process
  and snapshot revision without branching on runtime IDs; Browser polls neutral
  snapshots (`GET /web?revision=`) and responds to permission/question requests
  by exact runtime-supplied `optionId` (`POST /web/respond`).
- **Exact continuation**: Web never resumes "last." It reopens the exact native
  ID mapped to `resumeId` or starts a fresh conversation for a new Session. If a
  transport cannot load an existing transcript, opening fails with guidance
  rather than substituting a fresh conversation.
- **Ephemeral snapshots**: Neutral snapshots (`src/workspaces/web-session/model.ts`)
  are never persisted as a second transcript store. `SessionRecord.surface`
  retains the persisted literal `webpi` for compatibility across all Web runtimes.

---

## 4. Active Floor, Offboarding, Restore, and Purge

`<launcherRoot>/workspaces/` contains active Workspace checkouts only.
`workspaces.json` tracks active desks; `WorkspaceCatalog` tracks all desks ever
created (`active → offboarding → departed → restoring → active` or
`departed → purging → purged`). Catalog rows are never deleted and Workspace IDs
are never reused.

- **Offboarding**: Blocked by live headless runs. Interactive processes pause;
  Alice writes `.alice/HANDOFF.md` and `.alice/offboarding.json`, removes the
  active registry row, atomically moves the checkout to
  `departed-workspaces/<workspaceId>`, and retires owned `resumeId`s.
- **Restore & Purge**: Restore returns the checkout to its exact original cwd,
  recalls `resumeId`s, and marks the Catalog active. Purge is departed-only and
  irreversible: it deletes the checkout, interactive Session records, and
  scrollback while preserving Catalog tombstones, retired `resumeId`s, Inbox
  records, and provenance so `@resumeId` signatures resolve to `retired/purged`
  rather than unknown.

---

## 5. Workspace Template Upgrade and Absorb

Both operations serialize on the shared checkout-operation lease
(`src/workspaces/workspace-operation-guard.ts`), require idle Sessions and a
clean staged Git index, validate an exact preview digest, write recovery
journals before mutation, and recover idempotently on startup before scheduled
work runs.

### Template Upgrade (`upgradeStrategy: "managed-context"`)

Reconciles only template README/instructions and template-owned `.agents/skills/**`
/ `.claude/skills/**` (plus legacy `.pi/skills/**` cleanup) using a fingerprint
three-way plan (`Base` under `.alice/template-upgrade/`, `Local`, `Incoming`).
Non-overlapping dual edits merge via `git merge-file --diff3`; conflicts require
explicit per-path resolution and never write conflict markers automatically.
Apply commits only the selected managed paths and advances `Base` to `Incoming`.

### Workspace Absorb (`src/workspaces/workspace-absorb.ts`)

Directional consolidation: one target Workspace stays active and one source
Workspace offboards intact to `departed-workspaces/<sourceId>`.

- Moves only tracked and untracked-non-ignored user files from the source working
  tree. Collisions require an explicit `keep-target`, `use-source`, or
  `keep-both` (`imports/<source-tag>-<source-id>/...`) choice.
- Never moves `.git`, `.alice`, managed prompt/Skill trees, credentials, root
  template files, `.env*`, or caches.
- Source `resumeId`s retire with the source; historical provenance is never
  rewritten, and the Catalog records `absorbedIntoWorkspaceId`, `absorbedAt`,
  and the target import commit.

---

## 6. Workspace Manager (`workspace-manager`)

The launcher-level coordination desk uses the reserved ID `workspace-manager` and
runs with `<launcherRoot>/workspaces/` (the active floor) as its `cwd`. It is
deliberately excluded from `workspaces.json` and stores its secret-free Session
bindings under `<launcherRoot>/state/workspace-manager-sessions/<resumeId>.json`
so it never writes `.alice/` at the floor root.

- Uses `alice peer list`, `alice issue list --mode detailed`, `peer path`,
  `peer sessions`, and `conversation ask` to inspect and coordinate active desks.
- Must never write research, reports, or Issues at the floor root; durable work
  and approved direct edits belong inside a selected target Workspace.

---

## 7. Load-Bearing Paths and Verification

- `src/workspaces/{service,workspace-lifecycle,workspace-catalog}.ts` — lifecycle,
  offboard/restore/purge, and startup recovery.
- `src/workspaces/session-execution-manager.ts` — process authority, takeover,
  interruption, and admission blocks.
- `src/workspaces/{resume-registry,session-registry,product-session-coordinator,conversation-control}.ts`
  — Session identity, roster, and follow-up provenance.
- `src/workspaces/web-session-host.ts` & `src/workspaces/web-session/` —
  structured Web conversation host and wire transports.
- `src/workspaces/{template-upgrade,workspace-absorb,workspace-operation-guard,manager-workspace}.ts`
  — template upgrade, Absorb, checkout leases, and Workspace Manager.

Verify changes with owning root/UI typechecks, focused lifecycle/provenance/wire/
upgrade specs (`tests/integration/workspace-upgrades/template-upgrade.spec.ts`,
`web-session-host.spec.ts`), and real surface journeys (headless-to-interactive
continuation, Web ↔ TUI transcript preservation, and source → target Absorb).
