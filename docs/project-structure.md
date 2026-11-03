# Project Structure

This guide owns process boundaries, source-tree ownership, persistent-state
layout, and change routing. Update it when a top-level subsystem, long-lived
process, package, or state root moves.

## Runtime topology

An **AliceProject** owns one complete `OPENALICE_HOME`, one Guardian tree, one
Alice backend, and one logical frontend endpoint. Browser windows attach to that
endpoint; they are not additional backends. Concurrent AliceProjects require
separate complete homes.

```text
Guardian
├── Runtime control           versioned status and self-owned Server stop
├── Alice                     Workspace runtime and product/API process
│   ├── Web UI transport      HTTP/Vite dev; app:// + IPC in Electron
│   ├── Agent processes      native coding CLIs, PTY, Web, and headless
│   ├── ToolCenter           market, news, analysis, Inbox, UTA bridges
│   └── file-backed state    config, Sessions, Issues, schedules, journals
├── UTA                      optional broker carrier and trading authority
└── Connector Service        optional external Inbox/chat adapters
```

Launchers share this ownership model:

- `scripts/guardian/dev.ts` supervises development services and Vite.
- `apps/desktop/src/main.ts` is the packaged Electron Guardian/renderer host.
- `scripts/guardian/prod.mjs` supervises built Runtime services.
- `packages/guardian-runtime/` owns single-writer locks, heartbeat/process
  identity, and controlled takeover across launchers.

UTA may be disabled in lite/read-only mode. Alice and Workspaces remain usable;
only broker/trading capabilities disappear. Connector is likewise optional and
must not gate Inbox or Chat.

Native coding-agent CLIs own model loops. Alice owns launch, context injection,
and secret-free Session bindings. New Agent-facing capabilities belong in
templates, Skills, or satellite repositories, not a parallel workflow engine.

## Source ownership

```text
src/                           Alice process
├── main.ts                    composition root
├── core/                      config, credentials, paths, ToolCenter, Inbox,
│                              sealing, runtime profile, journals
├── ai-providers/              credential catalogs and model semantics
├── domain/                    market data, analysis, news, thinking
├── tool/                      Agent-facing tool definitions and bridges
├── workspaces/                Sessions, execution, templates, adapters,
│   │                          Issues, schedules, CLI shims, file/Git operations
│   ├── adapters/              native CLI launch/projection and Web protocols
│   ├── cli/                   alice, alice-uta, traderhub public shims
│   └── templates/             Chat and source-backed Harness definitions
├── services/
│   ├── auth/                  admin token and Web Sessions
│   ├── uta-client/            Alice-side UTA SDK adapters
│   └── uta-supervisor/        UTA health/restart signaling
├── server/                    local CLI/tool gateways and compatibility mounts
├── webui/                     Hono routes, auth middleware, Workspace transport
└── migrations/                versioned persisted-state migrations

services/uta/                  UTA process and broker/trading domain
services/connector/            optional Connector Service
packages/
├── cli/                       installable local Runtime/connection CLI
├── guardian-runtime/          process ownership and recovery primitives
├── connector-protocol/        Alice ↔ Connector schemas and client
├── uta-protocol/              Alice ↔ UTA schemas and wire types
├── ibkr/                      UTA-owned IBKR wire protocol
├── uta-broker-*/              optional broker-engine release wrappers
└── opentypebb/                embedded market-data compatibility

ui/                            React/Vite renderer
apps/desktop/                  Electron main/preload/IPC shell
apps/landing/                  public website, user documentation, and blog
scripts/guardian/              dev/prod supervisors and recovery tests
tests/                         registered integration/E2E suites and gates
default/                       shipped Skills and factory defaults
docs/                          owner guides and contributor documentation
```

`src/ai-providers/` is not an inference engine. Provider/model semantics and
adapter projection follow [[docs/alice-harness.md]].

## Workspace boundary

A Workspace is a durable directory and Git repository plus Sessions, Issues,
schedules, and Agent configuration. The launcher supplies reusable execution;
work and new domain capabilities live in Workspace files, templates, Skills,
and satellite repositories.

Coding-agent adapters are installation capabilities, not Workspace identity.
Every registered adapter is eligible in every active Workspace; readiness is
checked at selection. Workspace registry/lifecycle rows do not persist adapter
allowlists.

Chat, AutoQuant, and Auto Prediction use the same durable Workspace and Session
boundaries. Chat may maintain a recent-Workspace pointer; AutoQuant and Auto
Prediction require explicit readiness pointers and never guess a desk on send.
Source-backed Harnesses retain their own upstream repository, business state,
and lifecycles. Alice supervises declared web capabilities through the shared
contract in [[docs/alice-harness.md]] rather than reproducing them.

The active floor contains active Workspace checkouts only. Do not reintroduce
automatic date-based Chat Workspaces: a date is not a context boundary and
would strand files, Issues, Git history, and configuration.

Execution identities remain distinct:

- `resumeId`: canonical product Session across interactive/headless turns;
- `SessionRecord.id`: one durable launcher roster/process-attachment row;
- `taskId`: one headless execution;
- `agentSessionId`: backend-only native CLI conversation locator.

Changing surface never creates another product Session or roster row.
Provenance and reconstruction rules belong to
[[docs/workspace-lifecycle.md]].

Built-in templates use cross-platform `bootstrap.mjs` and shared Git helpers;
do not add Bash bootstraps for built-ins. Source-backed Harnesses record an
immutable source receipt. Workspace tools are exposed through the three public
CLI shims `alice`, `alice-uta`, and `traderhub`; live CLI manifests own verbs and
flags. `.agents/skills` is primary and `.claude/skills` its runtime mirror.
Secret-bearing native provider/rollback files remain excluded from Git.

## Alice ↔ UTA boundary

UTA is the only owner of broker connections and trading writes. Alice crosses
`@traderalice/uta-protocol` over local HTTP:

- `services/uta/src/domain/trading/` owns broker implementations, account state,
  approval/Git semantics, FX, and snapshots.
- `packages/uta-broker-*/` package optional live engines separately; production
  resolves them from `<OPENALICE_HOME>/runtime/broker-packs/`.
- `src/services/uta-client/` presents the remote boundary as SDK adapters.
- `src/tool/trading.ts` is a thin Agent bridge, not a broker domain.
- Alice `/api/trading/*` routes proxy rather than implement trades.
- `data/control/restart-uta.flag` signals Guardian for restart-required config.

Alice availability is not UTA/broker health. An absent Broker Pack disables only
dependent accounts/data sources, not UTA Core or other engines.

## Tools and delivery

`src/core/tool-center.ts` owns the registry;
`src/core/workspace-tool-center.ts` binds Workspace identity before exposure.
Scheduled and attended work share the Workspace execution plane:

```text
Issue/schedule -> headless Workspace run -> native Agent -> Inbox delivery
```

Inbox is durable Agent-to-user delivery. Alice stamps product Session and
execution origin out-of-band. Follow-up opens the existing product Session,
regardless of whether its first turn was interactive or headless.

## Persistent state

Guardian injects one resolved complete home into child processes.
`~/.openalice` is the conventional implicit local home, never a fallback for an
unavailable resolved Supervisor Default. The machine-local Supervisor registry
and shared Machine/AliceProject Default live outside every project home.

```text
<OPENALICE_HOME>/
├── data/                      portable user data
│   ├── config/                JSON config and migration journal
│   ├── sessions/              Web/admin Sessions
│   ├── trading/               account history and snapshots
│   ├── inbox/                 Inbox records and follow-up queue
│   ├── office/                Office shift and evidence receipts
│   ├── event-log/             UTA health/snapshot journal
│   ├── cron/                  schedules/jobs
│   ├── news-collector/        RSS archive
│   └── _backup/               migration snapshots
├── workspaces/                default launcher root
│   ├── workspaces.json        active Workspace registry
│   ├── workspaces/            active repositories only
│   ├── departed-workspaces/   retained offboarded repositories
│   ├── state/                 Catalog, Sessions, tasks, provenance, journals
│   └── auto-quant-v2-mirror/  shared source mirror
├── state/                     Guardian and Runtime ownership locks
├── runtime/broker-packs/      replaceable platform-specific broker SDKs
├── provider-keys.json         user-global AI credentials
└── sealing.key                machine-bound key, deliberately outside data/
```

`AQ_LAUNCHER_ROOT` moves only the Workspace root; `OPENALICE_GLOBAL_DIR` moves
the global provider-key store; `OPENALICE_APP_HOME` points to replaceable app
resources. Never select a project by moving only `data/`: Workspaces, locks,
credentials, sealing, and Broker Packs must remain coherent.

`data/` is the portable backup/migration unit, but its sealed contents need the
separate machine key. Shipped persisted-shape changes use idempotent migrations
in `src/migrations/`, declare affected paths for the generated index, and test
backup behavior. Unreleased development shapes are replaced directly.

## Change routing

| Change | Start with |
|---|---|
| Workspace execution, Agent launch, managed runtime, PATH | `src/workspaces/` + [[docs/managed-workspace-runtime.md]] |
| Offboarding, restore/purge, Session retirement, template upgrade, absorb | [[docs/workspace-lifecycle.md]] |
| Broker/account/execution behavior, Broker Packs, IBKR wire protocol | `services/uta/src/domain/trading/` + [[docs/uta-live-testing.md]] |
| Shared Alice ↔ UTA shapes | `packages/uta-protocol/` and both callers |
| External Inbox/chat adapters | [[docs/connector-service.md]] |
| Renderer/API surface | `ui/`, `src/webui/`, and matching demo handlers |
| Public website/user tutorials | `apps/landing/` + [[apps/landing/AGENTS.md]] |
| Issues, schedules, headless runs, Inbox, activity journal | [[docs/workspace-issues-and-scheduling.md]] |
| User-state schema | `src/migrations/` + generated index |
| Process locks/optional-service supervision | `packages/guardian-runtime/` and all launchers |
| AliceProject selection/complete homes and local runtime bootstrap | [[docs/alice-project.md]] and startup owners |

Test policy lives in [[docs/testing.md]] and `tests/gates.json`. Current code,
tests, and runtime behavior override stale prose; update this guide only when a
boundary or load-bearing path actually changes.
