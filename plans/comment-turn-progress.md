# Plan: Headless turn progress on the comment path

**Status:** active — increments 1 and 3  
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
- **Out of increment 1:** Issue Activity chrome, Inbox thread chrome, and
  Telegram `send`/`edit` policy. Those consume the field; they do not define
  it.
- **Telegram ships sealed text only.** A `text` block goes to the phone desk
  only after a tool or error follows it. Consecutive texts are one narration:
  only the last one before the non-text block is sent, so streamed chunks do
  not each become a DM. Tool/error blocks stay off Telegram. The trailing
  text is still today's final comment. A text already sent as progress is
  not sent again when that comment is stamped.

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

### 1. Central transport + API projection

- [x] `projectTurnProgress` + fingerprint + debounced publisher
- [x] Runner `onProgress` from the structured snapshot writer
- [x] Persist `HeadlessTaskRecord.progress`; fan out to pending Issue
      `delivery.progress` when the task is a comment reply
- [x] Inquiry API includes `progress`; Issue comments already travel with
      `delivery`
- [x] Owner-guide note; typecheck + focused tests
- [x] Review-only PR to `dev`

### 2. Issue and Inbox consume

Read `delivery.progress` / inquiry `progress` instead of a spinner-only wait.
Do not invent a second fetch of `/output`.

### 3. Connector / Telegram consume

- [x] Phone-desk consumer reads the compact progress feed
- [x] Ship sealed mid-turn `text` blocks only (last consecutive text before
      a tool or error); skip tool/error blocks and `[[no-reply]]`
- [x] Dedup: a text already sent as progress is not resent as the final
      comment (`replyTo` / scheduled `taskId` scope)
- [x] Wire comment replies and scheduled desk fires from the existing
      progress publisher; owner-guide note

## Completion

Delete this file and its [[PLANS.md]] bullet when increment 2 is accepted, or
when a later change supersedes the remaining consumer work.
