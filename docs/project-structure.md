# Project Structure

This guide owns OpenAlice's current process boundaries, source-tree ownership,
and persistent-state layout. Update it when a top-level subsystem moves or a
new long-lived process, package, or state root is introduced.

Related guides: [[docs/managed-workspace-runtime.md]],
[[docs/cli-installer.md]], [[docs/local-runtime.md]], [[docs/broker-packs.md]],
[[docs/data-locations.md]],
[[docs/docker-deployment.md]],
[[docs/workspace-lifecycle.md]],
[[docs/workspace-template-upgrade.md]],
[[docs/workspace-issues-and-scheduling.md]],
[[docs/conversation-provenance.md]], and [[docs/market-data-architecture.md]].

## Runtime Topology

OpenAlice has two principal long-running service processes plus an optional
Connector Service supervised by Guardian:

```text
Guardian
├── built Runtime control    versioned status + self-owned Server stop
├── Alice                    Workspace runtime + product/API process
│   ├── Web UI transport     HTTP/Vite in dev, app:// + IPC in Electron
│   ├── Workspace PTYs       claude / codex / opencode / pi / shell
│   ├── ToolCenter           market, news, analysis, Inbox, UTA bridges
│   └── file-backed state    config, sessions, issues, schedules, tool-call log
├── UTA                      broker carrier and trading authority
│   ├── broker connections
│   ├── account state
│   ├── staged/committed trading operations
│   └── snapshots, FX, and execution
└── Connector Service        optional external Inbox notification adapters
```

Launchers share the same ownership model:

- `scripts/guardian/dev.ts` runs UTA, Alice, and Vite for `pnpm dev`.
- `apps/desktop/src/main.ts` is the packaged Electron Guardian and renderer
  host. It starts Alice/UTA through Electron's Node mode.
- `scripts/guardian/prod.mjs` supervises built Runtime services for Docker and
  the source-backed local CLI. Docker defaults to the `docker` launcher;
  `openalice start` supplies the `cli` launcher, while `openalice server`
  supplies `cli-server` plus a versioned local status/stop capability. All CLI
  browser and SSH paths keep Alice on loopback.
- `packages/guardian-runtime/` owns cross-launcher single-writer locks,
  heartbeat metadata, process identity, and controlled takeover.

UTA may be disabled in lite/read-only mode. Alice and the Workspace UI must
remain usable without it; only broker/trading capabilities disappear.

## Source Ownership

```text
src/                           Alice process
├── main.ts                    composition root
├── core/                      config, credentials, paths, sessions, Inbox,
│                              ToolCenter, sealing, runtime profile, journals
├── ai-providers/              provider/model preset catalog only
├── domain/                    non-broker domains
│   ├── market-data/           market/fundamental data access
│   ├── analysis/              indicators and technical analysis
│   ├── news/                  RSS collection and archive search
│   └── thinking/              safe expression evaluation
├── tool/                      agent-facing tool definitions and bridges
├── workspaces/                launcher, PTYs, templates, adapters, issues,
│   │                          schedules, CLI shims, file/git operations
│   ├── adapters/              claude / codex / opencode / pi / shell
│   ├── cli/                   alice, alice-uta, alice-workspace, traderhub
│   └── templates/             built-in chat and auto-quant templates
├── services/
│   ├── auth/                  admin token and web session services
│   ├── uta-client/            Alice-side UTA SDK adapters
│   └── uta-supervisor/        UTA health and restart signaling
├── server/                    MCP, local CLI gateway, market-data compat mount
├── webui/                     Hono routes, auth middleware, Workspace WS/IPC
└── migrations/                versioned user-state migrations

services/uta/                  UTA process
├── src/main.ts                service composition root
├── src/http/                  trading/simulator HTTP boundary
└── src/domain/trading/        UTA Core plus source adapters for Broker Packs

packages/
├── cli/                       installable local Runtime/connection CLI
├── guardian-runtime/          process ownership and recovery primitives
├── uta-protocol/              schemas and wire types shared by Alice + UTA
├── ibkr/                      IBKR TWS protocol package, owned by UTA
├── uta-broker-*/              optional live-engine release wrappers
└── opentypebb/                embedded market-data compatibility package

ui/                            React/Vite renderer
apps/desktop/                  Electron main/preload/IPC shell
scripts/guardian/              dev/prod supervisors, local control + recovery tests
default/                       shipped skills and factory defaults
docs/                          owner guides and contributor documentation
```

The model execution loop is not in `src/ai-providers/`. Native coding-agent
CLIs own their model loops. Alice's provider catalog describes credential and
wire suggestions; Workspace credential injection translates a selected
credential into the target CLI's local configuration.

## Workspace Architecture

A Workspace is the primary capability boundary. It is a persistent directory
and git repository plus PTY sessions, scrollback, issues, schedules, and agent
configuration. The launcher supplies reusable infrastructure; the work itself
lives in templates, skills, files, and satellite repositories.

Chat uses that boundary deliberately:

- **New conversation** creates a Session inside the recent Chat Workspace.
- **New Workspace** explicitly creates a new durable context container.
- The global Ask Alice composer stores `quickChat.recentChatWorkspaceId` in
  `data/preferences.json`. A missing or stale pointer falls back to the most
  recently active Chat Workspace; only a user with no Chat Workspace gets a
  new stable starter workspace.

Do not reintroduce date-based automatic Chat Workspaces. A date is not a
context boundary, and new daily repositories strand files, issues, git history,
and agent configuration in yesterday's Workspace.

Load-bearing paths:

- `src/workspaces/service.ts` — Workspace lifecycle and composition.
- `src/workspaces/session-pool.ts` — PTY process ownership.
- `src/workspaces/session-registry.ts` — durable session metadata.
- `src/workspaces/scrollback-store.ts` — terminal replay.
- `src/workspaces/template-registry.ts` — template declarations.
- `src/workspaces/template-upgrade.ts` — reviewed managed-asset reconciliation
  and interrupted-upgrade recovery.
- `src/workspaces/workspace-operation-guard.ts` — shared checkout-mutation
  lease for upgrade, offboarding, and future merge operations.
- `src/workspaces/workspace-creator.ts` — bootstrap and initial git state.
- `src/workspaces/context-injector.ts` — persona and shared skill injection.
- `src/workspaces/adapters/` — CLI-specific command/config behavior.
- `src/workspaces/protocol.ts` — UI ↔ Workspace contract.

Conversation execution has four deliberately separate identities, plus one
provenance link:

- `resumeId` is Alice's canonical product Session identity across headless and
  interactive turns. Product APIs, artifact provenance, and follow-up flows
  identify the same stateful Session by this id.
- `taskId` identifies one headless execution. Every follow-up turn gets a new
  task id, so run history remains append-only.
- `SessionRecord.id` is Alice's durable interactive materialization key. Tabs,
  PTY attachment, and pause/resume routes use it; it is not Session identity.
- `agentSessionId` is the backend-only native CLI conversation id. The
  `ResumeRegistry` maps `resumeId` to this adapter-specific value; it must not
  appear in frontend resume requests or Inbox provenance.
- `sourceRunId` is present when a finished headless run has been materialized
  as an interactive Session and preserves execution provenance.

Do not use a headless task id directly as a PTY/session id, and do not create a
new interactive materialization every time the same `resumeId` is opened. The
run is execution provenance; `resumeId` is the product Session; the
`SessionRecord` is one durable interactive surface.

For the broader “ask the agent who produced this” model — including mutable
Issues, Inbox deliveries, document revisions, reconstruction fallback, and
trade-decision attribution — follow [[docs/conversation-provenance.md]].

Built-in templates use cross-platform `bootstrap.mjs` files and route git
through `src/workspaces/templates/_common.mjs`. Do not add new Bash bootstraps
for built-in templates. `bootstrap.sh` remains only as a third-party fallback.

Workspace tools are exposed as CLI shims on `PATH`. The `alice*` and
`traderhub` skills teach the native agents how to call those shims. Shared
project skills are copied to `.agents/skills/` and Claude-specific discovery to
`.claude/skills/`; Pi provider state lives separately under `.pi-agent/`.

## Alice and UTA Boundary

UTA is the only owner of broker connections and trading writes. The contract
crosses `@traderalice/uta-protocol` over local HTTP:

- `services/uta/src/domain/trading/` contains broker implementations,
  account state, approval/git semantics, FX, and snapshots.
- `packages/uta-broker-*/` package live broker implementations and third-party
  SDKs separately from UTA Core; production resolves them from
  `<OPENALICE_HOME>/runtime/broker-packs/`.
- `src/services/uta-client/` presents that remote boundary to Alice as SDK
  adapters.
- `src/tool/trading.ts` is a thin agent-facing bridge, not a broker domain.
- Alice's `/api/trading/*` routes proxy to UTA rather than implementing trades.
- Configuration changes that require UTA restart use
  `data/control/restart-uta.flag`, watched by Guardian.

Do not use Alice process availability as evidence that UTA or a broker is
healthy. Do not let an optional UTA failure block read-only Workspace use.
An absent Broker Pack disables only accounts and K-line sources that require
that engine; it must not prevent UTA Core or another engine from starting. See
[[docs/broker-packs.md]] for the install and activation contract.

## Tools, Automation, and Delivery

`src/core/tool-center.ts` is the tool registry. Workspace-scoped registration
passes through `src/core/workspace-tool-center.ts`, which binds the Workspace
identity before exposing tools.

Scheduled work uses the same Workspace execution plane as attended work:

```text
issue/schedule -> headless Workspace run -> native agent -> inbox_push -> Inbox
```

Inbox is the durable agent-to-user delivery surface. Agents publish reports or
status by calling the injected `inbox_push` capability. Alice stamps the
interactive Session or headless run identity out-of-band. The user can return
to the exact originating interactive Session; a finished headless run is
materialized once and then reused as a normal Session for follow-up.

## Persistent State

`OPENALICE_HOME` selects the OpenAlice user root. The default is
`~/.openalice`. Guardian injects the resolved value into child processes so the
launcher and services agree.

The desktop may select another complete root before Guardian ownership is
acquired. Its machine-local path preference lives under Electron `userData`,
outside every selectable root; see [[docs/data-locations.md]]. Never implement
selection by moving only `data/`, because Workspaces, locks, credentials,
sealing, and Broker Packs must remain coherent.

```text
<OPENALICE_HOME>/
├── data/                      portable user data
│   ├── config/                JSON config + migration journal
│   ├── sessions/              web/admin sessions
│   ├── trading/               account history and snapshots
│   ├── inbox/                 Inbox records
│   ├── event-log/             UTA account-health and snapshot journal
│   ├── cron/                  schedules/jobs
│   ├── news-collector/        RSS archive
│   └── _backup/               migration snapshots
├── workspaces/                default launcher root
│   ├── workspaces.json        active Workspace registry
│   ├── workspaces/            active Workspace repositories only
│   ├── departed-workspaces/   retained offboarded repositories
│   ├── state/                 lifecycle catalog, Sessions, scrollback, tasks,
│   │                          provenance, compatibility lock
│   └── auto-quant-mirror/     shared Auto-Quant source mirror
├── state/
│   ├── guardian.lock          launcher ownership
│   └── runtime.lock           shared writer ownership
├── runtime/
│   └── broker-packs/          replaceable, platform-specific broker SDK packs
├── provider-keys.json         user-global AI provider credentials
└── sealing.key                machine-bound encryption key; not in data/
```

Overrides:

- `AQ_LAUNCHER_ROOT` moves only the Workspace launcher root.
- `OPENALICE_GLOBAL_DIR` moves the user-global `provider-keys.json` store.
- `OPENALICE_APP_HOME` points to replaceable app resources such as templates,
  defaults, UI assets, and packaged CLI shims.

`data/` is the portable backup/migration unit. `sealing.key` deliberately
lives beside it so a copied data directory does not carry its decryption key.
Any upgrade-time transformation of persisted state belongs in
`src/migrations/`, must be idempotent, and must declare affected paths for the
generated `src/migrations/INDEX.md`.

## Change Routing

| Change | Start with |
|---|---|
| Workspace lifecycle, agent launch, packaged Pi, shell/PATH | `src/workspaces/` + [Managed Workspace runtime](managed-workspace-runtime.md) |
| Workspace offboarding, restore/purge, Session retirement | [Workspace and Session lifecycle](workspace-lifecycle.md) |
| Template versions, managed-asset reconciliation, upgrade recovery | [Workspace Template Upgrade](workspace-template-upgrade.md) |
| Broker/account/execution behavior | `services/uta/src/domain/trading/` + [UTA live testing](uta-live-testing.md) |
| Shared Alice ↔ UTA shapes | `packages/uta-protocol/` and both callers |
| External Inbox notifications and IM adapters | [Connector Service](connector-service.md) |
| Renderer/API surface | `ui/`, `src/webui/`, and matching demo handlers |
| Issues, schedules, headless runs, Inbox delivery | [Workspace issues and scheduling](workspace-issues-and-scheduling.md) |
| Retired event-bus scheduler and UTA journal boundary | [Event-system retirement note](event-system.md) |
| User-state schema | `src/migrations/` + generated migration index |
| Process lock/recovery and optional-service supervision | `packages/guardian-runtime/` and all three launchers |
| Desktop home selection and concurrent local instances | [Data locations](data-locations.md) + `apps/desktop/src/data-home.ts` |

When current code disagrees with this guide, verify the runtime behavior and
update the guide in the same change rather than leaving a second source of
truth in `AGENTS.md`.
