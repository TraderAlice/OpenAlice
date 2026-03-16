<p align="center">
  <img src="docs/images/alice-full.png" alt="Open Alice" width="128">
</p>

<p align="center">
  <a href="https://github.com/TraderAlice/OpenAlice/actions/workflows/ci.yml"><img src="https://github.com/TraderAlice/OpenAlice/actions/workflows/ci.yml/badge.svg" alt="CI"></a> · <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a> · <a href="https://deepwiki.com/TraderAlice/OpenAlice"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a> · <a href="https://traderalice.com"><img src="https://img.shields.io/badge/Website-Visit-blue" alt="traderalice.com"></a>
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

- **Multi-provider AI** — switch between Claude Code CLI, Vercel AI SDK, and Agent SDK at runtime, no restart needed
- **Unified Trading Account (UTA)** — each trading account is a self-contained entity that owns its broker connection, git-like operation history, and guard pipeline. AI interacts with UTAs, never with brokers directly. All order types use IBKR's type system (`@traderalice/ibkr`) as the single source of truth, with Alpaca and CCXT adapting to it
- **Trading-as-Git** — stage orders, commit with a message, push to execute. Every commit gets an 8-char hash. Full history reviewable via `tradingLog` / `tradingShow`
- **Guard pipeline** — pre-execution safety checks (max position size, cooldown, symbol whitelist) that run inside each UTA before orders reach the broker
- **Market data** — TypeScript-native OpenBB engine (`opentypebb`) with no external sidecar required. Covers equity, crypto, commodity, currency, and macro data with unified symbol search (`marketSearchForResearch`) and technical indicator calculator. Can also expose an embedded OpenBB-compatible HTTP API for external tools
- **Equity research** — company profiles, financial statements, ratios, analyst estimates, earnings calendar, insider trading, and market movers (top gainers, losers, most active)
- **News** — background RSS collection from configurable feeds with archive search tools (`globNews`/`grepNews`/`readNews`)
- **Cognitive state** — persistent "brain" with frontal lobe memory, emotion tracking, and commit history
- **Event log** — persistent append-only JSONL event log with real-time subscriptions and crash recovery
- **Cron scheduling** — event-driven cron system with AI-powered job execution and automatic delivery to the last-interacted channel
- **Evolution mode** — two-tier permission system. Normal mode sandboxes the AI to `data/brain/`; evolution mode gives full project access including Bash, enabling the agent to modify its own source code
- **Hot-reload** — enable/disable connectors (Telegram, MCP Ask) and reconnect trading engines at runtime without restart
- **Web UI** — local chat interface with real-time SSE streaming, sub-channels with per-channel AI config, portfolio dashboard, and full config management (trading, data sources, connectors, AI provider, heartbeat, tools)

## Key Concepts

**Provider** — The AI backend that powers Alice. Claude Code (subprocess), Vercel AI SDK (in-process), or Agent SDK (`@anthropic-ai/claude-agent-sdk`). Switchable at runtime via `ai-provider.json`.

**Extension** — A self-contained tool package registered in ToolCenter. Each extension owns its tools, state, and persistence. Examples: trading, brain, analysis-kit.

**UTA (Unified Trading Account)** — The core business entity for trading. Each UTA owns a broker connection (`IBroker`), a git-like operation history (`TradingGit`), and a guard pipeline. Think of it as a git repository for trades — multiple UTAs are like a monorepo with independent histories. AI and the frontend interact with UTAs exclusively; brokers are internal implementation details. All types (Contract, Order, Execution, OrderState) come from IBKR's type system via `@traderalice/ibkr`.

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
    CC[Claude Code CLI]
    VS[Vercel AI SDK]
    AS[Agent SDK]
  end

  subgraph Core
    PR[ProviderRouter]
    AC[AgentCenter]
    TC[ToolCenter]
    S[Session Store]
    EL[Event Log]
    CCR[ConnectorCenter]
  end

  subgraph Extensions
    OBB[OpenBB Data]
    AK[Analysis Kit]
    subgraph UTA[Unified Trading Account]
      TR[Trading Git]
      GD[Guards]
      BK[Brokers]
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

  CC --> PR
  VS --> PR
  AS --> PR
  PR --> AC
  AC --> S
  TC -->|Vercel tools| VS
  TC -->|MCP tools| MCP
  OBB --> AK
  OBB --> NC
  AK --> TC
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

**Providers** — interchangeable AI backends. Claude Code spawns `claude -p` as a subprocess; Vercel AI SDK runs a `ToolLoopAgent` in-process; Agent SDK uses `@anthropic-ai/claude-agent-sdk`. `ProviderRouter` reads `ai-provider.json` on each call to select the active backend at runtime.

**Core** — `AgentCenter` is the top-level orchestration center that routes all calls (both stateless and session-aware) through `ProviderRouter`. `ToolCenter` is a centralized tool registry — extensions register tools there, and it exports them in Vercel AI SDK and MCP formats. `EventLog` provides persistent append-only event storage (JSONL) with real-time subscriptions and crash recovery. `ConnectorCenter` tracks which channel the user last spoke through.

**Extensions** — domain-specific tool sets registered in `ToolCenter`. Each extension owns its tools, state, and persistence. The trading extension centers on `UnifiedTradingAccount` (UTA) — each UTA bundles a broker connection, git-like operation history, and guard pipeline into a single entity. Guards enforce pre-execution safety checks (position size limits, trade cooldowns, symbol whitelist) inside each UTA before orders reach the broker. `NewsCollector` runs background RSS fetches into a persistent archive searchable by the agent.

**Tasks** — scheduled background work. `CronEngine` manages jobs and fires `cron.fire` events into the EventLog on schedule; a listener picks them up, runs them through `AgentCenter`, and delivers replies via `ConnectorCenter`. `Heartbeat` is a periodic health-check that uses a structured response protocol (HEARTBEAT_OK / CHAT_NO / CHAT_YES).

**Interfaces** — external surfaces. Web UI for local chat (with SSE streaming and sub-channels), Telegram bot for mobile, MCP server for tool exposure. External agents can also [converse with Alice via a separate MCP endpoint](docs/mcp-ask-connector.md).

## Quick Start

Prerequisites: Node.js 22+, pnpm 10+, [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install && pnpm build
pnpm dev
```

Open [localhost:3002](http://localhost:3002) and start chatting. No API keys or config needed — the default setup uses Claude Code as the AI backend with your existing login.

```bash
pnpm dev        # start backend (port 3002) with watch mode
pnpm dev:ui     # start frontend dev server (port 5173) with hot reload
pnpm build      # production build (backend + UI)
pnpm test       # run tests
```

> **Note:** Port 3002 serves the UI only after `pnpm build`. For frontend development, use `pnpm dev:ui` (port 5173) which proxies to the backend and provides hot reload.

## Configuration

All config lives in `data/config/` as JSON files with Zod validation. Missing files fall back to sensible defaults. You can edit these files directly or use the Web UI.

**AI Provider** — The default provider is Claude Code (`claude -p` subprocess). To use the [Vercel AI SDK](https://sdk.vercel.ai/docs) instead (Anthropic, OpenAI, Google, etc.), switch `ai-provider.json` to `vercel-ai-sdk` and add your API key to `api-keys.json`. A third option, Agent SDK (`@anthropic-ai/claude-agent-sdk`), is also available via `agent-sdk`.

**Trading** — Unified Trading Account (UTA) architecture. Define platforms in `platforms.json` (CCXT exchanges, Alpaca), then create accounts in `accounts.json` referencing a platform. Each account becomes a UTA with its own git history and guard config. Legacy `crypto.json` and `securities.json` are still supported.

| File | Purpose |
|------|---------|
| `engine.json` | Trading pairs, tick interval, timeframe |
| `agent.json` | Max agent steps, evolution mode toggle, Claude Code tool permissions |
| `ai-provider.json` | Active AI provider (`claude-code`, `vercel-ai-sdk`, or `agent-sdk`), switchable at runtime |
| `api-keys.json` | AI provider API keys (Anthropic, OpenAI, Google) — only needed for Vercel AI SDK mode |
| `platforms.json` | Trading platform definitions (CCXT exchanges, Alpaca) |
| `accounts.json` | Trading account credentials and guard config, references platforms |
| `crypto.json` | CCXT exchange config + API keys, allowed symbols, guards |
| `securities.json` | Alpaca broker config + API keys, allowed symbols, guards |
| `connectors.json` | Web/MCP server ports, MCP Ask enable |
| `telegram.json` | Telegram bot credentials + enable |
| `web-subchannels.json` | Web UI sub-channel definitions with per-channel AI provider overrides |
| `tools.json` | Tool enable/disable configuration |
| `market-data.json` | Data backend (`typebb-sdk` / `openbb-api`), per-asset-class providers, provider API keys, embedded HTTP server config |
| `news.json` | RSS feeds, fetch interval, retention period |
| `compaction.json` | Context window limits, auto-compaction thresholds |
| `heartbeat.json` | Heartbeat enable/disable, interval, active hours |

Persona and heartbeat prompts use a **default + user override** pattern:

| Default (git-tracked) | User override (gitignored) |
|------------------------|---------------------------|
| `data/default/persona.default.md` | `data/brain/persona.md` |
| `data/default/heartbeat.default.md` | `data/brain/heartbeat.md` |

On first run, defaults are auto-copied to the user override path. Edit the user files to customize without touching version control.

## Project Structure

```
src/
  main.ts                    # Composition root — wires everything together
  core/
    agent-center.ts          # Top-level AI orchestration center, owns ProviderRouter
    ai-provider.ts           # AIProvider interface + ProviderRouter (runtime switching)
    tool-center.ts           # Centralized tool registry (Vercel + MCP export)
    ai-config.ts             # Runtime provider config read/write
    model-factory.ts         # Model instance factory for Vercel AI SDK
    session.ts               # JSONL session store + format converters
    compaction.ts            # Auto-summarize long context windows
    config.ts                # Zod-validated config loader
    event-log.ts             # Persistent append-only event log (JSONL)
    connector-center.ts      # ConnectorCenter — push delivery + last-interacted tracking
    async-channel.ts         # AsyncChannel for streaming provider events to SSE
    provider-utils.ts        # Shared provider utilities (session conversion, tool bridging)
    media.ts                 # MediaAttachment extraction from tool outputs
    media-store.ts           # Media file persistence
    types.ts                 # Plugin, EngineContext interfaces
  ai-providers/
    claude-code/             # Claude Code CLI subprocess wrapper
    vercel-ai-sdk/           # Vercel AI SDK ToolLoopAgent wrapper
    agent-sdk/               # Agent SDK (@anthropic-ai/claude-agent-sdk) wrapper
  extension/
    analysis-kit/            # Indicator calculator and market data tools
    equity/                  # Equity fundamentals and data adapter
    market/                  # Unified symbol search across equity, crypto, currency
    news/                    # RSS collector, archive search tools
    trading/                 # Unified Trading Account (UTA): brokers, git-like commits, guards, AI tool adapter
      UnifiedTradingAccount.ts  # UTA class — owns broker + git + guards
      brokers/               # IBroker interface + Alpaca/CCXT implementations
      git/                   # Trading-as-Git engine (stage → commit → push)
      guards/                # Pre-execution safety checks (position size, cooldown, whitelist)
      adapter.ts             # AI tool definitions (Zod schemas → UTA methods)
      account-manager.ts     # Multi-UTA registry and routing
    thinking-kit/            # Reasoning and calculation tools
    brain/                   # Cognitive state (memory, emotion)
    browser/                 # Browser automation bridge (via OpenClaw)
  openbb/
    sdk/                     # In-process opentypebb SDK clients (equity, crypto, currency, news, economy, commodity)
    api-server.ts            # Embedded OpenBB-compatible HTTP server (optional, port 6901)
    equity/                  # Equity data layer + SymbolIndex (SEC/TMX local cache)
    crypto/                  # Crypto data layer
    currency/                # Currency/forex data layer
    commodity/               # Commodity data layer (EIA, spot prices)
    economy/                 # Macro economy data layer
    news/                    # News data layer
    credential-map.ts        # Maps config key names to OpenBB credential field names
  connectors/
    web/                     # Web UI chat (Hono, SSE streaming, sub-channels)
    telegram/                # Telegram bot (grammY, polling, commands)
    mcp-ask/                 # MCP Ask connector (external agent conversation)
  task/
    cron/                    # Cron scheduling (engine, listener, AI tools)
    heartbeat/               # Periodic heartbeat with structured response protocol
  plugins/
    mcp.ts                   # MCP server for tool exposure
  skills/                    # Agent skill definitions
  openclaw/                  # Browser automation subsystem (frozen)
data/
  config/                    # JSON configuration files
  default/                   # Factory defaults (persona, heartbeat prompts)
  sessions/                  # JSONL conversation histories
  brain/                     # Agent memory and emotion logs
  cache/                     # API response caches
  trading/                   # Trading commit history (per-account)
  news-collector/            # Persistent news archive (JSONL)
  cron/                      # Cron job definitions (jobs.json)
  event-log/                 # Persistent event log (events.jsonl)
docs/                        # Architecture documentation
```

## Roadmap to v1

Open Alice is in pre-release. The following items must land before the first stable version:

- [ ] **Tool confirmation** — sensitive tools (order placement, cancellation, position close) require explicit user confirmation before execution, with a per-tool bypass mechanism for trusted workflows
- [ ] **Trading-as-Git stable interface** — the UTA class and git workflow are functional; remaining work is serialization format (FIX-like tag-value encoding for Operation persistence) and the `tradingSync` polling loop
- [ ] **IBKR broker** — Interactive Brokers integration via TWS API. The `@traderalice/ibkr` TypeScript SDK (full TWS protocol port) is complete; remaining work is implementing `IBroker` against it
- [ ] **Account snapshot & analytics** — unified trading account snapshots with P&L breakdown, exposure analysis, and historical performance tracking

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=TraderAlice/OpenAlice&type=Date)](https://star-history.com/#TraderAlice/OpenAlice&Date)