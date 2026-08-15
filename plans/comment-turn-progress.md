# Plan: Headless turn progress on the comment path

**Status:** active — increment 1  
**Owner guides:** [[docs/workspace-issues-and-scheduling.md]], [[docs/conversation-provenance.md]], [[docs/connector-service.md]]  
**Delivery:** serial PR to `dev` (`area:collaboration`, `area:workspace`, `review:deep`). Open PR, do not merge.

## Goal

Headless already hears interleaved `text` / tool / error blocks while a turn
runs. Comment-shaped conversations (Issue replies, Inbox inquiries, Telegram
desk) only learn the final `assistantText`. Centralize that live timeline as
**turn progress** on the comment/inquiry transport. How each surface renders
or projects it stays a consumer decision.

## Decisions

- **One projector, many readers.** `projectTurnProgress` is the only compact
  shape. Issue comments, Inbox inquiries, and later Connector all read it.
  Consumers do not each parse vendor JSONL or `/output`.
- **Progress is not a reply.** Source comments stay `pending` until
  `complete()`. The reply comment is still the final `assistantText`. Progress
  never becomes What, and tool input/output never enter the compact shape.
- **Source of truth is the headless task.** `HeadlessTaskRecord.progress` is
  updated while the child runs. Comment sidecars and inquiry APIs are
  projections of that record.
- **Write cheaply.** First semantic snapshot publishes immediately; later
  updates debounce (~1s) and skip identical fingerprints. Comment sidecar
  writes only for Issue-comment inquiries (`subject.commentId`).
- **Out of this increment:** Issue Activity chrome, Inbox thread chrome, and
  Telegram `send`/`edit` policy. Those consume the field; they do not define
  it.

## Compact shape

```ts
type HeadlessProgressBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; status: 'running' | 'completed' | 'failed' }
  | { type: 'error'; message: string }

interface HeadlessTurnProgress {
  updatedAt: number
  assistantText: string | null
  blocks: HeadlessProgressBlock[]
  metrics: { textBlocks: number; toolCalls: number; toolFailures: number }
}
```

Blocks keep interleaved semantic text. Tool payloads are dropped. A block cap
keeps `headless-tasks.json` and comment sidecars bounded.

## Increments

### 1. Central transport + API projection (this PR)

- [x] `projectTurnProgress` + fingerprint + debounced publisher
- [x] Runner `onProgress` from the structured snapshot writer
- [x] Persist `HeadlessTaskRecord.progress`; fan out to pending Issue
      `delivery.progress` when the task is a comment reply
- [x] Inquiry API includes `progress`; Issue comments already travel with
      `delivery`
- [x] Owner-guide note; typecheck + focused tests
- [ ] Review-only PR to `dev`

### 2. Issue and Inbox consume

Read `delivery.progress` / inquiry `progress` instead of a spinner-only wait.
Do not invent a second fetch of `/output`.

### 3. Connector / Telegram consume

Phone-desk projection decides typing, a status edit, or shipping new `text`
blocks. Final reply stays today's comment. Do not spam tool I/O to Telegram.

## Completion

Delete this file and its [[PLANS.md]] bullet when increment 3 is accepted, or
when a later change supersedes the remaining consumer work.
