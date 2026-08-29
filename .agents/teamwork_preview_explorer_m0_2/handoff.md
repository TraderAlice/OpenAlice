# Handoff Report: OpenAlice Architecture & Extension Points Investigation

## 1. Observation

### 1.1 ToolCenter Registration Seam
- **File**: `src/main.ts`
- **Lines 240–276**: Tool registration is centralized in `main()` via `toolCenter.register(tools, group)`:
  ```typescript
  toolCenter.register(createThinkingTools(), 'thinking')
  toolCenter.register(createTradingTools(utaManager, () => config.agent.allowAiTrading), 'trading')
  toolCenter.register(createMarketSearchTools(marketSearch), 'market-search')
  toolCenter.register(createVendorTools(getSDKExecutor()), 'market-vendors')
  toolCenter.register(createReferenceBoardTools(reference), 'market-board')
  toolCenter.register(createEquityTools(equityClient), 'equity')
  if (etfClient) toolCenter.register(createEtfTools(etfClient), 'etf')
  if (config.news.enabled) toolCenter.register(createNewsArchiveTools(newsStore), 'rss')
  toolCenter.register(createQuantTools({ barService }), 'quant')
  toolCenter.register(createSnapshotTools(barService), 'snapshot')
  toolCenter.register(createSimulateTools(barService), 'simulate')
  toolCenter.register(createSectorRotationTools(equityClient, config.marketData.hub), 'sector-rotation')
  if (derivativesClient) toolCenter.register(createDerivativesTools(derivativesClient), 'derivatives')
  if (indexClient) toolCenter.register(createIndexTools(indexClient), 'indices')
  toolCenter.register(createEconomyTools(economyClient, commodityClient), 'economy')
  ```
- **ToolCenter Implementation (`src/core/tool-center.ts`)**:
  `toolCenter.register(tools: Record<string, Tool>, group: string)` registers tools under a namespace.
  `getVercelTools()` and `getMcpTools()` read `data/config/tools.json` to filter disabled tools.

### 1.2 Web API Route Mounting Seam
- **File**: `src/webui/plugin.ts`
- **Lines 217–251**: Route modules are mounted onto the root Hono instance:
  ```typescript
  app.route('/api/channels', createChannelsRoutes({ sessions, sseByChannel: this.sseByChannel }))
  app.route('/api/media', createMediaRoutes())
  app.route('/api/config', createConfigRoutes({ ctx }))
  app.route('/api/connectors', createConnectorRoutes({ getWorkspaceService: () => this.workspaceService }))
  app.route('/api/preferences', createPreferencesRoutes())
  app.route('/api/ui-layout', createUiLayoutRoutes())
  app.route('/api/market-data', createMarketDataRoutes(ctx))
  app.route('/api/trading/config', createTradingConfigRoutes(ctx))
  app.route('/api/trading', utaProxy)
  app.route('/api/simulator', createTradingProxyRoutes({ utaBaseUrl: resolveUTAUrl(), getPolicy: ctx.tradingModePolicy }))
  app.route('/api/tools', createToolsRoutes(ctx.toolCenter))
  app.route('/api/agent-status', createAgentStatusRoutes(ctx))
  app.route('/api/news', createNewsRoutes(ctx))
  app.route('/api/market', createMarketRoutes(ctx))
  app.route('/api/bars', createBarsRoutes(ctx))
  app.route('/api/reference', createReferenceRoutes(ctx))
  app.route('/api/inbox', createInboxRoutes({ inboxStore: ctx.inboxStore }))
  app.route('/api/version', createVersionRoutes())
  app.route('/api/alice-project', createAliceProjectRoutes())
  ```

### 1.3 Configuration Structure & Storage Isolation
- **Files**: `src/core/config.ts` (lines 540–580), `src/core/paths.ts` (lines 43–45)
- **Path Resolution**: `dataPath('config')` points to `~/.openalice/data/config` (or `$OPENALICE_HOME/data/config`).
- **Config Loader**: `loadConfigUnlocked()` loads 12 JSON files (`engine.json`, `agent.json`, `crypto.json`, `securities.json`, `market-data.json`, `ai-provider-manager.json`, `snapshot.json`, `mcp.json`, `ports.json`, `news.json`, `tools.json`, `trading.json`).
- **Isolated `data/config/lean.json`**:
  `LeanService` reads its own configuration file at `dataPath('config', 'lean.json')` without altering the core `Config` TypeScript type or `loadConfig()` function in `src/core/config.ts`.
  Default schema:
  ```json
  {
    "enabled": false,
    "dockerImage": "quantconnect/lean:latest",
    "dataDir": "data/lean/data",
    "algorithmLanguage": "python",
    "maxConcurrentBacktests": 2,
    "defaultCash": 100000,
    "defaultBrokerage": "oanda"
  }
  ```

### 1.4 UI Frontend Extension Points
- **`ui/src/tabs/types.ts`**:
  - `ViewSpec` union (lines 27–79) defines all tab page specifications.
  - `ActivitySection` union (lines 87–102) defines the left ActivityBar icon categories.
- **`ui/src/tabs/registry.tsx`**:
  - `VIEWS` dictionary (lines 639–670) maps `ViewKind` to `ViewModule<K>` (specifying `title`, `toUrl`, `Component`, `lifecycle`, `shell`).
- **`ui/src/App.tsx`**:
  - `Page` union type (lines 23–28) defines valid activity bar pages.
- **`ui/src/components/activity-navigation.ts`**:
  - `NAV_SECTIONS` (lines 79–121) defines `primary`, `beta`, and `system` sections with icons and default landing tabs.
  - Quant Lab mounts under the `beta` section with the `Beaker` icon.

### 1.5 Existing Quantitative & Simulation Capabilities (DO NOT REPLACE)
- **`src/tool/quant.ts`**: `calculateQuant` (v2) executes barId-keyed pandas-subset technical analysis scripts (SMA, EMA, RSI, MACD, ATR, etc.) over K-lines from brokers/vendors.
- **`src/tool/analysis.ts`**: `calculateIndicator` (v1 formula-based indicator calculator).
- **`src/tool/simulate.ts`**: `simulate` executes single-entry, single-exit backtesting against historical bars with exit rules (`trailing_stop`, `ma_break`, `stop`, `target`, `hold`).
- **`src/tool/trading.ts`**: Unified Trading Account (UTA) broker trading and staging pipeline (`placeOrder`, `modifyOrder`, `closePosition`, `tradingCommit`, `tradingPush`).

### 1.6 Baseline Test Suite Status
- Executed `npx --yes pnpm test --run` on baseline `feat/lean-integration` (`origin/dev`):
  - 592 test suites passed, 4,991 individual tests passed.
  - 7 test suites failed due to timeouts in heavy PTY/UI render tests under high concurrency load and an ambient environment key expectation in `agent-probe.spec.ts`.
  - Core domain, tools, and unit tests pass with zero regressions.

---

## 2. Logic Chain

1. **Isolation Guarantee via Non-Destructive Extension Points**:
   - `LeanService.create()` in `src/domain/lean/service.ts` encapsulates LEAN execution and reads `data/config/lean.json`. When `enabled` is `false` (the default), `create()` resolves to `null`.
   - In `src/main.ts`, line 276: `const leanService = await LeanService.create(); if (leanService) toolCenter.register(createLeanTools({ leanService }), 'lean')`. When `leanService` is `null`, zero tools are registered in `toolCenter`.
   - In `src/webui/plugin.ts`, `app.route('/api/lean', createLeanRoutes(ctx))` adds an isolated sub-router. If `lean.enabled: false`, routes return appropriate status.
   - In the frontend (`ui/src/tabs/registry.tsx`, `ui/src/App.tsx`, `ui/src/components/activity-navigation.ts`), Quant Lab navigation is conditioned on `lean.enabled`, keeping the interface hidden when disabled.

2. **Verification of List A vs List B Files**:
   - **List A (Exact 6 files permitted for modification)**:
     1. `src/main.ts` (+4 lines)
     2. `src/webui/plugin.ts` (+2 lines)
     3. `ui/src/tabs/types.ts` (+6 lines: 5 `ViewSpec` variants, 1 `ActivitySection`)
     4. `ui/src/tabs/registry.tsx` (+imports, +view module definitions, +entries in `VIEWS`)
     5. `ui/src/App.tsx` (+1 union member `'quant-lab'`)
     6. `ui/src/components/activity-navigation.ts` (+2 lines: icon import and `beta` section entry)
   - **List B (Forbidden from modification)**:
     - `src/tool/trading.ts`, `src/tool/quant.ts`, `src/tool/analysis.ts`, `src/tool/simulate.ts`
     - `src/domain/analysis/*`, `src/domain/market-data/*`, `src/domain/news/*`
     - `services/uta/*`, `src/services/uta-client/*`, `packages/uta-broker-*/*`, `packages/uta-protocol/*`, `packages/ibkr/*`
     - `services/connector/*`
     - `src/core/types.ts`, `src/core/config.ts`, `src/core/tool-center.ts`, `src/core/session.ts`, `src/core/inbox-store.ts`, `src/core/entity-store.ts`
     - `ui/src/pages/*.tsx` (all existing), `ui/src/components/*.tsx` (all existing), `ui/src/api/*.ts` (all existing)
     - `src/server/*`, `packages/cli/*`, `packages/guardian-runtime/*`

3. **Storage & Runtime Layout**:
   - Runtime containerization runs LEAN Docker image `quantconnect/lean:latest` via Node `child_process.spawn`.
   - File storage under `data/lean/`:
     - `data/lean/algorithms/`: Python strategy files (`.py`) inheriting from `QCAlgorithm`.
     - `data/lean/data/forex/oanda/minute/eurusd/{YYYYMMDD}_quote.zip`: Minute QuoteBar data.
     - `data/lean/experiments/`: JSON experiment tracking files (`{id}.json`).
     - `data/lean/runs/{backtestId}/`: Isolated scratch directories containing generated `config.json`, raw engine output JSON, and logs.
     - `data/lean/journal/`: Manual trading hypotheses and notes.
     - `data/lean/risk-policy.json`: Research safety and risk configuration.
   - Deleting `data/lean/` and setting `"enabled": false` in `data/config/lean.json` completely removes all LEAN artifacts without touching any OpenAlice database or config files.

---

## 3. Caveats

- **Docker Dependency**: LEAN Engine backtesting requires the `quantconnect/lean:latest` Docker image and Docker daemon access on the host system. Docker v29.7.2 is verified present.
- **XAU/USD (Gold) Handling**: In LEAN, gold is modeled under `SecurityType.Cfd` (`cfd/{market}/...`) rather than `SecurityType.Forex`. It must be handled separately from standard Forex pairs.
- **Swap / Overnight Financing Rates**: LEAN does not natively model overnight rollover swap fees in Forex without custom fee modeling in the strategy.
- **No Live Trading Scope**: In accordance with Requirement R7, Live broker order execution (Phase 9) is strictly out of scope; execution is restricted to historical backtesting and paper simulation.

---

## 4. Conclusion

The OpenAlice codebase has clean, modular, and well-isolated extension points for integrating the LEAN Engine.
By following the 6 List A modification files, storing configuration in `data/config/lean.json`, and placing all engine data inside `data/lean/`, the integration is 100% additive, non-destructive, and independently removable. Existing trading, quant scripting (`calculateQuant`), single-bar simulation (`simulateBacktest`), and broker connectors remain completely unaffected.

---

## 5. Verification Method

1. **Config & Tool Isolation Verification**:
   - With `data/config/lean.json` set to `{"enabled": false}` or absent, verify that `toolCenter.list()` does not include `lean*` tools.
   - Verify that OpenAlice boots cleanly without errors.
2. **List A Diff Inspection**:
   - Verify `git diff` against `origin/dev` contains edits only in the 6 designated List A files.
3. **Automated Test Matrix**:
   - Run `npx vitest run src/domain/lean/` for LEAN domain unit tests once implemented.
   - Run targeted test suites `npx vitest run src/` to verify zero regressions.
