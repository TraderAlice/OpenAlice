# Project Structure

This guide owns OpenAlice's current process boundaries, source-tree ownership,
and persistent-state layout. Update it when a top-level subsystem moves or a
new long-lived process, package, or state root is introduced.

Related guides: [[docs/managed-workspace-runtime.md]],
[[docs/workspace-issues-and-scheduling.md]], and
[[docs/opentypebb-tutorial.md]].

## Runtime Topology

OpenAlice has two long-running service processes supervised by Guardian:

```text
Guardian
├── Alice                    Workspace runtime + product/API process
│   ├── Web UI transport     HTTP/Vite in dev, app:// + IPC in Electron
│   ├── Workspace PTYs       claude / codex / opencode / pi / shell
│   ├── ToolCenter           market, news, analysis, Inbox, UTA bridges
│   └── file-backed state    config, sessions, issues, schedules, tool-call log
└── UTA                      broker carrier and trading authority
    ├── broker connections
    ├── account state
    ├── staged/committed trading operations
    └── snapshots, FX, and execution
```

Launchers share the same ownership model:

- `scripts/guardian/dev.ts` runs UTA, Alice, and Vite for `pnpm dev`.
- `apps/desktop/src/main.ts` is the packaged Electron Guardian and renderer
  host. It starts Alice/UTA through Electron's Node mode.
- `scripts/guardian/prod.mjs` supervises the Docker/production process pair.
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
└── src/domain/trading/        all broker and trading-domain implementation

packages/
├── guardian-runtime/          process ownership and recovery primitives
├── uta-protocol/              schemas and wire types shared by Alice + UTA
├── ibkr/                      IBKR TWS protocol package, owned by UTA
└── opentypebb/                embedded market-data compatibility package

ui/                            React/Vite renderer
apps/desktop/                  Electron main/preload/IPC shell
scripts/guardian/              dev and production supervisors + smoke tests
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

Load-bearing paths:

- `src/workspaces/service.ts` — Workspace lifecycle and composition.
- `src/workspaces/session-pool.ts` — PTY process ownership.
- `src/workspaces/session-registry.ts` — durable session metadata.
- `src/workspaces/scrollback-store.ts` — terminal replay.
- `src/workspaces/template-registry.ts` — template declarations.
- `src/workspaces/workspace-creator.ts` — bootstrap and initial git state.
- `src/workspaces/context-injector.ts` — persona and shared skill injection.
- `src/workspaces/adapters/` — CLI-specific command/config behavior.
- `src/workspaces/protocol.ts` — UI ↔ Workspace contract.

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
- `src/services/uta-client/` presents that remote boundary to Alice as SDK
  adapters.
- `src/tool/trading.ts` is a thin agent-facing bridge, not a broker domain.
- Alice's `/api/trading/*` routes proxy to UTA rather than implementing trades.
- Configuration changes that require UTA restart use
  `data/control/restart-uta.flag`, watched by Guardian.

Do not use Alice process availability as evidence that UTA or a broker is
healthy. Do not let an optional UTA failure block read-only Workspace use.

## Tools, Automation, and Delivery

`src/core/tool-center.ts` is the tool registry. Workspace-scoped registration
passes through `src/core/workspace-tool-center.ts`, which binds the Workspace
identity before exposing tools.

Scheduled work uses the same Workspace execution plane as attended work:

```text
issue/schedule -> headless Workspace run -> native agent -> inbox_push -> Inbox
```

Inbox is the durable agent-to-user delivery surface. Agents publish reports or
status by calling the injected `inbox_push` capability; the user can return to
the originating Workspace session from the Inbox item.

## Persistent State

`OPENALICE_HOME` selects the OpenAlice user root. The default is
`~/.openalice`. Guardian injects the resolved value into child processes so the
launcher and services agree.

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
│   ├── workspaces.json        Workspace registry
│   ├── workspaces/            Workspace repositories
│   ├── state/                 sessions, scrollback, tasks, compatibility lock
│   └── auto-quant-mirror/     shared Auto-Quant source mirror
├── state/
│   ├── guardian.lock          launcher ownership
│   └── runtime.lock           shared writer ownership
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
| Broker/account/execution behavior | `services/uta/src/domain/trading/` + [UTA live testing](uta-live-testing.md) |
| Shared Alice ↔ UTA shapes | `packages/uta-protocol/` and both callers |
| Renderer/API surface | `ui/`, `src/webui/`, and matching demo handlers |
| Issues, schedules, headless runs, Inbox delivery | [Workspace issues and scheduling](workspace-issues-and-scheduling.md) |
| Retired event-bus scheduler and UTA journal boundary | [Event-system retirement note](event-system.md) |
| User-state schema | `src/migrations/` + generated migration index |
| Process lock/recovery | `packages/guardian-runtime/` and all three launchers |

When current code disagrees with this guide, verify the runtime behavior and
update the guide in the same change rather than leaving a second source of
truth in `AGENTS.md`.
