# Changelog

All notable changes to OpenAlice will be documented in this file.

## [Unreleased]

### Config

- Default crypto to bybit demo, securities to alpaca paper with tickers

### Merge

- Unified trading architecture + AGPL-3.0 relicense

### ⚙️ CI

- Add GitHub Actions workflow and fix time-sensitive test

### ⚡ Performance

- Decouple CCXT init from startup, allow plugins to start immediately

### 🎨 UI

- Polish frontend design — chat input, sidebar, card system
- Round 2 polish — shared components, transitions, table hover
- Round 3 polish — toast system, send spinner, mobile fixes

### 🐛 Bug Fixes

- Inject persona + brain state into Claude Code provider
- Extract assistant text when Claude Code result is empty
- Align SettingsPanel with actual backend config structure
- Use --disallowedTools instead of --allowedTools for evolution mode
- Restore --allowedTools and hot-reload evolutionMode
- **ui**: Batch quality fixes — XSS, toggle, SSE dedup, error feedback
- Default mcpPort to 3001 so MCP tools server always starts
- Inject MCP tool permissions via --allowedTools, gitignore .claude/
- Skip crypto trading tools when engine is null
- **openbb**: Remove commodity from provider config, fix provider option lists
- Pass ccxt options under `options` key instead of spreading at top level
- **tools**: Set correct providers for equity fundamental and news tools
- **openbb**: Split news providers and handle 204 No Content
- Make MCP Server always-on — Claude Code provider depends on it for tools
- **test**: Update engine.spec.ts to match new VercelAIProvider constructor
- Connectors config auto-init and migration defaults
- Derive validSections from sectionSchemas to prevent config API drift
- **news-collector**: Retry RSS fetch once on failure
- **docs**: Replace Mermaid & syntax for broader renderer compatibility
- SSE stability — auto-reconnect with exponential backoff
- Clarify searchContracts/getContractDetails tool descriptions
- Update stale equitySearch/cryptoSearch references in tool descriptions
- Soften marketSearchForResearch description to avoid mandatory pre-search
- Seed platforms.json + accounts.json to disk on legacy migration
- Sequential loadMarkets with per-type retries for CCXT
- Add init retry with exponential backoff for AlpacaAccount
- Enforce aliceId as required contract identifier for trading tools
- **opentypebb**: Point exports to src/ so tsx resolves without build
- Upgrade opentypebb hono 4.7.4 → 4.12.7 to resolve type mismatch
- Allow 'agent-sdk' in backend switch API validation
- **ui**: Persist streamed tool calls and show thinking dots during text generation
- **ci**: Let pnpm version come from package.json packageManager field
- **streaming**: Push intermediate text events from Claude Code and Agent SDK providers
- **session**: Persist intermediate text blocks during tool loops

### 📚 Documentation

- Sync README with recent features
- Document Web UI dev workflow and dual-port architecture
- Sync README with OpenBB integration and provider default change
- Overhaul README to reflect recent architecture changes
- Delete stale scheduling.md, fix mcp-ask config section
- Add Key Concepts glossary and simplify Quick Start
- Delete stale scheduling_zh.md
- Remove dead live demo link, update header badges
- Add browser tool description prefix clarifying Chrome extension requirement
- Update README for unified trading architecture and AGPL-3.0
- Update README to reflect TypeScript-native OpenBB engine
- Update README for Engine removal, Agent SDK, and ConnectorCenter rename
- Add CI and license badges, remove redundant license section
- Add contributing guide (issues welcome, PRs not accepted)

### 🔧 Refactoring

- Split persona/heartbeat into default + user override
- Move Settings from slide drawer to dedicated page tab
- Unify AI provider default into Zod config system
- **ui**: Replace header tabs with sidebar navigation and widescreen layout
- Split analysis-kit into thinking-kit + analysis-tools
- Split Sandbox into KlineStore + NewsStore
- Merge analysis-kit + analysis-tools into archive-analysis
- Disconnect archive-analysis from runtime
- Remove lookback from indicator formula, use interval-based data window
- Extract unified indicator calculator to extension/analysis-kit
- **openbb**: Per-asset-class default provider instead of single global default
- **ui**: Extract shared form components and deduplicate config pages
- Absorb archive-analysis into news-collector, delete dead module
- Remove trading whitelist, replace with optional symbol-whitelist guard
- Consolidate AI provider config into single file and dedicated page
- Unify connector interface with structured delivery
- Introduce ConnectorCenter to centralize outbound notification logic
- Event-driven interaction tracking in ConnectorCenter
- Simplify heartbeat status to binary HEARTBEAT_OK / CHAT_YES
- Rename wallet* to trading*, make commit/push/sync source optional
- Provider tool injection + slim AccountCapabilities
- Remove adjustLeverage and leverage from OrderRequest
- IBKR-aligned OrderRequest + modifyOrder + dead code cleanup
- Split resolveContract into searchContracts + getContractDetails
- Unify equitySearch + cryptoSearch + currencySearch into marketSearchForResearch
- Merge platform into account flow in TradingPage
- Replace slide panel with centered modal dialogs
- Split CcxtAccount into smaller modules
- Split AlpacaAccount into smaller modules
- **ai-provider**: Align VercelAIProvider with ClaudeCodeProvider interface
- **ui**: Redesign DataSourcesPage with two distinct conceptual zones
- AgentCenter becomes orchestration center, providers slim down, Engine deleted
- **persistence**: Unify session persistence in AgentCenter

### 🚀 Features

- Add MCP Ask connector for external agent conversation
- Add evolution mode — two-tier permission system
- Auto-seed config files on first startup, untrack from git
- **ui**: Add responsive sidebar — collapse to hamburger menu on narrow screens
- **ui**: Add section descriptions to Settings and fix nav highlight
- **ui**: Beautify chat — ChatGPT/Claude-style layout, code copy, animations
- **ui**: Polish layout — SVG sidebar icons, Alice avatar, message grouping, safe area
- Add OpenBB equity data layer (src/openbb/equity)
- Equity symbol search with local regex index
- Equity indicator calculator with OpenBB data
- Make interval a required parameter in indicator formula syntax
- Add OpenBB crypto data layer (types + client)
- Add OpenBB commodity data layer (types + client)
- Add EIA petroleum status and energy outlook endpoints to commodity client
- Add OpenBB currency data layer (types + client)
- Add crypto search tool (adapter layer)
- Add currency search tool (adapter layer)
- Register crypto search, currency search, and analysis-kit tools
- Add Data Sources page with connection test and provider key management
- **web**: Render tool calls as collapsible groups in chat history
- Add multi-provider model support with hot-reload
- **openbb**: Inject provider credentials via HTTP header and add economy client
- **ui**: Expand provider keys to 8 providers with descriptions
- **ui**: Add per-provider Test button for API key validation
- **ccxt**: Add ticker, funding rate queries and fix realizedPnL
- **ccxt**: Expose order book depth query for liquidity evaluation
- **alpaca**: Add real-time quote and native closePosition
- **crypto**: Add extensible guard pipeline for trading operations
- **ui**: Add Crypto Trading config page with exchange and guard management
- **ui**: Replace manual save buttons with auto-save and debounce
- **securities**: Add extensible guard pipeline for trading operations
- **ui**: Add Securities Trading config page with broker and guard management
- **openbb**: Add News client and complete Commodity client coverage
- **tools**: Expose equity fundamentals and news tools to AI loop
- **ui**: Add Portfolio Dashboard + split routes and API into domain modules
- **ui**: Add card-based SDK selector and enable/disable toggles to trading pages
- **ui**: Add sidebar nested navigation for trading config pages
- Consolidate connector configs into connectors.json with enable/disable toggles
- **ui**: Multi-select card grid for connectors enable/disable
- **news-collector**: Add persistent news collection with RSS and OpenBB piggyback
- Hot-reload connector enable/disable without restart
- **ui**: Add News Collector section to DataSourcesPage with enable/disable cards
- Add Custom provider option for relay/proxy endpoints
- Add /dev debug page + rename deliver() to send() with kind
- Persist push messages to session for history survival
- Persistent media store with 3-word content-addressable names
- Image ContentBlock + date-based media storage
- Add paginated event log with full disk history
- Add dedicated Heartbeat page with config, prompt editor, and recent events
- Add Tool Panel for granular tool enable/disable with hot-reload
- Add unified trading types — Contract, ITradingAccount, AccountManager, TradingGit
- Add unified guard pipeline — merge crypto + securities guards
- Unified trading architecture — provider adapters, tool factory, main.ts rewrite
- Add test coverage, fix CCXT bug, merge frontend trading UI
- Unified multi-account tool routing with source parameter
- Aggregate getQuote across all accounts
- Add read-only mode to CcxtAccount for keyless market data access
- Introduce Platform layer for multi-account trading
- Trading config CRUD API + table/panel UI redesign
- Alpaca realized PnL via FILL activities + Portfolio page redesign
- Add React Router for URL-based navigation
- Replace Python OpenBB sidecar with in-process OpenTypeBB SDK
- **openbb**: Add backend selector and embedded API server support
- **opentypebb**: Add ~40 economy/commodity routes with FRED, OECD, BLS, EIA providers
- **web**: Add sub-channel support with per-channel AI config
- **ui**: Redesign channel UI with popover + config modal
- Per-channel Vercel AI SDK model override (provider/model/baseUrl/apiKey)
- Add Agent SDK as third AI provider backend
- **ui**: Add Agent SDK to frontend provider UI
- Add streaming event layer to AI providers
- **ui**: Consume SSE streaming events for real-time AI response progress

### 🧪 Testing

- Add 48 unit tests for equity indicator calculator
- Add unit tests for trading dispatchers and wallet state machines
- Add message pipeline integration tests (42 tests)
- Add core module unit tests (134 tests)

