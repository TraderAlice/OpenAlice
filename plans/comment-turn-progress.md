# Plan: Headless turn progress on the comment path

**Status:** active — increment 2
**Owner guides:** [[docs/workspace-issues-and-scheduling.md]], [[docs/conversation-provenance.md]], [[docs/connector-service.md]]
**Delivery:** serial PR to `dev` (`area:collaboration`, `area:workspace`, `review:deep`).

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
- **Write cheaply and serially.** First semantic snapshot publishes without a
  debounce; later updates debounce (~1s) and skip identical fingerprints. The
  publisher invokes async consumers in one chain, and each Issue sidecar
  serializes its complete read-modify-write cycle.
- **Live progress stays bounded and ephemeral.** Every projected string and the
  complete JSON snapshot have explicit UTF-8 byte limits. Terminal task records
  discard progress because durable output already lives in the structured log;
  terminal Issue delivery likewise replaces the pending snapshot.
- **Out of increment 1:** Issue Activity chrome and Inbox thread chrome.
  Those consume the field; they do not define it.
- **Issue / Inbox render the compact timeline.** Shared `TurnProgress` shows
  interleaved text, tool name/status, and errors on the existing comment and
  inquiry records. Trailing text is live (unlike Telegram, which waits to
  seal). No second fetch of `/output`, and no tool payloads. Generic waiting
  copy remains only until the first snapshot arrives.
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

Blocks keep interleaved semantic text. Tool payloads are dropped. Block and
UTF-8 payload caps keep `headless-tasks.json` and comment sidecars bounded.

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

- [x] Shared `TurnProgress` reads `delivery.progress` / inquiry `progress`
- [x] Issue Activity pending comments show the live timeline under the
      waiting-for-owner line
- [x] Inbox reply thread replaces “Working on a reply…” once blocks arrive
- [x] Demo handlers carry a running snapshot; owner-guide note

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
