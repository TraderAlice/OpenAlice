import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import {
  acquireOpenAliceRuntimeLocks,
  takeoverRequested,
  type OpenAliceRuntimeLock,
} from '@traderalice/guardian-runtime'
// The in-process AI loop (AgentCenter, then GenerateRouter + AgentWork) is gone
// as of 0.40 — the model loop runs inside the native workspace CLIs; autonomous
// runs go through headless workspace dispatch (cron → workspace).
import { loadConfig, readMarketDataConfig } from './core/config.js'
import { printLegacyDataNotice } from './core/legacy-data-notice.js'
import { dataPath, defaultPath, userDataHome } from '@/core/paths.js'
import { resolveLauncherRoot } from '@/workspaces/config.js'
import type { Plugin, EngineContext } from './core/types.js'
import { McpPlugin } from './server/mcp.js'
import { LocalToolGatewayPlugin } from './server/local-tool-gateway.js'
import { WebPlugin } from './webui/index.js'
import { createWorkspaceServiceRef } from './webui/plugin.js'
import { createThinkingTools } from './tool/thinking.js'
import { createUTAClient } from '@traderalice/uta-protocol'
import { UTAManagerSDK } from './services/uta-client/index.js'
import { waitForUTAReady } from './services/uta-supervisor/health.js'
import { resolveUTAUrl } from './services/uta-supervisor/url.js'
import {
  liteUnavailableReason,
  readonlyMutationReason,
  resolveTradingModePolicy,
  type TradingModePolicy,
} from './services/trading-mode.js'
import { createTradingTools } from './tool/trading.js'
import { SymbolIndex } from './domain/market-data/equity/index.js'
import { CommodityCatalog } from './domain/market-data/commodity/index.js'
import { createEquityTools } from './tool/equity.js'
import { createEtfTools } from './tool/etf.js'
import { withHubCalendars } from './domain/market-data/hub-data.js'
import { getSDKExecutor, buildRouteMap, SDKEquityClient, SDKCryptoClient, SDKCurrencyClient, SDKEtfClient, SDKIndexClient, SDKDerivativesClient, SDKCommodityClient, SDKEconomyClient } from './domain/market-data/client/typebb/index.js'
import type { EquityClientLike, CryptoClientLike, CurrencyClientLike, EtfClientLike, IndexClientLike, DerivativesClientLike, CommodityClientLike, EconomyClientLike } from './domain/market-data/client/types.js'
import { buildSDKCredentials } from './domain/market-data/credential-map.js'
import { createMarketSearchTools } from './tool/market.js'
import { createVendorTools } from './tool/market-vendors.js'
import { createQuantTools } from './tool/quant.js'
import { createSnapshotTools } from './tool/snapshot.js'
import { createSimulateTools } from './tool/simulate.js'
import { createBarService } from './domain/market-data/bars/index.js'
import { createReferenceData } from './domain/market-data/reference/service.js'
import { createSectorRotationTools } from './tool/sector-rotation.js'
import { createReferenceBoardTools } from './tool/reference-board.js'
import { createDerivativesTools } from './tool/derivatives.js'
import { createIndexTools } from './tool/indices.js'
import { createEconomyTools } from './tool/economy.js'
import { SessionStore } from './core/session.js'
import { createInboxStore } from './core/inbox-store.js'
import { ToolCenter } from './core/tool-center.js'
import { WorkspaceToolCenter } from './core/workspace-tool-center.js'
import { inboxPushFactory } from './tool/inbox-push.js'
import { inboxReadFactory } from './tool/inbox-read.js'
import { workspacePathFactory } from './tool/workspace-path.js'
import { workspaceSessionsFactory } from './tool/workspace-sessions.js'
import { createEntityStore } from './core/entity-store.js'
import { entityUpsertFactory } from './tool/entity-upsert.js'
import { entitySearchFactory } from './tool/entity-search.js'
import { issueToolFactories } from './tool/issue-tools.js'
import { sessionSignatureFactory } from './tool/session-signature.js'
import { provenanceShowFactory } from './tool/provenance-show.js'
import { conversationToolFactories } from './tool/conversation.js'
import { artifactConversationToolFactories } from './tool/conversation-artifacts.js'
import { createToolCallLog } from './core/tool-call-log.js'
import { createJmbMt5DecisionScheduler } from './task/mt5-decision-scheduler.js'
import { createJmbMt5OutcomeImporter, importReconciledExecutionOutcomes } from './task/mt5-outcome-importer.js'
import { DEFAULT_JMB_DEMO_INSTRUMENTS, runDemoDecisionCycle } from './domain/mt5/demo-decision-service.js'
import { resolveJmbMt5Roots } from './domain/mt5/local-paths.js'
import { NewsCollectorStore, NewsCollector } from './domain/news/index.js'
import { createNewsArchiveTools } from './tool/news.js'

// ==================== Persistence paths ====================

const PERSONA_FILE = dataPath('brain', 'persona.md')
const PERSONA_DEFAULT = defaultPath('persona.default.md')

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
let runtimeLock: OpenAliceRuntimeLock | null = null

async function releaseRuntimeLock(): Promise<void> {
  const current = runtimeLock
  runtimeLock = null
  await current?.release()
}

/** Read a file, copying from default if it doesn't exist yet. */
async function readWithDefault(target: string, defaultFile: string): Promise<string> {
  try { return await readFile(target, 'utf-8') } catch { /* not found — copy default */ }
  try {
    const content = await readFile(defaultFile, 'utf-8')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    return content
  } catch { return '' }
}

async function main() {
  // Before migrations create the new config dir: if this checkout carries a
  // pre-global-root data/ store, tell the user how to adopt it (covers bare
  // `pnpm start`; guardian children get OPENALICE_HOME so this stays quiet).
  printLegacyDataNotice('[alice]')

  const config = await loadConfig()

  const toolCallLog = await createToolCallLog()

  // ==================== Tool Center (created early — UTAManager needs it) ====================

  const toolCenter = new ToolCenter()

  // ==================== Workspace Tool Center (factories — instantiated per wsId at MCP request time) ====================

  const workspaceToolCenter = new WorkspaceToolCenter()
  workspaceToolCenter.register(inboxPushFactory)
  workspaceToolCenter.register(inboxReadFactory)
  workspaceToolCenter.register(workspacePathFactory)
  workspaceToolCenter.register(workspaceSessionsFactory)
  workspaceToolCenter.register(entityUpsertFactory)
  workspaceToolCenter.register(entitySearchFactory)
  for (const f of issueToolFactories) workspaceToolCenter.register(f)
  workspaceToolCenter.register(sessionSignatureFactory)
  workspaceToolCenter.register(provenanceShowFactory)
  for (const f of conversationToolFactories) workspaceToolCenter.register(f)
  for (const f of artifactConversationToolFactories) workspaceToolCenter.register(f)

  // ==================== UTA SDK (HTTP boundary) ====================
  //
  // Trading domain lives in the UTA carrier. Guardian normally spawns it
  // beside Alice, but UTA is optional: Alice can boot in lite mode while the
  // proxy reports trading unavailable. Explicit OPENALICE_LITE_MODE disables
  // SDK carrier calls locally; ordinary offline mode can recover when the
  // carrier appears at the resolved URL.

  const initialTradingMode = await resolveTradingModePolicy(config)
  const currentTradingModePolicy = (): TradingModePolicy => {
    const envLockedMode = initialTradingMode.source === 'env' ? initialTradingMode.mode : null
    if (envLockedMode) return { ...initialTradingMode, mode: envLockedMode, source: 'env', envLocked: true }
    return {
      ...initialTradingMode,
      mode: config.trading.mode ?? initialTradingMode.mode,
      source: config.trading.mode ? 'config' : initialTradingMode.source,
      envLocked: false,
    }
  }
  const utaDisabled = currentTradingModePolicy().mode === 'lite'
  const utaUrl = resolveUTAUrl()
  const utaClient = createUTAClient({ baseUrl: utaUrl })
  if (utaDisabled) {
    console.warn('uta: disabled by trading mode lite — continuing without trading carrier')
  } else {
    const utaHealth = await waitForUTAReady({ baseUrl: utaUrl, timeoutMs: 750 })
    if (utaHealth) {
      console.log(`uta: ready (${utaHealth.utas} accounts, startedAt=${utaHealth.startedAt})`)
    } else {
      console.warn(`uta: unavailable at ${utaUrl} — continuing in lite mode`)
    }
  }
  const utaManager = new UTAManagerSDK({
    client: utaClient,
    unavailableReason: () => liteUnavailableReason(currentTradingModePolicy()),
    readonlyMutationReason: () => readonlyMutationReason(currentTradingModePolicy()),
  })

  // ==================== Persona ====================
  // The persona file is seeded on first run so the user has an editable
  // override (consumed by the workspace context-injector).
  await readWithDefault(PERSONA_FILE, PERSONA_DEFAULT)

  // ==================== News Collector Store ====================

  const newsStore = new NewsCollectorStore({
    maxInMemory: config.news.maxInMemory,
    retentionDays: config.news.retentionDays,
  })
  await newsStore.init()

  // ==================== Embedded Provider Clients ====================

  const { providers } = config.marketData

  let equityClient: EquityClientLike
  let cryptoClient: CryptoClientLike
  let currencyClient: CurrencyClientLike
  let commodityClient: CommodityClientLike
  let etfClient: EtfClientLike
  let indexClient: IndexClientLike
  let derivativesClient: DerivativesClientLike
  let economyClient: EconomyClientLike

  {
    const executor = getSDKExecutor()
    const routeMap = buildRouteMap()
    const credentials = buildSDKCredentials(config.marketData.providerKeys, config.marketData.hub)
    equityClient = new SDKEquityClient(executor, 'equity', providers.equity, credentials, routeMap)
    cryptoClient = new SDKCryptoClient(executor, 'crypto', providers.crypto, credentials, routeMap)
    currencyClient = new SDKCurrencyClient(executor, 'currency', providers.currency, credentials, routeMap)
    commodityClient = new SDKCommodityClient(executor, 'commodity', providers.commodity, credentials, routeMap)
    etfClient = new SDKEtfClient(executor, 'etf', providers.equity, credentials, routeMap)
    indexClient = new SDKIndexClient(executor, 'index', providers.equity, credentials, routeMap)
    derivativesClient = new SDKDerivativesClient(executor, 'derivatives', providers.equity, credentials, routeMap)
    economyClient = new SDKEconomyClient(executor, 'economy', 'federal_reserve', credentials, routeMap)
  }

  // ==================== Equity Symbol Index ====================

  const symbolIndex = new SymbolIndex()
  await symbolIndex.load(equityClient)

  const commodityCatalog = new CommodityCatalog()
  commodityCatalog.load()

  // Default equity vendor + user-opted incremental vendors (eastmoney, …),
  // de-duped, fanned out in searchBars; yfinance stays the always-on default.
  // Resolved PER search (not a boot snapshot) so a vendor the agent enables at
  // runtime via setMarketVendor — written to market-data.json, which the
  // resolver re-reads per request — is live on the next search, no restart.
  const getEquityVendors = async () => {
    const md = await readMarketDataConfig()
    return [...new Set([md.providers.equity, ...md.extraVendors])]
  }

  const marketSearch = { symbolIndex, equityVendors: getEquityVendors, equityClient, cryptoClient, currencyClient, commodityCatalog }

  // Federated bar layer — embedded vendor adapters + broker (UTA) OHLCV behind one
  // barId-keyed interface. Vendor branch live now; UTA branch lands with Phase 1.
  const barService = createBarService({
    marketSearch,
    equityClient,
    cryptoClient,
    currencyClient,
    commodityClient,
    utaManager,
    vendorProviders: config.marketData.providers,
  })

  // Hub-first calendars: tools, CLI and boards all inherit through the
  // client seam. No-op when the hub is disabled.
  equityClient = withHubCalendars(equityClient, config.marketData.hub)

  // Reference-data contract — board-shaped low-frequency data (movers, macro,
  // calendar, …). Alice's own standard; the future hosted-hub seam.
  const reference = createReferenceData({
    equityClient,
    economyClient,
    derivativesClient,
    indexClient,
    equityProvider: config.marketData.providers.equity,
    hub: config.marketData.hub,
  })

  // ==================== Tool Registration ====================

  toolCenter.register(createThinkingTools(), 'thinking')

  // One unified set of trading tools — routes via `source` parameter at runtime.
  // The getter reads `config.agent.allowAiTrading` live (config is mutated in
  // place on Settings writes), so toggling AI trading takes effect without a
  // restart.
  toolCenter.register(
    createTradingTools(utaManager, () => config.agent.allowAiTrading),
    'trading',
  )

  toolCenter.register(createMarketSearchTools(marketSearch), 'market-search')
  toolCenter.register(createVendorTools(getSDKExecutor()), 'market-vendors')
  toolCenter.register(createReferenceBoardTools(reference), 'market-board')
  toolCenter.register(createEquityTools(equityClient), 'equity')
  if (etfClient) {
    toolCenter.register(createEtfTools(etfClient), 'etf')
  }
  if (config.news.enabled) {
    toolCenter.register(createNewsArchiveTools(newsStore), 'rss')
  }
  // v1 calculateIndicator (createAnalysisTools) is retired from the tool surface
  // — calculateQuant (v2, barId-keyed) supersedes it and the two descriptions
  // confused the model / bloated context. The code remains for now.
  toolCenter.register(createQuantTools({ barService }), 'quant')
  toolCenter.register(createSnapshotTools(barService), 'snapshot')
  toolCenter.register(createSimulateTools(barService), 'simulate')
  toolCenter.register(createSectorRotationTools(equityClient, config.marketData.hub), 'sector-rotation')
  if (derivativesClient) {
    toolCenter.register(createDerivativesTools(derivativesClient), 'derivatives')
  }
  if (indexClient) {
    toolCenter.register(createIndexTools(indexClient), 'indices')
  }
  toolCenter.register(createEconomyTools(economyClient, commodityClient), 'economy')

  console.log(`tool-center: ${toolCenter.list().length} tools registered`)

  // ==================== Inbox store ====================

  const inboxStore = createInboxStore()

  // ==================== Entity store (durable cross-workspace tracked-index) ====================

  const entityStore = createEntityStore()

  // ==================== Cron Listener ====================

  // Cross-plugin ref so the cron listener (and McpPlugin) can reach the
  // WorkspaceService even though WebPlugin — its actual creator — starts later.
  // `ref.current` is null until the plugin boots; an early cron fire is a loud
  // skip (see cron listener). Created here so cron dispatch can hold it.
  const workspaceServiceRef = createWorkspaceServiceRef()

  // Snapshot scheduler lives in UTA after Step 6 — Alice no longer
  // drives the periodic equity-curve writes. The UTA service starts
  // its own scheduler at boot.

  // ==================== News Collector ====================

  let newsCollector: NewsCollector | null = null
  if (config.news.enabled && config.news.feeds.length > 0) {
    newsCollector = new NewsCollector({
      store: newsStore,
      feeds: config.news.feeds,
      intervalMs: config.news.intervalMinutes * 60 * 1000,
    })
    newsCollector.start()
    const activeCount = config.news.feeds.filter((f) => f.enabled !== false).length
    console.log(`news-collector: started (${activeCount}/${config.news.feeds.length} feeds active, every ${config.news.intervalMinutes}m)`)
  }

  // ==================== Plugins ====================

  // Core plugins — always-on, not toggleable at runtime
  const corePlugins: Plugin[] = []

  // workspaceServiceRef is created earlier (Cron Listener section) so cron
  // dispatch shares the same box the WebPlugin fills on start.

  const envMcpEnabled = process.env['OPENALICE_MCP_ENABLED']
  const mcpEnabled = envMcpEnabled === '1'
    || ((envMcpEnabled === undefined || envMcpEnabled === '') && config.mcp.enabled === true)
  const localCliOnWeb = process.env['OPENALICE_LOCAL_CLI_ON_WEB'] === '1'
  const webTransport = process.env['OPENALICE_WEB_TRANSPORT'] === 'ipc' ? 'ipc' : 'http'
  const toolBaseUrl = process.env['OPENALICE_TOOL_BASE_URL']
    ?? (localCliOnWeb
      ? `http://127.0.0.1:${config.connectors.web.port}/cli`
      : `http://127.0.0.1:${config.mcp.port}/cli`)
  const mcpBaseUrl = mcpEnabled ? `http://127.0.0.1:${config.mcp.port}/mcp` : undefined

  // MCP is optional. The workspace CLI gateway is the default local tool path;
  // when it cannot safely ride the loopback web listener, keep it on a
  // loopback-only side listener.
  if (mcpEnabled && config.mcp.port) {
    corePlugins.push(new McpPlugin(
      toolCenter,
      config.mcp.port,
      workspaceToolCenter,
      inboxStore,
      entityStore,
      () => workspaceServiceRef.current,
    ))
  } else if (!localCliOnWeb && config.mcp.port) {
    corePlugins.push(new LocalToolGatewayPlugin(config.mcp.port, {
      toolCenter,
      workspaceToolCenter,
      inboxStore,
      entityStore,
      getWorkspaceService: () => workspaceServiceRef.current,
    }))
  }

  // Web UI is always active (no enabled flag)
  if (config.connectors.web.port) {
    corePlugins.push(new WebPlugin(
      {
        port: config.connectors.web.port,
        mcpPort: config.mcp.port,
        toolBaseUrl,
        ...(mcpBaseUrl ? { mcpBaseUrl } : {}),
        localCliOnWeb,
        listen: webTransport !== 'ipc',
        ...(process.env['OPENALICE_TOOL_SOCKET'] ? { cliSocketPath: process.env['OPENALICE_TOOL_SOCKET'] } : {}),
      },
      workspaceServiceRef,
    ))
  }

  // Optional plugins — none today. The legacy connector cluster
  // (Telegram / MCP-Ask) was removed; the map is kept (empty) so the
  // start/stop iteration below stays uniform and future optional
  // plugins have a home.
  const optionalPlugins = new Map<string, Plugin>()

  // ==================== Engine Context ====================

  const ctx: EngineContext = {
    config, inboxStore, entityStore, toolCallLog, toolCenter,
    workspaceToolCenter,
    bbEngine: getSDKExecutor(),
    marketSearch,
    equityClient,
    barService,
    reference,
    utaManager,
    tradingModePolicy: currentTradingModePolicy,
    newsProvider: newsStore,
  }

  for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
    await plugin.start(ctx)
    console.log(`plugin started: ${plugin.name}`)
  }

  const mt5DecisionScheduler = createJmbMt5DecisionScheduler({
    runCycle: async () => runDemoDecisionCycle({ roots: resolveJmbMt5Roots() }),
  })
  await mt5DecisionScheduler.start()

  const mt5Roots = resolveJmbMt5Roots()
  const mt5OutcomeImporter = createJmbMt5OutcomeImporter({
    runCycle: async () => importReconciledExecutionOutcomes({
      executionRoot: mt5Roots.executionRoot,
      learningRoot: join(mt5Roots.researchRoot, 'mt5-execution-learning'),
      instruments: DEFAULT_JMB_DEMO_INSTRUMENTS
        .filter((instrument) => instrument.symbol === 'XAUUSD')
        .map(({ broker, server, symbol }) => ({ broker, server, symbol })),
    }),
  })
  await mt5OutcomeImporter.start()

  console.log('engine: started')

  // Broker catalog refresh, snapshot scheduling, and broker close-on-
  // shutdown all live in the UTA service after Step 6.

  // ==================== Shutdown ====================

  let stopped = false
  const shutdown = async () => {
    stopped = true
    mt5OutcomeImporter.stop()
    mt5DecisionScheduler.stop()
    newsCollector?.stop()
    for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
      await plugin.stop()
    }
    await newsStore.close()
    await toolCallLog.close()
    await releaseRuntimeLock()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // ==================== Tick Loop ====================

  while (!stopped) {
    await sleep(config.engine.interval)
  }
}

async function start(): Promise<void> {
  const guardianPid = positiveInteger(process.env['OPENALICE_GUARDIAN_PID'])
  const guardianStartedAt = positiveInteger(process.env['OPENALICE_GUARDIAN_STARTED_AT'])
  runtimeLock = await acquireOpenAliceRuntimeLocks({
    userDataHome,
    launcherRoot: resolveLauncherRoot(),
    launcher: process.env['OPENALICE_LAUNCHER'] ?? 'standalone',
    takeover: takeoverRequested(),
    ...(guardianPid ? { guardianPid } : {}),
    ...(guardianStartedAt ? { guardianStartedAt } : {}),
    onOwnershipLost: (err) => {
      console.error('fatal: OpenAlice runtime ownership lost:', err)
      try { process.kill(process.pid, 'SIGTERM') } catch { process.exit(1) }
    },
  })
  try {
    await main()
  } catch (err) {
    await releaseRuntimeLock().catch((releaseErr) => {
      console.error('runtime lock release failed after startup error:', releaseErr)
    })
    throw err
  }
}

function positiveInteger(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

start().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
