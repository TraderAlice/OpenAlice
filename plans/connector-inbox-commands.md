# Plan: Connector Inbox pull and settings forms

**Status:** active — increment 2
**Owner guides:** [[docs/connector-service.md]]  
**Delivery:** serial PR to `dev` (`area:collaboration`, `area:settings`). Open PR, do not merge.

## Goal

Owners can stop noisy Inbox push and look when they want. `/inbox` and
`/settings` are declared capabilities. Each connector implements its own
interaction.

## Decisions

- Catalog `capabilities: ['inbox', 'settings']` plus slash-command metadata.
  No shared reply/button renderer.
- Per-adapter `inboxPush` (default on). Phone-desk `sendOwnerText` stays on.
- Telegram: inline keyboard forms. `/inbox` pages unread items on one
  message. `/settings` is a single toggle button.
- Discord: same commands, placeholder replies.
- Slack: workspace-installed Socket Mode app, owner DM only, same
  commands with placeholder `/inbox` and `/settings`. Not Slack's hosted
  Deno platform.
- Connector reads InboxStore files from `OPENALICE_HOME` (works in Electron
  without Alice HTTP). Connector never reads Workspace files.
- On-demand files use a bounded Connector action queue and Alice action
  bridge rather than the phone-desk inbound drain. Directed artifact
  delivery is a separate control-plane call so ordinary Inbox `deliver`
  cannot re-send a summary. Alice reuses `projectInboxDoc` / the existing
  attachment safety path and trusts only `entryId` + `docIndex`.

## Increments

### 1. Declare, mute, Telegram forms, Discord placeholder

- [x] Protocol capabilities + `inboxPush` preference field
- [x] DeliveryManager skips Inbox push when off
- [x] Telegram `/inbox` and `/settings` button forms
- [x] Discord placeholder replies
- [x] Settings card checkbox
- [x] Typecheck + tests + review-only PR

### 2. Bounded `/inbox` summary and on-demand file pull

- [x] Telegram `/inbox` summary: 5 items, field budgets, whole-page hard cap
      below `TELEGRAM_PLAIN_TEXT_MAX`, no expanded doc paths
- [x] Bounded “view files” / confirm / cancel flow; owner re-checked
- [x] Connector action queue + Alice action bridge + directed artifact delivery
- [x] Reuse Alice attachment safety for a single server-validated doc index
- [x] Discord/Slack keep placeholder `/inbox` and unsupported artifact delivery
- [x] Targeted tests + typecheck

## Not in this plan

Discord/Slack interactive file pull. Marking Inbox read from a connector.
Changing `inbox_push` for ordinary Issues.
