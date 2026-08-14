# Plan: Telegram phone-desk Issue

**Status:** active — increment 3 
**Owner guides:** [[docs/workspace-issues-and-scheduling.md]], [[docs/connector-service.md]], [[docs/conversation-provenance.md]]  
**Delivery:** serial PRs to `dev` (`area:collaboration`, `area:settings`). Increment 2 is `review:deep`. Open PR, do not merge.

## Goal

One Issue in an Alice Project is the Telegram phone desk. It is still a normal scheduled work item: `when` fires **What as the Input Prompt**. Comments are the Linear-style chat. Connector only transports. There is no second agent loop and no skill clause.

## Product model

| Piece | Role |
|---|---|
| Session (`resumeId`) | Employee |
| This Issue | The one phone-desk job |
| What | Heartbeat Input Prompt (editable). Scheduler sends it unchanged. |
| Comments | The chat transcript. Inbound Telegram = human comment. Agent reply = comment. |
| `when` | Heartbeat clock. Silent work uses `[[no-reply]]` in the comment. |
| Connector | Owner private chat only. Projects comments that do **not** contain the literal tag `[[no-reply]]`. |

Frontmatter flag, camelCase to match `credentialSource`:

```yaml
telegramConnector: true
```

- Omitted → ordinary Issue (today's behavior). Zod currently **strips** unknown keys, so this field must be added to the schema or it will never exist.
- `true` → the Project's phone desk.
- `false`, empty, or any other value → invalid file (do not treat as absent).
- At most **one** `true` Issue in the whole Alice Project (all Workspaces). Write refuses a second; a second file found at read time is `invalid` and does not fire.
- Only the Settings “enable Telegram chat” path writes the flag. Generic `issue create` / CLI / MCP / skill must not accept it as a normal field.

Seed What at create time (product copy on the Issue, not a skill): heartbeat — read recent comments, speak if needed, otherwise comment with `[[no-reply]]`. The operator may edit What afterward; that edits the heartbeat prompt.

### Increment 1 Settings interaction

Chosen model (serial alignment, not a second chat surface):

- Phone desk lives **inside** the Telegram Settings card, after connection details.
- Enable is gated on a linked owner. Operator picks a Workspace; the Workspace is
  immutable after bind. Move = disable then enable elsewhere.
- Settings owns What (existing Markdown What editor) and a 1h/2h/4h/8h/12h/24h
  heartbeat picker. Disable confirms, cancels the Issue, and drops the flag.
  Re-enable in the same Workspace revives the reserved `telegram-phone-desk` file.
- **Open phone desk** opens the ordinary Issue detail route. Board/Tracked omit
  the row; detail GET stays so increment 2 can use existing comments.
- Settings does not become a chat client. Discord chat stays out of this plan.

## Occupancy

Existing per-`resumeId` busy stays. A general Issue busy-queue is still out
of this plan. Telegram inbound is different: later owner DMs stay in the
Connector queue while a desk generation is running, then flush as one quoted
comment.

## Increments

### 1. Flag, uniqueness, hide from the board, bind in Settings

- [x] Schema `telegramConnector: z.literal(true).optional()`; `false` is invalid
- [x] Project-wide uniqueness (write refuse + extra files `invalid`; extras do not fire)
- [x] Generic create/update/CLI/MCP cannot set the flag; dedicated Settings helper can
- [x] Board + issues list omit the phone-desk row
- [x] Settings → Telegram: enable chat → pick Workspace → create Issue; What + schedule editor
- [x] Backend enforces linked-owner readiness, supported cadence choices, and serialized one-desk writes
- [x] Owner guides updated; typecheck + tests; review-only PR

### 2. Comments in, comments out, `[[no-reply]]` (`review:deep`)

- [x] Inbound owner DM → comment → existing reply dispatch → project unless `[[no-reply]]`
- [x] Scheduled fire of this Issue stamps `assistantText` as a comment, then same filter
- [x] Literal tag only; send nothing when present

### 3. Telegram rich-message rendering

- [x] Connector Grammy ≥ 1.44 so `sendRichMessage` exists
- [x] Phone-desk owner chat and Inbox text use `sendMessage` MarkdownV2
- [x] GFM is converted; unmatched specials are escaped
- [x] MarkdownV2 parse 400 falls back to `sendRichMessage`, then plain text
- [x] Owner-chat cap follows the rich-message 32768 limit
- [x] HTML report attachments stay files; no legacy `parse_mode: Markdown`

### Not in this plan

General Issue queue when `busy`. Groups / Discord chat. Showing the stored bot token. Changing `inbox_push` for ordinary Issues.

## Completion

Delete this file and its [[PLANS.md]] bullet in the same change that records acceptance.
