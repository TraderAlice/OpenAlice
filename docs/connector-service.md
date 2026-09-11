# Connector Service

This guide owns OpenAlice external-notification connectors: process boundaries,
configuration, delivery guarantees, adapter extension, health, and packaging.
It complements [[docs/workspace-issues-and-scheduling.md]] and
[[docs/managed-workspace-runtime.md]].

Inbox body and shared reference semantics live in [[docs/inbox-content.md]].

## Product Contract

Connector Service projects durable OpenAlice Inbox entries into optional
external chats. It is not another agent runtime, chat input loop, or source of
truth. Telegram, Discord, Slack, and Feishu are the first adapters, not hard-coded product
categories.

- Local Inbox append completes before any external request begins.
- Agent-originated pushes enter through the Workspace CLI and inherit the
  CLI's server-validated Session origin; Connector delivery has no MCP identity
  dependency.
- A failed connector never changes `inbox_push` success and never marks an
  Inbox item read.
- The service is optional in every trading mode, including lite.
- Guardian may start, stop, or restart it without restarting Alice or UTA.
- Inbox delivery remains outbound by default. Each adapter may advertise
  `inbox`, `settings`, and `uta` capabilities and implement those slash commands
  itself. Telegram uses an inline-button form: `/inbox` defaults to unread
  items, can switch to the full Inbox history, `/settings` toggles Inbox
  push, and `/uta` reviews pending Trading-as-Git commits with Approve /
  Reject. Discord and Slack register the same
  commands and currently reply with a placeholder. `inboxPush: false` skips Inbox
  `deliver` for that adapter and does not affect phone-desk owner chat.
  `/link`, `/status`, and `/test` stay the generic control plane. Discord
  DMs are still not ingested.
- OpenAlice Inbox still shows the full entry. The Connector `/inbox` pull
  view is a bounded summary: title, Workspace, time, a short body prefix,
  and an attachment count. It never expands raw Workspace paths. Telegram
  keeps five items per page and hard-caps the whole page below the 4096
  plain-text limit. Each row opens a bounded detail view; entries with files
  then offer a short “view files” control.
  Callback data carries only page-local indexes or a server-validated
  Inbox entry id plus doc index, never a trusted raw path.
- On-demand file pull is not phone-desk inbound and is not an ordinary
  Inbox `deliver`. The originating Connector enqueues a bounded, TTL-limited
  artifact request (`requestId`, `connectorId`, `entryId`, `docIndex`).
  Alice’s resident action bridge claims that queue, re-reads the Inbox
  entry, resolves the Workspace, materializes the selected current file
  through the existing attachment safety path, and posts a directed
  artifact delivery back to that Connector only. Cancel does not enqueue.
  First-version pull does not change Inbox read state. Discord and Slack
  keep `/inbox` as a placeholder; all four adapters support directed artifact
  delivery, independently of whether they expose file-pull controls. `/uta` is the same shape: Telegram renders the review
  panel; Discord and Slack reply with a placeholder. Connector never
  talks to UTA. Push and reject stay Alice-owned wallet writes, gated
  by the current trading mode. Callback data carries only page-local
  indexes; account ids and pending hashes stay in the Connector session
  and the Alice-validated action request.
- Connector Service owns outgoing reply syntax. Resolved file references are
  delivered at their original position: text before, media, then text after. Alice owns one phone-desk Issue
  per `desk`-capable connector and forwards raw reply text with a Workspace id
  and server-derived `conversation | automation` source. Workspace/Issue
  projection does not parse delivery markers. Inbound owner comments are not
  echoed back. Automated `[[no-reply]]` outside code suppresses delivery;
  ordinary conversations can discuss the marker literally. A silent final
  still terminates transport activity.
  Connector durably queues owner text by connector id. Alice claims it while
  a live desk exists and no generation is running; stacked DMs become one
  quoted Issue comment. This ingress contract is separate from reply parsing.
  While a desk turn is running, Alice also
  projects an explicit `accepted | progress | final | failed` lifecycle.
  Telegram turns `accepted` into a native Bot API live draft immediately,
  refreshes that draft every 20 seconds, and replaces it with sealed mid-turn
  `text` blocks (a tool or error followed them). If live drafts are unavailable,
  Telegram refreshes the ordinary typing action every four seconds. Typing also
  continues alongside text drafts during tool calls, until the terminal event.
  In-turn CLI comments update the same draft rather than marking it final. A
  suppressed automated reply sends a textless final event to stop activity
  without publishing a message. Final and
  failed replies are always persistent messages; ephemeral progress never
  suppresses an identical final answer. Tool names, status, and payloads stay
  off the owner chat. The trailing text still becomes today's reply comment.
  Telegram is the first `desk` adapter; Discord and Slack do
  not advertise `desk` until they ingest private owner chat.
- A connector phone-desk Session is transport-owned conversation state, not an
  Ask Alice coworker. It remains attributable and resumable by its Issue, and
  visible in Issue/Automation diagnostics, but is always excluded from the
  Ask Alice Session roster even when the operator opts into ordinary
  headless-born Sessions.
- Each adapter serves one owner account/private chat. Group and channel
  broadcasting are out of scope.
- Inbox `docs` that are Markdown or static HTML reports are externalized as
  file attachments, not flattened into the message body. Telegram sends them
  only after the owner requests a file from `/inbox`; its proactive push lists
  the available files without attaching all of them. Other adapters retain
  their existing push-time attachment behavior until they implement the same
  pull controls. Alice reads the live Workspace file before crossing
  the process boundary; Connector Service never reaches into a Workspace
  itself. The Workspace artifact is never rewritten or given an agent-facing
  encoding requirement. At the externalization boundary Alice detects the
  source encoding and creates a UTF-8-with-BOM delivery copy so locale-sensitive
  mobile viewers do not guess GBK, Big5, Shift-JIS, or a Western legacy charset.
  Source and delivery byte evidence remain separate. One notification carries
  at most five files of at most 1 MiB each. Missing, oversized, unsupported,
  or path-escaping files remain visible as Inbox/report paths and never block
  the text notification. When an encoding cannot be identified safely, Alice
  sends the original bytes instead of guessing. A skipped or ambiguous
  eligible attachment is logged and leaves bridge health degraded so partial
  or unnormalized delivery is visible to operators.
- HTML report files are a presentation asset, not a Connector message format.
  Adapters send the `.html` file with a `text/html` media type and never
  inline, translate, or render those file contents into the chat body.
  OpenAlice previews static HTML in an origin-less sandbox with scripts,
  forms, navigation, and network disabled; inline CSS, SVG, and data images
  remain available for self-contained human-facing reports. Markdown remains
  the default agent-readable work product, while Inbox comments carry the
  concise summary for both the user and other agents.
- Telegram text uses `sendMessage` with `parse_mode: MarkdownV2`. Connector
  converts common GFM (`**bold**`, lists, headings, code) into MarkdownV2 and
  escapes unmatched specials so agent text does not 400. Inbox titles and
  provenance are escaped literals; Inbox bodies go through the same converter.
  If MarkdownV2 is rejected, Connector tries Bot API 10.1 `sendRichMessage`
  with the original GFM, then plain `sendMessage` (4096). Discord still uses
  its own markdown. Do not use legacy `parse_mode: Markdown`.
- Session provenance is rendered as a visible `@resumeId` signature. The
  runtime label may accompany it (`pi · @resume-…`) but must never replace it.

## Topology

```text
Workspace agent
  -> alice inbox push (CLI)
  -> InboxStore durable JSONL append
  -> non-blocking Alice bridge
  -> Connector Service on loopback
       -> adapter registry
          -> Discord Connector
          -> Telegram Connector
          -> Slack Connector
          -> Feishu Connector
          -> future adapter

Telegram owner DM
  -> Telegram adapter (linked private chat only)
  -> sealed Connector inbound queue; platform event id is the dedupe key
  -> Alice claim only while a live phone-desk Issue exists and no
     desk generation is running; later DMs stay stacked
  -> one idempotent Issue comment (via: telegram); several stacked DMs are
     quoted into that one comment
  -> ack after append; failure releases immediately and process loss waits for
     claim-lease expiry
  -> existing comment-reply dispatch
  -> owner-chat projection unless [[no-reply]]

Telegram /inbox detail -> "view files" confirm
  -> Connector action queue (requestId, connectorId, entryId, docIndex)
  -> Alice connector action bridge claim (separate from owner-chat claims)
  -> Alice re-reads Inbox entry and materializes one Workspace file
  -> Connector directed artifact delivery to the requesting adapter only

Telegram /uta (or an Approve/Reject button)
  -> Connector UTA action queue (review, or push/reject with required utaId + pendingHash)
  -> Alice connector action bridge claim
  -> Alice UTAManagerSDK list/status/push/reject (lite/readonly honored here)
  -> UTA push/reject require expectedPendingHash and validate it in the same
     request before mutation; mismatch or absence is 409 and does not write
  -> A pending commit is immutable: UTA refuses further staging until that
     commit is pushed or rejected, and refuses staging/recommit during a write
  -> Connector directed UTA presentation back to the requesting adapter only
     Commits with more operations than the Telegram page can show are not
     remotely actionable — Approve/Reject stay off and the owner uses
     Trading as Git.
```

Load-bearing paths:

- `packages/connector-protocol/` — shared schemas, definitions, public config,
  delivery and health client.
- `services/connector/src/core/` — adapter/command registry, isolated delivery
  manager, and sealed claim/ack work queue.
- `services/connector/src/adapters/` — one file per platform implementation.
- `src/core/connector-config.ts` — sealed config and Guardian enable/restart
  control.
- `src/services/connector-client/` — Inbox projection, on-demand single-doc
  materialization, Alice-side health, and the resident artifact-request bridge.
- `src/workspaces/issues/telegram-desk-chat.ts` — phone-desk inbound claim
  and scheduled-fire comment stamp.
- `src/workspaces/issues/telegram-desk-project.ts` — raw owner-chat projection
  with trusted source and Workspace context.
- `services/connector/src/core/reply-directives.ts` — reply syntax parser.
- `src/workspaces/binary-file.ts` + `src/server/workspace-files.ts` — generic,
  bounded file access on the existing local tool listener; no Connector types.
- `src/webui/routes/connectors.ts` + `ui/src/pages/ConnectorsPage.tsx` — generic
  Settings surface.

## Reply attachments

The Project-owned `file-delivery` Skill teaches this reply path separately from
Inbox notifications and reports. It follows Alice Harness injection preferences
and upgrades; optional sticker-pack guidance remains owned by the sticker pack.

A final reply may include `[[reports/chart.png]]`. Paths are relative to
its source Workspace. Ordinary `[[name]]` references remain text; inline/fenced
code and escaped brackets are literal, including examples of `[[no-reply]]`.
The Connector extension parser preserves unknown syntax and unresolved paths.
It removes only successfully resolved references from displayed text, reads files through Alice's generic `/cli/workspace-files/:id?path=...` interface,
and asks the adapter to upload them. It never accepts a model-provided fetch
host or reads Workspace directories itself. Dev/server pass the selected tool
port; Electron passes its local tool socket. The existing local tool listener
owns access, with no new public unauthenticated route.

Files retain their bytes and filename. Binary formats such as PDF, PNG and CSV
are supported; this path does not use Inbox or its report encoding conversion.
At most five unique files, each at most 1 MiB, are sent per final reply.
Absolute paths, escaping symlink targets, directories and oversized reads are
rejected by the generic file API. Unreadable, missing, unsupported or over-limit references stay literal, including
when the adapter cannot send files. At most 20 unique candidates are resolved;
only five readable files are consumed. Upload failures produce a visible diagnostic
and journal failure; remaining files are still attempted.
Telegram sends PNG/JPEG/WebP images as photos and `sticker/*.png` or
`sticker/*.webp` as native static stickers; other formats are documents.
Files must satisfy Telegram's media requirements; no implicit image conversion
occurs. Inbox artifact pulls remain documents. The old unreleased `file:` syntax
is replaced directly, not maintained as a second syntax.

The same `sendOwnerFile(attachment, presentation)` adapter interface handles
reply files on Telegram, Discord, Slack, and Feishu/Lark. Core never branches
on platform IDs. Discord sends local stickers and images as uploaded image
attachments, not native sticker IDs. Slack uses `filesUploadV2` in the owner's
DM and lets Slack preview image uploads. Feishu uploads images with
`im.image.create` (`image_type: message`) and sends an `image_key` message;
local stickers use this same image path. Ordinary files use its file upload
and `file_key` message path. Directed Inbox artifacts default to files on every
adapter, without adding another Inbox summary.

Slack requires `files:write` in addition to its existing owner-DM permissions.
Feishu requires image/file resource upload permission (`im:resource`) and bot
message sending permission. Existing installations may need updated app scopes.
No adapter converts image bytes or creates server-wide emoji/sticker resources.
Reply media support does not itself enable private chat ingress or advertise
the `desk` capability.

Official API references:
- [Discord message files and sticker IDs](https://docs.discord.com/developers/resources/message)
- [Slack SDK file uploads](https://docs.slack.dev/tools/node-slack-sdk/web-api/)
- [Feishu image upload](https://open.feishu.cn/document/server-docs/im-v1/image/create)

Progress never uploads files. Events for a conversation are serialized;
concurrent/repeated message IDs share one delivery attempt, including uncertain
network failures. This bounded deduplication is process-local (last 1,000 IDs),
not an exactly-once guarantee across service restarts. Owner-chat delivery is
still best-effort; local comments remain the durable record. Automated silence
suppresses both text and files before reading any file.

## Configuration and Secrets

`data/config/connector-service.json` contains only `{ "enabled": boolean }` so
Guardian can decide whether to run the process without decrypting platform
credentials. `data/config/connectors.json` is an AES-256-GCM sealed envelope;
the machine key remains at `<OPENALICE_HOME>/sealing.key` outside portable
`data/`.

### Network proxy

Guardian passes explicit `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and
`NO_PROXY` values to Connector Service. The desktop Guardian also resolves the
host system proxy through Chromium when no explicit environment value exists,
on every supported desktop platform. Lower-case environment names are accepted
and normalized for child processes.

Connector Service owns one shared proxy transport. It installs an Undici
dispatcher for fetch/WebSocket SDKs and gives adapters an explicit Node agent
selector for libraries such as grammY that create their own `node-fetch`
transport. New adapters must consume this shared context instead of reading
environment variables or changing `http.globalAgent` / `https.globalAgent`
themselves. Only HTTP(S) proxy URLs are currently supported; SOCKS-only rules
remain untouched rather than being silently misrouted. Proxy URLs and
credentials must never be logged.

The Settings API never returns a bot token. It returns field definitions,
optional official `setupLinks`, non-secret values, and `configuredSecrets`
presence markers. Setup links are definition-owned metadata rather than
hard-coded adapter branches in the renderer; built-in localized checklists may
enrich them, while an external adapter still receives the generic guide. The
same definition may declare a small `options` list for a finite non-secret
setting. Settings renders those values as an always-visible native radio group
instead of accepting implementation strings as free text; option labels and
hints localize through the generic field key while external definitions retain
their catalog copy. Feishu uses this contract for its `feishu` / `lark` platform
choice. The Settings draft field is masked by default to keep tokens out of
screenshots and screenshares; an explicit reveal control lets the operator
verify a paste.
Missing secret fields belong to one first-time connection save: the UI sends all
entered missing credentials together only after every required connection field
is present. This gives multi-token adapters such as Slack one completion point.
Once a secret is sealed, replacement and removal remain separate confirmed
credential actions rather than joining the first-time group save.
Saving an empty secret keeps the stored value; explicitly removing its presence clears it.
A non-empty secret body is accepted only when it is a plausible token (at
least 20 non-whitespace characters); a short draft cannot replace a sealed
value. Generic Settings auto-save must omit secret fields so enable/unlink
writes cannot carry a password-manager draft. The private UI API accepts only
one global-service command or one adapter-scoped mutation (`enabled`,
non-secret `set`/`unset`, explicit secret set/remove). Alice and adapter-owned
`/link` or `/settings` writes merge under the same cross-process lease. A
reachable Connector Service reconciles only the affected adapter; it never
restarts peer adapters. Guardian starts or stops the optional process for an
explicit global service change and remains the bounded recovery fallback when
the loopback service is unreachable.

`data/state/connector-work-queue.json` is a versioned AES-256-GCM sealed
envelope for inbound owner text, artifact requests, and UTA requests. External
handlers return success only after enqueue commits through atomic rename.
Alice uses bounded claim leases plus item-level ack/release; a crash after
claim cannot erase work, terminal ack is idempotent, and lease expiry makes
unacked items visible again. Artifact and UTA TTL checks still run in Alice
after claim. UTA push/reject retries retain `utaId` plus `pendingHash`, so the
UTA boundary rejects a replay after the pending commit changes instead of
repeating the write. Queue payloads never contain Connector credentials. The
I/O journal remains diagnostic/replay evidence, not queue recovery state.

Ordinary non-secret auto-save uses the shared localized SaveIndicator. It
announces Saving, Saved, and Save failed through one polite atomic live region,
uses icons as well as color, and offers a native Retry button after failure. A
full Settings page places that status in PageHeader; an in-context Connector
dialog places the same primitive in its fixed header so scrolling never covers
setup instructions. Credential creation, replacement, and removal remain
explicit actions and do not report themselves through this auto-save status.

The retired `web.port`, MCP-Ask state, and legacy Telegram connector shape
predate the 0.89.2-beta baseline and are not supported upgrade inputs.

## Adapter Extension Rule

Core dispatch must not branch on platform IDs. Adding a connector means:

1. add a `ConnectorDefinition` (fields and slash-command metadata);
2. implement `ConnectorAdapter` in its own file/package;
3. register its factory at service composition;
4. add adapter-specific tests and packaging dependencies.

`ConnectorAdapter` is also the lifecycle boundary. `start()` validates durable
configuration and arms the adapter; `stop()` is idempotent and releases every
SDK resource. A long-lived adapter must recover transient disconnects either
through its SDK or the shared connection supervisor. If a legacy synchronous
`start()` still lets a transport failure escape, the adapter classifies that
failure as `retry` or `fatal`; DeliveryManager schedules retries but never
parses third-party or platform-specific error text itself. Health must move
through `starting`, `awaiting_link`, `healthy`, `degraded`, and `stopped` as the
external session changes rather than treating process startup as connectivity.

The Settings renderer consumes definitions as data. The DeliveryManager test
registers a fake third adapter to prevent a future Discord/Telegram union or
`if (id === ...)` dispatch from becoming the architecture.

## Platform Setup

Discord uses a user-installed application with slash commands scoped to the
app DM context. No guild/channel is required and raw DM messages are not read.
The owner runs `/link` in the app DM, then OpenAlice stores that Discord user
ID. Telegram uses private-chat long polling; the owner starts the bot and runs
`/link`, which stores the matching user and chat IDs. Slack is a workspace-installed
app that talks only in the owner's app DM. OpenAlice is local, so Slack uses
Socket Mode (`xapp` app-level token + `xoxb` bot token) instead of a public
Request URL. Slash commands are created in the Slack app settings; Connector
listens for them over the socket and does not register them at runtime. Raw
Slack messages are not read. The owner DMs the app and runs `/link`.

Do not use Slack's hosted Deno/Functions platform for this connector. That
path expects Slack to host the app. Socket Mode plus the Web API is the
current local-app shape after the 2026 Node SDK majors (`@slack/web-api` 8,
`@slack/socket-mode` 3).

Feishu/Lark is an enterprise self-built app with bot capability. OpenAlice is
local, so Feishu uses long connection (`WSClient`) instead of a public Request
URL. Store apps cannot use long connection. The owner pastes App ID and App
secret, chooses `feishu` (`open.feishu.cn`) or `lark` (`open.larksuite.com`),
starts the bot, DMs it, and runs `/link` as plain text — Feishu has no runtime
slash-command menu. Subscribe to `im.message.receive_v1`, keep availability
limited to the owner, and leave IP allowlists empty unless the Connector
egress IP is listed. Group custom-bot webhooks are send-only and are not this
connector. `/inbox`, `/settings`, and `/uta` currently reply with placeholders;
owner chat and Inbox push are implemented. Each platform chat is its own
connector-chat Issue (for example, `feishu-phone-desk`), independent from the
Telegram chat Issue.

Saving valid bot credentials does not mean the connector is linked. Settings
must present the lifecycle explicitly: credentials ready, bot online and
`awaiting_link`, then linked/healthy. Starting the linking step enables the
optional Connector Service and that adapter so the external bot can actually
receive `/link`; owner/chat fields learned by the command are lifecycle output,
not ordinary operator-entered configuration. Settings Unlink clears those
learned fields and keeps the sealed token so a different private account can
run `/link`. Removing the token is a different action.

`awaiting_link` means the adapter can already receive `/link`. Telegram does
not report that until long polling has started (`onStart`); Discord waits for
the gateway to become ready. Publishing Telegram's slash-command menu is
best-effort and happens only after polling is live: a hung or failed
`setMyCommands` must not block `start()`, long polling, owner chat, or Inbox
delivery. `start()` arms the adapter and returns; the Bot API session is a
supervised loop. A hung handshake is abandoned after one attempt budget
(default 30s) and the same adapter reconnects with backoff. That budget is
not a process-level deadline and does not stop Connector Service. The session
supervisor retries indefinitely with capped exponential backoff and jitter.
Telegram also watches the host clock while polling; a suspend/resume gap
abandons a polling promise that can no longer settle and starts a fresh
session. Health exposes `lastAttemptAt`, `nextAttemptAt`, and
`consecutiveFailures` so the operator can distinguish waiting from a dead loop.
The
Connector HTTP health endpoint binds before those external calls so Guardian
can probe a `starting` adapter instead of treating the whole service as
missing. A failed adapter stays registered with its `lastError` rather than
collapsing to "configured but not running." Configuration errors such as a
missing bot token still fail `start()` and do not reconnect.

Both adapters reject commands from any account other than the linked owner.
Use `/status` for adapter health and `/test` for an explicit delivery check.
`/test` still sends when Inbox push is off. `/inbox`, `/settings`, and `/uta` are
capability commands: the catalog only declares them; Telegram renders
buttons, and a connector that has not implemented the form yet must still
answer the slash command. `/uta` does not interpret free-text chat as
orders; only the owner-linked slash command and its buttons may enqueue
review, push, or reject.

### Setup lifecycle and UI ownership

Connector setup is a lifecycle, not a single `enabled` checkbox. Keep these
states explicit because collapsing them recreates the dead end where a token is
saved but no bot process exists to receive `/link`.

| Product state | Durable facts | Runtime fact | Primary action |
|---|---|---|---|
| Credentials needed | required secret/fields missing | adapter stopped | create the platform bot and save credentials |
| Ready to link | credentials sealed, owner absent | adapter stopped | start the bot for linking |
| Starting | adapter enabled, owner absent | service HTTP up; adapter `starting` until the platform connection is live | wait; Settings polls health without replacing form drafts |
| Awaiting link | credentials sealed, owner absent | bot online with `awaiting_link` | open the private bot chat and send `/link` |
| Linked | owner identity learned | adapter `healthy` | send tests, unlink, or receive Inbox delivery |
| Linked offline | owner identity retained | adapter/service intentionally stopped | start the connector, or unlink and relink later |
| Error | durable config retained | adapter `degraded` or service unavailable | reconnect the adapter, then inspect Connector logs if it persists |

The surfaces deliberately have different jobs:

- **Settings → Connectors** owns credentials, the setup sequence, enable/stop,
  unlink, linking instructions, and explicit test sends. While credentials are
  missing, the expanded required Connection section is the first task; the
  actionless `Credentials required` lifecycle panel is omitted because overview
  and the Settings navigator already establish that state. The section keeps a
  short platform checklist and official console links beside the fields; those
  links form a wrapping 40 px action row immediately after the platform
  description and before the numbered steps, so opening the official destination
  is visibly the first task. One- and two-destination adapters share the same
  data-driven layout. Links open without dismissing the configuration dialog or
  losing its drafts.
  Connector-owned fields, secret reveal controls, setup links, and explicit
  credential, recovery, and test actions keep a 40 px interaction minimum in
  both the dialog and full Settings document; larger disclosures and Chat
  actions retain their 44–48 px targets. During first save, only currently
  missing required fields carry a localized Required badge. The save footer
  names those exact field labels in a polite live hint, then returns to the
  ordinary grouped-save explanation once every requirement is present. Save
  connection remains disabled until the same existing credential boundary is
  satisfied; the hint explains that state without manufacturing a validation
  error. If grouped secret validation fails after submission, every invalid
  input exposes `aria-invalid` plus its own described inline error and the first
  invalid field receives focus, bringing recovery back into view on long or
  narrow forms. Editing a draft clears only that field's error. Client-side
  length guidance stays concise while backend save failures retain their
  existing scoped error surface. After a successful grouped first save, the
  preparation guide disappears, Connection details collapses, and the newly
  rendered Ready to link panel receives the interaction handoff: focus moves to
  that channel's runtime switch. The switch remains off and no external action
  occurs until the operator activates it. Auto-save and later credential
  maintenance do not move focus.
  Every later lifecycle stage retains its panel for runtime, linking, test, or
  recovery actions. Error panels keep the primary sentence actionable and put
  raw adapter messages plus retry timing in the same 40 px Technical details
  disclosure used by Overview. The known configured-but-not-running state keeps
  its dedicated product sentence without repeating the implementation string.
  The shared dialog sizes to short content on desktop and bounds long forms with
  internal scrolling; narrow viewports keep a near-full-height shell so controls
  remain usable around virtual keyboards. Once linked,
  the lifecycle panel keeps routine availability
  and test controls visible; Unlink lives inside Connection details beside token
  replacement/removal and explains that sealed credentials remain available.
  The full Settings category keeps every adapter in one document and adds a
  responsive in-page channel navigator with the same lifecycle badges. Choosing
  a channel moves keyboard focus to that section's semantic heading and scrolls
  the labelled region without changing route, hiding another adapter's draft,
  or adding browser history. The compact heading ring identifies the destination
  without outlining the complete long form. The navigator also tracks the
  channel nearest the reading edge while the Settings document scrolls, marking
  it visually and with `aria-current="location"`; its reading anchor shares the
  section's responsive scroll margin so click and manual-scroll state cannot
  disagree at the sticky boundary.
  On desktop the sticky navigator sits exactly on the Settings scrollport edge,
  so controls from the preceding channel cannot scroll through above it. Initial
  page breathing room comes from a normal-flow spacer that scrolls away; the
  narrow navigator stays static and consumes no persistent mobile height. At
  380–639 px, its always-visible channel choices use a two-column grid with the
  complete channel name above the lifecycle badge; narrower screens return to
  one inline column, and desktop uses one inline row. Every navigation target is
  at least 40 px high.
  The adapter dialog moves initial focus to its semantic title so the selected
  channel is announced without focusing a credential field or opening a mobile
  keyboard. Its title is programmatically focusable rather than another Tab
  stop. The dialog localizes its close control and gives that control a larger
  mobile touch target while retaining the shared primitive's trigger focus
  restoration, Escape, focus containment, and backdrop behavior.
  Runtime and Chat switches use their localized label (and Chat's explicit
  On/Off text) directly beside the shared Toggle; they are not wrapped in a
  second bordered pseudo-button. The Toggle remains the only switch control and
  owns its hit target, focus, disabled, and checked semantics.
  Test-delivery progress, probe confirmation, and test/reconnect failures remain
  inside the same lifecycle panel as their action; feedback is adapter-scoped and
  announced without making the operator search below unrelated settings. A
  successful test leads with the human outcome and destination; its internal
  delivery reference stays available in a collapsed Test details disclosure
  instead of requiring the operator to understand or confirm a probe id.
  A desk-capable adapter also binds that connector's chat Issue when its
  definition advertises `desk`:
  the Workspace picker defaults to the Ask Alice Chat workspace. The operator
  can edit the scheduled check-in prompt and cadence, then open the ordinary
  Issue detail for comments. Generic Issue create/update cannot set
  `connectorDesk`.
- Chat setup is durable configuration, not proof that its transport is live.
  A linked-but-offline adapter may still bind Chat to a Workspace so the
  operator can prepare it without starting external delivery. In that state the
  Chat switch remains checked when a desk exists, but its visible state reads
  Waiting rather than On; the bound-Workspace copy says conversations resume
  only after that connector is online. Turning Chat on while the adapter is
  offline likewise describes preparation, never an already active conversation.
- Each connector-chat Issue is hidden from the Issue board and Tracked list. It
  still fires on `when`. Extra desks for the same connector in other
  Workspaces do not fire. Owner DMs become comments on that connector's
  Issue; the desk is seeded with `commentPrompt: '{comment}'` so those
  comments are the reply Input Prompt as-is. Scheduled-fire `assistantText`
  is stamped as a comment. Connector interprets automated silence from the
  forwarded source; comments
  that arrived from that connector are not echoed.
  Pending comment replies also carry compact turn progress. The connector chat
  ships sealed mid-turn `text` blocks (the last consecutive text before a
  tool or error) and skips tool/error blocks. A text already sent this way
  is not sent again as the final comment.
- **Beta → Connectors** is the operations view: service health, the same
  seven-stage setup lifecycle used by Settings, durable private-chat linkage,
  last delivery evidence, and an explicit reconnect action only for an actual
  error. Runtime owner presence is supporting health evidence, not the source of
  truth for a saved link. The reconnect is adapter-scoped while the
  service answers; if the process is unreachable, Alice asks Guardian to restart
  the optional service instead. Its service summary distinguishes process
  availability from adapter health: a returned health body with degraded
  adapters stays a Running warning and directs attention to the owning channel
  card, while a degraded bridge with no service body is Unavailable and retains
  the service-level diagnostic. Reachable adapter errors are not repeated in the
  summary. The overview keeps linked, credentialed,
  enabled, and partially configured adapters in stable definition order under
  Your channels. Only pristine adapters appear under Available channels, so
  transient runtime changes never reorder established targets and empty groups
  do not add headings. Before any adapter is credential-ready or enabled, the
  irrelevant Off/zero-count service summary is omitted and the pristine group
  becomes Choose a channel. Pristine adapters use compact selection articles
  with neutral 40 px setup actions plus localized Inbox delivery and capability-
  gated Workspace chat labels; once setup starts, that adapter moves to the full
  lifecycle card without losing its configuration dialog. Cards omit the
  repeated generic delivery subtitle and do
  not impose a fixed minimum height: the state explanation is the primary body,
  while evidence and the next action remain in stable document order. State
  explanations describe current delivery impact and the next useful action;
  durable private-chat linkage and last delivery remain separate evidence, so
  neither English nor Chinese cards repeat the same link fact in both layers. A
  channel article is the single visual container. Platform glyphs use one neutral
  identity treatment across owned and pristine cards; interaction blue belongs
  to selection, focus, enabled switches, and primary actions, while lifecycle
  badges and copy own status. State copy is not wrapped in a nested
  status card, diagnostics use a thin native disclosure, and the non-clickable
  article has no hover treatment. Every
  credential-ready card also exposes the same runtime switch as Settings.
  Before the first start, its visible label becomes `Start <platform>` and the
  configuration action becomes a neutral setup-details affordance, so opening a
  dialog does not compete visually with the control that actually advances the
  lifecycle. Once the adapter is awaiting `/link`, the dialog action becomes the
  emphasized link-instruction path. Turning the switch on enables the shared
  service when needed; turning it off
  preserves credentials, linkage, delivery preference, and Chat configuration.
  The switch reflects actual runtime availability when the shared service is
  paused, not merely the adapter's retained preference. Toggle/reconnect
  progress and failures stay inside the affected card. The labelled runtime
  switch and explicit management or recovery actions share one wrapping action
  rail: ordinary one-action cards keep them on one row, recovery actions wrap
  without reordering, and every action retains a 40 px target. The health domain
  reloads current configuration before this whole-config write, then refreshes
  the live snapshot so the overview does not own a second polling lifecycle.
- **Activity Bar → Connectors** shows a warning count for enabled, configured
  adapters that are degraded, stopped, unreachable, or stuck in `starting`
  beyond the grace window. `awaiting_link` remains setup state and does not
  warn.
- **Dev Panel** may expose logs and replay tooling, but it is not a product
  configuration surface.

Both product surfaces distinguish absence from staleness. A first load uses a
layout-matched skeleton; if no snapshot or configuration can be read, the
surface shows a focused retry state instead of an empty pane or raw transport
error. When last-known data exists, a refresh failure keeps it visible with an
explicit stale-state notice. In-dialog runtime retry refreshes health only so it
cannot replace unsaved credential drafts.

Overview and Settings consume the same live runtime-health domain. The Settings
form still owns its initially loaded configuration and save responses, so a
background health refresh cannot replace an in-progress field or credential
draft. Service presentation is derived by one shared lifecycle rule: disabled is
Stopped/Off, healthy is Online/Healthy, degraded with a returned service body is
Running because healthy channels remain available, and degraded without a
service body is Unavailable. Adapter errors remain on their owning channel in
both surfaces.

The Connector Service switch is a secondary pause-all control. Starting an
adapter from the setup flow enables the service automatically, so it is not a
separate first-use prerequisite; pausing the global service never deletes sealed
credentials or the learned account link. Health polling
during linking updates runtime health only. It must not replace the current
Settings draft, reveal secrets, or create an auto-save/restart loop.

## Health Contract and Tests

UTA and Connector Service are both optional external services. Alice probes
them through the same health contract and reports one of three phases:

- `disabled`: intentionally switched off; no network request is made.
- `healthy`: the endpoint returned 2xx and its service-specific body passed
  schema validation.
- `degraded`: enabled but not configured, unreachable, timed out, returned a
  non-2xx response, or returned an invalid body.

Each probe also records a stable reason code, check timestamp, and latency. A
failed optional-service probe must never change Alice or Inbox availability.
An adapter in `starting` or `awaiting_link` is online and intentionally
incomplete, so it does not degrade the service; external notification delivery
becomes healthy only after the owner runs `/link`. A Telegram adapter that
cannot reach the Bot API stays `starting` or `degraded` and reconnects
inside the Connector process; Alice reports `degraded` only while the
adapter is `degraded`.
The contract matrix lives in `src/services/optional-carrier/health.spec.ts`;
`integrations.spec.ts` applies it to the real UTA and Connector response shapes.
Guardian/process smoke tests remain responsible for proving that an enabled
service actually starts and reaches its health endpoint. A configured Connector
process that exits unexpectedly is restarted by Guardian forever with capped,
jittered backoff; manual disable and Guardian shutdown cancel recovery.

## Two-Layer External Acceptance

External SDKs cannot be closed-loop tested by treating a successful HTTP call
as proof that a human-visible DM arrived. Connector acceptance therefore has
two explicit layers.

### Layer 1: recorded contract replay

Connector Service writes a bounded, private JSONL journal to
`data/logs/connector-io.jsonl` (one rotated generation at `.1`). It records:

- normalized Inbox notification text at service ingress;
- delivery attachment evidence (`filename`, media type, byte size, and
  SHA-256), plus source size, digest, and detected encoding when available,
  without repeating base64 file bodies into every ingress/adapter journal event;
- per-adapter delivery attempt, success, or failure tied to one correlation ID;
- inbound slash-command name and pseudonymized user/chat IDs;
- command replies and command failures.

Bot tokens are never journaled. Platform user and chat IDs are stable SHA-256
pseudonyms so authorization/equality cases remain replayable without retaining
raw external identifiers. Notification text is retained because it is the
payload under test; the journal is mode `0600`, bounded to 5 MiB, and remains
local to the OpenAlice data home. Adapter tests own byte-level attachment
decoding/upload contracts; replay owns the durable text and attachment-evidence
contract without growing the journal into a report archive.

`services/connector/test-fixtures/io-smoke.jsonl` is a safe fixture. The replay
harness consumes only `notification.received` events and runs them through a
fake adapter; recorded success/failure events are evidence and are never
mistaken for new inputs. The real process smoke also waits for its accepted
notification to appear in the journal. Run
`pnpm test:contract:connector-replay` for the offline fixture lane and
`pnpm test:system:connector` after building the service for the
real-process/journal lane.

### Layer 2: opt-in web DM confirmation

When the operator explicitly permits external-account testing and a signed-in
browser profile is available:

1. use **Send test** in Connector Settings and copy its unique
   `connector-probe-xxxxxxxx` ID;
2. open the linked owner's Discord Web or Telegram Web private bot chat;
3. confirm the exact probe ID appears once in the DM;
4. send `/status` and confirm a reply, then verify matching
   `command.received` and `command.replied` journal events;
5. record the lane as passed, failed, or skipped with a reason.

Browser confirmation is never run silently: it touches an external account and
creates messages. Without permission, credentials, and a signed-in owner
session, this layer must be reported as **skipped**, not passed. Platform web UI
automation is an acceptance aid, not a CI dependency.

## Acceptance

Changes to this subsystem require:

- protocol/service typecheck and adapter registry tests;
- recorded I/O fixture replay and journal privacy/rotation tests;
- an isolated Connector Service process health + accepted-delivery smoke;
- proof that Inbox append succeeds when Connector Service is absent;
- Settings browser verification without exposing token values;
- dev Guardian enable/restart/disable recovery under an isolated
  `OPENALICE_HOME`;
- Docker build/runtime smoke and packaged Electron resource assertion.

Real Telegram/Discord delivery needs user-owned platform credentials and is a
manual acceptance lane; credential-free CI must not pretend that a live
third-party message was delivered.

### Market reply snapshots

Final owner-chat references beginning with `market/` resolve through the local
Alice market gateway rather than Workspace file access. DeliveryManager sends
the generated PNG as a photo at the reference position, using the same ordered
parts and five-media limit as files. Automation silence skips resolution;
failed charts retain the reference with an unavailable notice. Inbox's derived
file index excludes market references.

The renderer uses bundled JavaScript and a bundled OFL Liberation Sans font;
it needs neither a browser nor a platform-native graphics library. Font paths
are filled as compound contours to preserve digit/letter counters. PNGs are
2400 by 1600 for legible mobile zoom; the attachment byte ceiling still applies.

## Session model controls

Telegram `/model` opens an owner-only private-chat inline panel for the existing
phone-desk Session. Runtime is fixed. Credential, model, and effort use the same
picker policy as Chat and Issues. Options are suggestions, not a claim that an
account can access every model; `/model <model-id>` previews a custom model ID.
Changing credential clears model/effort; changing model clears effort. Each
choice previews, and **Save** commits. **Close** discards unsaved choices.

Connector's optional `sessionModel` adapter context calls Alice's fixed local
HTTP/Unix-socket gateway at `/cli/connector-model/:connectorId`. Alice resolves
the desk and validates compatibility; only credential IDs/labels cross the
boundary, never credential contents. There is no caller-selected Workspace or
runtime. The command is consumed by Connector, not posted as an agent comment.

Saving changes only the assigned Session binding. A running headless turn keeps
its captured settings; subsequent comments/scheduled turns resolve the new
binding. An active interactive TUI/GUI must first disconnect. Workspace defaults
and other Sessions are unchanged. Missing or unassigned desks instruct the owner
to send a first message. The menu does not silently create a replacement Session.

Telegram panels expire after ten minutes and use bounded pagination and opaque
callback coordinates. Owner checks apply to both commands and callbacks. A
Session handoff or intervening binding edit invalidates a save, and concurrent
saves are rejected. Transport or validation errors remain visible; they never
produce a success acknowledgement. Connector restart invalidates old panels.
The control contract is platform-neutral; Telegram currently implements its UI.
See [Telegram inline keyboards](https://core.telegram.org/bots/api#inlinekeyboardbutton)
and [callback acknowledgement](https://core.telegram.org/bots/api#answercallbackquery).
