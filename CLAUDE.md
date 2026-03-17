# Open Alice

File-driven AI trading agent. All state (sessions, config, logs) stored as files — no database.

## Quick Start

```bash
pnpm install
pnpm dev        # Dev mode (tsx watch, port 3002)
pnpm build      # Production build (backend + UI)
pnpm test       # Vitest
```

## Project Structure

```
src/
├── main.ts                    # Composition root
├── core/
│   ├── agent-center.ts        # Top-level AI orchestration, owns GenerateRouter
│   ├── ai-provider-manager.ts # GenerateRouter + StreamableResult + AskOptions
│   ├── tool-center.ts         # Centralized tool registry (Vercel + MCP export)
│   ├── session.ts             # JSONL session store
│   ├── compaction.ts          # Auto-summarize long context windows
│   ├── config.ts              # Zod-validated config loader
│   ├── ai-config.ts           # Runtime AI provider selection
│   ├── event-log.ts           # Append-only JSONL event log
│   ├── connector-center.ts    # ConnectorCenter — push delivery + last-interacted tracking
│   ├── async-channel.ts       # AsyncChannel for streaming provider events to SSE
│   ├── model-factory.ts       # Model instance factory for Vercel AI SDK
│   ├── media.ts               # MediaAttachment extraction
│   ├── media-store.ts         # Media file persistence
│   └── types.ts               # Plugin, EngineContext interfaces
├── ai-providers/
│   ├── claude-code/           # Claude Code CLI subprocess
│   ├── vercel-ai-sdk/         # Vercel AI SDK ToolLoopAgent
│   └── agent-sdk/             # Agent SDK (@anthropic-ai/claude-agent-sdk)
├── domain/
│   ├── market-data/           # Structured data layer (typebb in-process + OpenBB API remote)
│   ├── trading/               # Unified multi-account trading, guard pipeline, git-like commits
│   ├── analysis/              # Indicators, technical analysis, sandbox
│   ├── news/                  # RSS collector + archive search
│   ├── brain/                 # Cognitive state (memory, emotion)
│   └── thinking/              # Safe expression evaluator
├── tool/                      # AI tool definitions — thin bridge from domain to ToolCenter
│   ├── trading.ts             # Trading tools (delegates to domain/trading)
│   ├── equity.ts              # Equity fundamental tools (uses domain/market-data)
│   ├── market.ts              # Symbol search tools (uses domain/market-data)
│   ├── analysis.ts            # Indicator calculation tools (uses domain/analysis)
│   ├── news.ts                # News archive tools (uses domain/news)
│   ├── brain.ts               # Cognition tools (uses domain/brain)
│   ├── thinking.ts            # Reasoning tools (uses domain/thinking)
│   └── browser.ts             # Browser automation tools (wraps openclaw)
├── connectors/
│   ├── web/                   # Web UI (Hono, SSE streaming, sub-channels)
│   ├── telegram/              # Telegram bot (grammY)
│   └── mcp-ask/               # MCP Ask connector
├── plugins/
│   └── mcp.ts                 # MCP protocol server
├── task/
│   ├── cron/                  # Cron scheduling
│   └── heartbeat/             # Periodic heartbeat
├── skills/                    # Agent skill definitions
└── openclaw/                  # ⚠️ Frozen — DO NOT MODIFY
```

## Key Architecture

### AgentCenter → GenerateRouter → GenerateProvider

Two layers (Engine was removed):

1. **AgentCenter** (`core/agent-center.ts`) — top-level orchestration. Manages sessions, compaction, and routes calls through GenerateRouter. Exposes `ask()` (stateless) and `askWithSession()` (with history).

2. **GenerateRouter** (`core/ai-provider-manager.ts`) — reads `ai-provider.json` on each call, resolves to active provider. Three backends:
   - Claude Code CLI (`inputKind: 'text'`)
   - Vercel AI SDK (`inputKind: 'messages'`)
   - Agent SDK (`inputKind: 'text'`)

**AIProvider interface**: `ask(prompt)` for one-shot, `generate(input, opts)` for streaming `ProviderEvent` (tool_use / tool_result / text / done). Optional `compact()` for provider-native compaction.

**StreamableResult**: dual interface — `PromiseLike` (await for result) + `AsyncIterable` (for-await for streaming). Multiple consumers each get independent cursors.

Per-request provider and model overrides via `AskOptions.provider` and `AskOptions.vercelAiSdk` / `AskOptions.agentSdk`.

### ConnectorCenter

`connector-center.ts` manages push channels (Web, Telegram, MCP Ask). Tracks last-interacted channel for delivery routing.

### ToolCenter

Centralized registry. `tool/` files register tools via `ToolCenter.register()`, exports in Vercel and MCP formats. Decoupled from AgentCenter.

## Conventions

- ESM only (`.js` extensions in imports), path alias `@/*` → `./src/*`
- Strict TypeScript, ES2023 target
- Zod for config, TypeBox for tool parameter schemas
- `decimal.js` for financial math
- Pino logger → `logs/engine.log`

## Git Workflow

- `origin` = `TraderAlice/OpenAlice` (production)
- `dev` branch for all development, `master` only via PR
- **Never** force push master, **never** push `archive/dev` (contains old API keys)
- CLAUDE.md is **committed to the repo and publicly visible** — never put API keys, personal paths, or sensitive information in it
