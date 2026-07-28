# Agent Conversation Semantics and Log

Status: Completed

Delivered by PR #741.

Related issues: none

Owner guides: [[docs/conversation-provenance.md]],
[[docs/workspace-issues-and-scheduling.md]],
[[docs/workspace-agent-guidance.md]]

## Outcome

One Coding Agent can talk naturally to a coworker in another Workspace without
receiving artifact-reconstruction instructions unless the caller explicitly
requests them. Callers can choose a synchronous consultation or asynchronous
delegation, and every dispatched cross-Agent exchange leaves a private,
append-only launcher log suitable for later prompt-flow analysis and
visualization.

## Scope

- Add an explicit reconstruction option to the generic and business-level
  conversation tools.
- Preserve provenance resolution independently from whether reconstruction
  instructions are injected into the delivered prompt.
- Record cross-Agent dispatch and completion events outside Workspace Git.
- Document short consultation, asynchronous delegation, later collection, and
  Inbox delivery as distinct collaboration rhythms.
- Add the persisted-state migration and focused contract tests.

Not in scope:

- A live Agent-to-Agent notification bus.
- A conversation-log UI or public query API.
- A domain-specific AutoQuant task protocol.
- Replacing headless task, Session, Issue, or Inbox persistence.

## Decisions

1. `reconstructed` remains an honest provenance resolution. Prompt wrapping is
   a separate explicit `reconstruct` choice.
2. Plain Workspace asks deliver the caller's prompt unchanged. The
   reconstruction preamble is added only when resolution requires a fresh
   worker and the caller requested reconstruction.
3. The independent log is an append-only JSONL event stream under launcher
   state. It records both the original and delivered prompts so injection can
   be analyzed without making the log a dispatch authority.
4. Headless task state remains execution truth. The conversation log is an
   analysis/audit projection and must never block a worker if logging fails.
5. Long-running work should normally be accepted by the peer, managed locally
   through its own files/Issues/schedules, and surfaced through Inbox. OpenAlice
   does not yet push an unsolicited completion message into another Agent's
   active transcript.

## Work

### 1. Conversation semantics

- [x] Add the explicit reconstruction input through CLI/tool/control layers.
- [x] Keep ordinary fresh and exact peer prompts unwrapped.
- [x] Preserve reconstruction provenance and artifact attribution.

### 2. Independent exchange log

- [x] Add the append-only log store and migration.
- [x] Record authoritative caller/target Session identity when available.
- [x] Record dispatch prompt flow and terminal reply/status events.

### 3. Guidance and verification

- [x] Update agent-facing guidance and owner docs for collaboration rhythms.
- [x] Add focused tool, control, store, service, and migration tests.
- [x] Run required typechecks, suite, and proportional runtime verification.
- [x] Publish and merge a serial PR to `dev`.

## Completion Criteria

- `conversation ask --ws-id ...` sends a plain prompt by default.
- `--reconstruct` adds the reconstruction preamble only when a reconstructed
  worker is used.
- Every conversation dispatch and completion is represented in the private
  conversation event log without exposing native runtime ids.
- Guidance distinguishes waiting for a short answer, collecting a dispatched
  reply later, and asking the peer to deliver completed work through Inbox.
