# Connector desk specimen + per-adapter Issue

**Status:** active — increment 2

**Owner guides:** [[docs/connector-service.md]], [[docs/workspace-issues-and-scheduling.md]], [[docs/conversation-provenance.md]]

**Delivery:** serial PRs to `dev` (`area:collaboration`, `area:settings`). `review:deep` for the persisted flag.

## Goal

One shared desk **execution specimen**. Each `desk`-capable connector owns its
own Issue (Telegram 聊天专员, later 飞书, later Discord). Do not share one
comment stream across IM platforms. Do not copy `telegram-desk-*.ts` per adapter.

## Decisions

- Flag: `connectorDesk: <adapter id>`. Shipped `telegramConnector: true` dual-reads
  and migrates to `telegram`.
- Uniqueness: one live desk **per connector**, not one desk for the Project.
- Inbound grouped by `connectorId`. A generating Telegram desk does not block
  Feishu flush.
- Projection `adapterId = issue.connectorDesk`. `via` present → no echo.
- Settings panel stays on the connector card when `capabilities` includes `desk`.
- File stem `${connectorId}-phone-desk`. Telegram keeps `telegram-phone-desk`.

## Increments

### 1. Extract the specimen (this PR)

- [x] Capability `desk`; Telegram advertises it
- [x] `connectorDesk` schema + dual-read + migration `0041`
- [x] Shared create/find/ingest/project keyed by connectorId
- [x] HTTP `/api/connectors/:id/desk`
- [x] Typecheck + targeted tests green

### 2. Feishu adapter

- [x] Long connection, p2p ingest, `/link` owner-chat, Inbox push
- [x] Own `feishu-phone-desk` Issue via the shared specimen
- [x] `/inbox` `/settings` `/uta` placeholders first

### 3. Feishu cards for `/inbox` and `/uta`

Deferred. `/inbox` `/settings` `/uta` stay placeholders; desk IM and Inbox push are live.
