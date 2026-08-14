# Plan: Connector Inbox pull and settings forms

**Status:** active — increment 1  
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
- Connector reads InboxStore files from `OPENALICE_HOME` (works in Electron
  without Alice HTTP).

## Increments

### 1. Declare, mute, Telegram forms, Discord placeholder

- [x] Protocol capabilities + `inboxPush` preference field
- [x] DeliveryManager skips Inbox push when off
- [x] Telegram `/inbox` and `/settings` button forms
- [x] Discord placeholder replies
- [x] Settings card checkbox
- [x] Typecheck + tests + review-only PR

## Not in this plan

Discord interactive components. Marking Inbox read from a connector.
Changing `inbox_push` for ordinary Issues.
