# Project Structure

OpenAlice is a pnpm monorepo with Turborepo build orchestration.

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
