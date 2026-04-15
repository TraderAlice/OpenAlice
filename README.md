<p align="center">
  <img src="docs/images/alice-full.png" alt="Open Alice" width="128">
</p>

<p align="center">
  <a href="https://github.com/TraderAlice/OpenAlice/actions/workflows/ci.yml"><img src="https://github.com/TraderAlice/OpenAlice/actions/workflows/ci.yml/badge.svg" alt="CI"></a> · <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a> · <a href="https://openalice.ai"><img src="https://img.shields.io/badge/Website-openalice.ai-blue" alt="openalice.ai"></a> · <a href="https://openalice.ai/docs"><img src="https://img.shields.io/badge/Docs-Read-green" alt="Docs"></a> · <a href="https://deepwiki.com/TraderAlice/OpenAlice"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

# Open Alice

Your one-person Wall Street. Alice is an AI trading agent that gives you your own research desk, quant team, trading floor, and risk management — all running on your laptop 24/7.

- **File-driven** — Markdown defines persona and tasks, JSON defines config, JSONL stores conversations. Both humans and AI control Alice by reading and modifying files. The same read/write primitives that power vibe coding transfer directly to vibe trading. No database, no containers, just files.
- **Reasoning-driven** — every trading decision is based on continuous reasoning and signal mixing.
- **OS-native** — Alice can interact with your operating system. Search the web through your browser, send messages via Telegram, and connect to local devices.

<p align="center">
  <img src="docs/images/preview.png" alt="Open Alice Preview" width="720">
</p>

> [!CAUTION]
> **Open Alice is experimental software in active development.** Many features and interfaces are incomplete and subject to breaking changes. Do not use this software for live trading with real funds unless you fully understand and accept the risks involved. The authors provide no guarantees of correctness, reliability, or profitability, and accept no liability for financial losses.

## Features

- **Multi-provider AI** — switch between Codex CLI, Claude (via Agent SDK with OAuth or API key), and Vercel AI SDK at runtime, no restart needed
- **Unified Trading Account (UTA)** — each trading account is a self-contained entity that owns its broker connection, git-like operation history, and guard pipeline. AI interacts with UTAs, never with brokers directly. All order types use IBKR's type system (`@traderalice/ibkr`) as the single source of truth. Supported brokers: CCXT (100+ crypto exchanges), Alpaca (US equities), Interactive Brokers (stocks, options, futures, bonds via TWS/Gateway). Each broker self-registers its config schema and UI field descriptors — adding a new broker requires zero changes to the framework
- **Trading-as-Git** — stage orders, commit with a message, push to execute. Every commit gets an 8-char hash. Full history reviewable via `tradingLog` / `tradingShow`
- **Guard pipeline** — pre-execution safety checks (max position size, cooldown, symbol whitelist) that run inside each UTA before orders reach the broker
- **Market data** — TypeScript-native OpenBB engine (`opentypebb`) with no external sidecar required. Covers equity, crypto, commodity, currency, and macro data with unified symbol search (`marketSearchForResearch`) and technical indicator calculator. Can also expose an embedded OpenBB-compatible HTTP API for external tools
- **Equity research** — company profiles, financial statements, ratios, analyst estimates, earnings calendar, insider trading, and market movers (top gainers, losers, most active)
- **News** — background RSS collection from configurable feeds with archive search tools (`globNews`/`grepNews`/`readNews`)
- **Cognitive state** — persistent "brain" with frontal lobe memory, emotion tracking, and commit history
- **Event log** — persistent append-only JSONL event log with real-time subscriptions and crash recovery
- **Cron scheduling** — event-driven cron system with AI-powered job execution and automatic delivery to the last-interacted channel
- **Evolution mode** — two-tier permission system. Normal mode sandboxes the AI to `data/brain/`; evolution mode gives full project access including Bash, enabling the agent to modify its own source code
- **Account snapshots** — periodic and event-driven account state capture with equity curve visualization. Configurable snapshot intervals and carry-forward for gaps
- **Hot-reload** — enable/disable trading accounts and connectors (Telegram, MCP Ask) at runtime without restart
- **Web UI** — local chat interface with real-time SSE streaming, sub-channels with per-channel AI config, portfolio dashboard with equity curve, and full config management. Dynamic broker config forms rendered from broker-declared schemas

## Key Concepts

**Provider** — The AI backend that powers Alice. The default is Codex CLI (`codex exec`) with Alice's MCP tools mounted into the local Codex session. Claude (via `@anthropic-ai/claude-agent-sdk`) and Vercel AI SDK are also available. Switchable at runtime via `ai-provider-manager.json`.

**Domain** — Business logic layer (`src/domain/`). Each domain module (trading, market-data, analysis, news, brain, thinking) owns its state and persistence. **Tool** (`src/tool/`) is a thin bridge layer that registers domain capabilities as AI tools in ToolCenter.

**UTA (Unified Trading Account)** — The core business entity for trading. Each UTA owns a broker connection (`IBroker`), a git-like operation history (`TradingGit`), a guard pipeline, and a snapshot scheduler. Think of it as a git repository for trades — multiple UTAs are like a monorepo with independent histories. AI and the frontend interact with UTAs exclusively; brokers are internal implementation details. All types (Contract, Order, Execution, OrderState) come from IBKR's type system via `@traderalice/ibkr`. `AccountManager` owns the full UTA lifecycle (create, reconnect, enable/disable, remove).

**Trading-as-Git** — The workflow inside each UTA. Stage operations (`stagePlaceOrder`, `stageClosePosition`, etc.), commit with a message, then push to execute. Push runs guards, dispatches to the broker, snapshots account state, and records a commit with an 8-char hash. Full history is reviewable via `tradingLog` / `tradingShow`.

**Guard** — A pre-execution check that runs inside a UTA before operations reach the broker. Guards enforce limits (max position size, cooldown between trades, symbol whitelist) and are configured per-account.

**Connector** — An external interface through which users interact with Alice. Built-in: Web UI, Telegram, MCP Ask. Connectors register with ConnectorCenter; delivery always goes to the channel of last interaction.

**Brain** — Alice's persistent cognitive state. The frontal lobe stores working memory across rounds; emotion tracking logs sentiment shifts with rationale. Both are versioned as commits.

**Heartbeat** — A periodic check-in where Alice reviews market conditions and decides whether to send you a message. Uses a structured protocol: `HEARTBEAT_OK` (nothing to report), `CHAT_YES` (has something to say), `CHAT_NO` (quiet).

**EventLog** — A persistent append-only JSONL event bus. Cron fires, heartbeat results, and errors all flow through here. Supports real-time subscriptions and crash recovery.

**Evolution Mode** — A permission escalation toggle. Off: Alice can only read/write `data/brain/`. On: full project access including Bash — Alice can modify her own source code.

## Architecture

```mermaid
graph LR
  subgraph Providers
    CX[Codex CLI]
    AS[Claude / Agent SDK]
    VS[Vercel AI SDK]
  end

  subgraph Core
    PR[ProviderRouter]
    AC[AgentCenter]
    TC[ToolCenter]
    S[Session Store]
    EL[Event Log]
    CCR[ConnectorCenter]
  end

  subgraph Domain
    MD[Market Data]
    AN[Analysis]
    subgraph UTA[Unified Trading Account]
      TR[Trading Git]
      GD[Guards]
      BK[Brokers]
      SN[Snapshots]
    end
    NC[News Collector]
    BR[Brain]
    BW[Browser]
  end

  subgraph Tasks
    CRON[Cron Engine]
    HB[Heartbeat]
  end

  subgraph Interfaces
    WEB[Web UI]
    TG[Telegram]
    MCP[MCP Server]
  end

  CX --> PR
  AS --> PR
  VS --> PR
  PR --> AC
  AC --> S
  TC -->|Vercel tools| VS
  TC -->|in-process MCP| AS
  TC -->|MCP tools| MCP
  MD --> AN
  MD --> NC
  AN --> TC
  GD --> TR
  TR --> BK
  UTA --> TC
  NC --> TC
  BR --> TC
  BW --> TC
  CRON --> EL
  HB --> CRON
  EL --> CRON
  CCR --> WEB
  CCR --> TG
  WEB --> AC
  TG --> AC
  MCP --> AC
```

**Providers** — interchangeable AI backends. Codex uses the local `codex exec` CLI and mounts Alice's MCP server into the Codex run, so the agent is genuinely Codex-driven. Claude (Agent SDK) uses `@anthropic-ai/claude-agent-sdk` with tools delivered via in-process MCP. Vercel AI SDK runs a `ToolLoopAgent` in-process with direct API calls. `ProviderRouter` reads `ai-provider-manager.json` on each call to select the active backend at runtime.

**Core** — `AgentCenter` is the top-level orchestration center that routes all calls (both stateless and session-aware) through `ProviderRouter`. `ToolCenter` is a centralized tool registry — `tool/` files register domain capabilities there, and it exports them in Vercel AI SDK and MCP formats. `EventLog` provides persistent append-only event storage (JSONL) with real-time subscriptions and crash recovery. `ConnectorCenter` tracks which channel the user last spoke through.

**Domain** — business logic modules registered as AI tools via the `tool/` bridge layer. The trading domain centers on `UnifiedTradingAccount` (UTA) — each UTA bundles a broker connection, git-like operation history, guard pipeline, and snapshot scheduler into a single entity. Guards enforce pre-execution safety checks (position size limits, trade cooldowns, symbol whitelist) inside each UTA before orders reach the broker. Snapshots capture periodic account state for equity curve tracking. `NewsCollector` runs background RSS fetches into a persistent archive searchable by the agent.

**Tasks** — scheduled background work. `CronEngine` manages jobs and fires `cron.fire` events into the EventLog on schedule; a listener picks them up, runs them through `AgentCenter`, and delivers replies via `ConnectorCenter`. `Heartbeat` is a periodic health-check that uses a structured response protocol (HEARTBEAT_OK / CHAT_NO / CHAT_YES).

**Interfaces** — external surfaces. Web UI for local chat (with SSE streaming and sub-channels), Telegram bot for mobile, MCP server for tool exposure. External agents can also [converse with Alice via a separate MCP endpoint](docs/mcp-ask-connector.md).

## Quick Start

Prerequisites: Node.js 22+, pnpm 10+, [Codex CLI](https://developers.openai.com/codex/cli) installed and authenticated.

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
codex login
corepack pnpm install && corepack pnpm build
corepack pnpm dev
```

Open [localhost:3002](http://localhost:3002) and start chatting. No API keys or extra provider setup needed — the default profile uses your local Codex CLI session.

```bash
corepack pnpm dev        # start backend (port 3002) with watch mode
corepack pnpm dev:ui     # start frontend dev server (port 5173) with hot reload
corepack pnpm build      # production build (backend + UI)
corepack pnpm test       # run tests
```

> **Note:** Port 3002 serves the UI only after `pnpm build`. For frontend development, use `pnpm dev:ui` (port 5173) which proxies to the backend and provides hot reload.

## Daily Workflow

For normal daily use, the shortest path is:

```bash
cd OpenAlice
codex login   # only when needed
corepack pnpm dev
```

Then open [localhost:3002](http://localhost:3002) and chat with the default profile. That profile now routes every turn through local Codex CLI, and Codex reaches Alice's trading, research, browser, and session tools through the built-in MCP server on port `3001`.

If you want a different backend later, open the AI Provider page in the Web UI and switch profiles there. No restart is required.

On Windows, you can use the bundled launcher instead:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-openalice.ps1
```

Or just run:

```bat
.\scripts\start-openalice.cmd
```

Or, if you prefer npm scripts:

```bash
corepack pnpm dev:codex
```

## Configuration

All config lives in `data/config/` as JSON files with Zod validation. Missing files fall back to sensible defaults. You can edit these files directly or use the Web UI.

**AI Provider** — The default provider is Codex CLI, which uses your local `codex login` session and runs Alice through `codex exec` with Alice's MCP tools attached automatically. To use Claude Agent SDK or the [Vercel AI SDK](https://sdk.vercel.ai/docs) instead, switch `ai-provider-manager.json` or use the Web UI. Providers can be switched at runtime with no restart.

**Trading** — Unified Trading Account (UTA) architecture. Each account in `accounts.json` becomes a UTA with its own broker connection, git history, and guard config. Broker-specific settings live in the `brokerConfig` field — each broker type declares its own schema and validates it internally.

| File | Purpose |
|------|---------|
| `engine.json` | Trading pairs, tick interval, timeframe |
| `agent.json` | Max agent steps, evolution mode toggle, Claude Code tool permissions |
| `ai-provider-manager.json` | Active AI provider profile (`codex`, `agent-sdk`, or `vercel-ai-sdk`), login method, switchable at runtime |
| `accounts.json` | Trading accounts with `type`, `enabled`, `guards`, and `brokerConfig` (broker-specific settings) |
| `connectors.json` | Web/MCP server ports, MCP Ask enable |
| `telegram.json` | Telegram bot credentials + enable |
| `web-subchannels.json` | Web UI sub-channel definitions with per-channel AI provider overrides |
| `tools.json` | Tool enable/disable configuration |
| `market-data.json` | Data backend (`typebb-sdk` / `openbb-api`), per-asset-class providers, provider API keys, embedded HTTP server config |
| `news.json` | RSS feeds, fetch interval, retention period |
| `snapshot.json` | Account snapshot interval and retention |
| `compaction.json` | Context window limits, auto-compaction thresholds |
| `heartbeat.json` | Heartbeat enable/disable, interval, active hours |

Persona and heartbeat prompts use a **default + user override** pattern:

| Default (git-tracked) | User override (gitignored) |
|------------------------|---------------------------|
| `default/persona.default.md` | `data/brain/persona.md` |
| `default/heartbeat.default.md` | `data/brain/heartbeat.md` |

On first run, defaults are auto-copied to the user override path. Edit the user files to customize without touching version control.

## Project Structure

Open Alice is a pnpm monorepo with Turborepo build orchestration.

```
packages/
├── ibkr/                      # @traderalice/ibkr — IBKR TWS API TypeScript port
└── opentypebb/                # @traderalice/opentypebb — OpenBB platform TS port
ui/                            # React frontend (Vite, 13 pages)
src/
├── main.ts                    # Composition root — wires everything together
├── core/
│   ├── agent-center.ts        # Top-level AI orchestration, owns ProviderRouter
│   ├── ai-provider-manager.ts # GenerateRouter + StreamableResult + AskOptions
│   ├── tool-center.ts         # Centralized tool registry (Vercel + MCP export)
│   ├── mcp-export.ts          # Shared MCP export layer with type coercion
│   ├── session.ts             # JSONL session store + format converters
│   ├── compaction.ts          # Auto-summarize long context windows
│   ├── config.ts              # Zod-validated config loader
│   ├── event-log.ts           # Append-only JSONL event log
│   ├── connector-center.ts    # ConnectorCenter — push delivery + last-interacted tracking
│   ├── async-channel.ts       # AsyncChannel for streaming provider events to SSE
│   ├── tool-call-log.ts       # Tool invocation logging
│   ├── media.ts               # MediaAttachment extraction
│   ├── media-store.ts         # Media file persistence
│   └── types.ts               # Plugin, EngineContext interfaces
├── ai-providers/
│   ├── vercel-ai-sdk/         # Vercel AI SDK ToolLoopAgent wrapper
│   ├── agent-sdk/             # Claude backend (@anthropic-ai/claude-agent-sdk, OAuth + API key)
│   └── mock/                  # Mock provider (testing)
├── domain/
│   ├── trading/               # Unified multi-account trading, guard pipeline, git-like commits
│   │   ├── account-manager.ts # UTA lifecycle (init, reconnect, enable/disable) + registry
│   │   ├── git-persistence.ts # Git state load/save
│   │   ├── brokers/
│   │   │   ├── registry.ts    # Broker self-registration (configSchema + configFields + fromConfig)
│   │   │   ├── alpaca/        # Alpaca (US equities)
│   │   │   ├── ccxt/          # CCXT (100+ crypto exchanges)
│   │   │   ├── ibkr/          # Interactive Brokers (TWS/Gateway)
│   │   │   └── mock/          # In-memory test broker
│   │   ├── git/               # Trading-as-Git engine (stage → commit → push)
│   │   ├── guards/            # Pre-execution safety checks (position size, cooldown, whitelist)
│   │   └── snapshot/          # Periodic + event-driven account state capture, equity curve
│   ├── market-data/           # Structured data layer (opentypebb in-process + OpenBB API remote)
│   │   ├── equity/            # Equity data + SymbolIndex (SEC/TMX local cache)
│   │   ├── crypto/            # Crypto data layer
│   │   ├── currency/          # Currency/forex data layer
│   │   ├── commodity/         # Commodity data layer (EIA, spot prices)
│   │   ├── economy/           # Macro economy data layer
│   │   └── client/            # Data backend clients (opentypebb SDK, openbb-api)
│   ├── analysis/              # Indicators, technical analysis
│   ├── news/                  # RSS collector + archive search
│   ├── brain/                 # Cognitive state (memory, emotion)
│   └── thinking/              # Safe expression evaluator
├── tool/                      # AI tool definitions — thin bridge from domain to ToolCenter
│   ├── trading.ts             # Trading tools (delegates to domain/trading)
│   ├── equity.ts              # Equity fundamental tools
│   ├── market.ts              # Symbol search tools
│   ├── analysis.ts            # Indicator calculation tools
│   ├── news.ts                # News archive tools
│   ├── brain.ts               # Cognition tools
│   ├── thinking.ts            # Reasoning tools
│   ├── browser.ts             # Browser automation tools (wraps openclaw)
│   └── session.ts             # Session awareness tools
├── server/
│   ├── mcp.ts                 # MCP protocol server
│   └── opentypebb.ts          # Embedded OpenBB-compatible HTTP API (optional)
├── connectors/
│   ├── web/                   # Web UI (Hono, SSE streaming, sub-channels)
│   ├── telegram/              # Telegram bot (grammY, magic link auth, /trading panel)
│   ├── mcp-ask/               # MCP Ask connector (external agent conversation)
│   └── mock/                  # Mock connector (testing)
├── task/
│   ├── cron/                  # Cron scheduling (engine, listener, AI tools)
│   └── heartbeat/             # Periodic heartbeat with structured response protocol
└── openclaw/                  # ⚠️ Frozen — DO NOT MODIFY
data/
├── config/                    # JSON configuration files
├── sessions/                  # JSONL conversation histories (web/, telegram/, cron/)
├── brain/                     # Agent memory and emotion logs
├── cache/                     # API response caches
├── trading/                   # Trading commit history + snapshots (per-account)
├── news-collector/            # Persistent news archive (JSONL)
├── cron/                      # Cron job definitions (jobs.json)
├── event-log/                 # Persistent event log (events.jsonl)
├── tool-calls/                # Tool invocation logs
└── media/                     # Uploaded attachments
default/                       # Factory defaults (persona, heartbeat, skills)
docs/                          # Documentation
```

## Roadmap to v1

Open Alice is in pre-release. All planned v1 milestones are now complete — remaining work is testing and stabilization.

- [x] **Tool confirmation** — achieved through Trading-as-Git's push approval mechanism. Order execution requires explicit user approval at the push step, similar to merging a PR
- [x] **Trading-as-Git stable interface** — the core workflow (stage → commit → push → approval) is stable and running in production
- [x] **IBKR broker** — Interactive Brokers integration via TWS/Gateway. `IbkrBroker` bridges the callback-based `@traderalice/ibkr` SDK to the Promise-based `IBroker` interface via `RequestBridge`. Supports all IBroker methods including conId-based contract resolution
- [x] **Account snapshot & analytics** — periodic and event-driven snapshots with equity curve visualization, configurable intervals, and carry-forward for data gaps

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=TraderAlice/OpenAlice&type=Date)](https://star-history.com/#TraderAlice/OpenAlice&Date)
