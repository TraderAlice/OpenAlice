# Agent Conversation Log UI

Status: Completed

Delivered by PR #742.

Related issues: none

Owner guides: [[docs/conversation-provenance.md]],
[[docs/ui-interaction-and-motion.md]]

## Outcome

The existing Dev → Logs surface can show Agent collaboration as complete
message exchanges rather than raw JSONL events. Operators can inspect caller,
target, provenance resolution, prompt injection, completion status, reply, and
timing without gaining a second dispatch API or direct filesystem access.

## Scope

- Add a read-only query projection that joins dispatch/completion events by
  task id and returns newest-first pages.
- Mount an authenticated HTTP read route after Workspace service startup.
- Add an Agent conversations view alongside the existing tool-call log.
- Poll the newest page while active and support paging through older history.
- Cover malformed/incomplete log records, API bounds, empty/loading/error
  states, and expanded prompt/reply detail.
- Update the demo contract and owner guide.

Not in scope:

- Editing or deleting conversation history.
- Replaying, resuming, or dispatching conversations from the log.
- Agent-to-Agent completion notifications.
- Full-text indexing or a database migration.

## Decisions

1. The JSONL file remains private launcher state. The UI receives a typed,
   authenticated projection and never a path or arbitrary file-read primitive.
2. One UI row represents one dispatched task. A missing completion event is
   shown as running.
3. Original and delivered prompts are both visible. The delivered prompt gets
   a separate panel only when reconstruction guidance changed it.
4. The existing Dev → Logs page owns the feature. Tool calls and Agent
   conversations are peer views selected by a segmented control.
5. Page one polls for live changes. Older pages remain stable and do not jump
   when new events arrive.

## Work

### 1. Read contract

- [x] Add the joined query projection to the conversation log.
- [x] Add bounded pagination and the authenticated Web UI route.
- [x] Add focused store and route tests.

### 2. UI

- [x] Add the API client and demo handler.
- [x] Add Tool calls / Agent conversations selection.
- [x] Render source → target, status, mode, prompts, reply, and identifiers.
- [x] Cover loading, empty, error, expansion, polling, and pagination.

### 3. Verification and delivery

- [x] Update the owner guide.
- [x] Run required typechecks and tests.
- [x] Exercise the real dev/demo route and Electron/package path.
- [x] Publish and merge a serial PR to `dev`.

## Completion Criteria

- Dev → Logs → Agent conversations shows joined exchanges newest-first.
- A live dispatch appears as running and gains its reply after completion.
- Explicit reconstruction exposes both original and delivered prompt text.
- Malformed or partial JSONL lines cannot break the page.
- The surface remains read-only and protected by OpenAlice's normal auth gate.
