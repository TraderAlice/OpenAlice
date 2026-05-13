import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
// Engine removed — AgentCenter is the top-level AI entry point
import { loadConfig, readUTAsConfig, purgeEphemeralUTAs } from './core/config.js'
import type { Plugin, EngineContext, ReconnectResult } from './core/types.js'
import { McpPlugin } from './server/mcp.js'
import { TelegramPlugin } from './connectors/telegram/index.js'
import { WebPlugin } from './webui/index.js'
import { McpAskPlugin } from './connectors/mcp-ask/index.js'
import { createThinkingTools } from './tool/thinking.js'
import { UTAManager, createSnapshotService, createSnapshotScheduler } from './domain/trading/index.js'
import { FxService } from './domain/trading/fx-service.js'
import { createTradingTools } from './tool/trading.js'
import { SymbolIndex } from './domain/market-data/equity/index.js'
import { CommodityCatalog } from './domain/market-data/commodity/index.js'
import { createEquityTools } from './tool/equity.js'
import { getSDKExecutor, buildRouteMap, SDKEquityClient, SDKCryptoClient, SDKCurrencyClient, SDKEtfClient, SDKIndexClient, SDKDerivativesClient, SDKCommodityClient, SDKEconomyClient } from './domain/market-data/client/typebb/index.js'
import type { EquityClientLike, CryptoClientLike, CurrencyClientLike, EtfClientLike, IndexClientLike, DerivativesClientLike, CommodityClientLike, EconomyClientLike } from './domain/market-data/client/types.js'
import { buildSDKCredentials } from './domain/market-data/credential-map.js'
import { OpenBBEquityClient } from './domain/market-data/client/openbb-api/equity-client.js'
import { OpenBBCryptoClient } from './domain/market-data/client/openbb-api/crypto-client.js'
import { OpenBBCurrencyClient } from './domain/market-data/client/openbb-api/currency-client.js'
import { OpenBBCommodityClient } from './domain/market-data/client/openbb-api/commodity-client.js'
import { OpenBBEconomyClient } from './domain/market-data/client/openbb-api/economy-client.js'
import { createMarketSearchTools } from './tool/market.js'
import { createAnalysisTools } from './tool/analysis.js'
import { createEconomyTools } from './tool/economy.js'
import { createSessionTools } from './tool/session.js'
import { SessionStore } from './core/session.js'
import { ConnectorCenter } from './core/connector-center.js'
import { createNotificationsStore } from './core/notifications-store.js'
import { ToolCenter } from './core/tool-center.js'
import { AgentCenter } from './core/agent-center.js'
import { AgentWorkRunner } from './core/agent-work.js'
import { createNotifyUserTool } from './tool/notify-user.js'
import { GenerateRouter } from './core/ai-provider-manager.js'
import { VercelAIProvider } from './ai-providers/vercel-ai-sdk/vercel-provider.js'
import { AgentSdkProvider } from './ai-providers/agent-sdk/agent-sdk-provider.js'
import { CodexProvider } from './ai-providers/codex/index.js'
import { createEventLog } from './core/event-log.js'
import { createToolCallLog } from './core/tool-call-log.js'
import { createListenerRegistry } from './core/listener-registry.js'
import { createEventBus } from './core/event-bus.js'
import { createCronEngine, createCronListener, createCronTools } from './task/cron/index.js'
import { createHeartbeat } from './task/heartbeat/index.js'
import { createMetricsListener } from './task/metrics/index.js'
import { createAgentWorkListener } from './core/agent-work-listener.js'
import { NewsCollectorStore, NewsCollector } from './domain/news/index.js'
import { createNewsArchiveTools } from './tool/news.js'

// ==================== Persistence paths ====================

const PERSONA_FILE = resolve('data/brain/persona.md')
const PERSONA_DEFAULT = resolve('default/persona.default.md')
const HEARTBEAT_FILE = resolve('data/brain/heartbeat.md')
const HEARTBEAT_DEFAULT = resolve('default/heartbeat.default.md')

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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
  const config = await loadConfig()

  // ==================== Event Log ====================

  const eventLog = await createEventLog()
  const toolCallLog = await createToolCallLog()

  // ==================== Listener Registry ====================
  // Created early so CronEngine and other producers can declare against it.

  const listenerRegistry = createListenerRegistry(eventLog)

  // ==================== Tool Center (created early — UTAManager needs it) ====================

  const toolCenter = new ToolCenter()

  // ==================== Trading Account Manager ====================

  const utaManager = new UTAManager({ eventLog, toolCenter })

  // Ephemeral test UTAs from a previous session are purged before init —
  // their config rows are removed and `data/trading/<id>/` is wiped, so
  // fixture-driven tests start each session from a clean slate.
  const survivors = await purgeEphemeralUTAs(await readUTAsConfig())
  for (const accCfg of survivors) {
    if (accCfg.enabled === false) continue
    await utaManager.initUTA(accCfg)
  }
  utaManager.registerCcxtToolsIfNeeded()

  // ==================== Snapshot ====================

  const snapshotService = createSnapshotService({ utaManager, eventLog })
  utaManager.setSnapshotHooks({
    onPostPush: (id) => { snapshotService.takeSnapshot(id, 'post-push') },
    onPostReject: (id) => { snapshotService.takeSnapshot(id, 'post-reject') },
  })

  // ==================== Persona ====================
  // Persona + heartbeat default files are seeded on first run so the user
  // has editable overrides to point their config at.
  await Promise.all([
    readWithDefault(PERSONA_FILE, PERSONA_DEFAULT),
    readWithDefault(HEARTBEAT_FILE, HEARTBEAT_DEFAULT),
  ])

  /** Re-read persona from disk on each request so live edits in the
   *  Settings UI take effect without a restart. */
  const getInstructions = async () => {
    return await readFile(PERSONA_FILE, 'utf-8').catch(() => '')
  }

  // ==================== Cron ====================

  const cronEngine = createCronEngine({ registry: listenerRegistry })

  // ==================== News Collector Store ====================

  const newsStore = new NewsCollectorStore({
    maxInMemory: config.news.maxInMemory,
    retentionDays: config.news.retentionDays,
  })
  await newsStore.init()

  // ==================== OpenBB Clients ====================

  const { providers } = config.marketData

  let equityClient: EquityClientLike
  let cryptoClient: CryptoClientLike
  let currencyClient: CurrencyClientLike
  let commodityClient: CommodityClientLike
  let etfClient: EtfClientLike | undefined
  let indexClient: IndexClientLike | undefined
  let derivativesClient: DerivativesClientLike | undefined
  let economyClient: EconomyClientLike

  if (config.marketData.backend === 'openbb-api') {
    const url = config.marketData.apiUrl
    const keys = config.marketData.providerKeys
    equityClient = new OpenBBEquityClient(url, providers.equity, keys)
    cryptoClient = new OpenBBCryptoClient(url, providers.crypto, keys)
    currencyClient = new OpenBBCurrencyClient(url, providers.currency, keys)
    commodityClient = new OpenBBCommodityClient(url, providers.commodity, keys) as unknown as CommodityClientLike
    economyClient = new OpenBBEconomyClient(url, 'federal_reserve', keys) as unknown as EconomyClientLike
  } else {
    const executor = getSDKExecutor()
    const routeMap = buildRouteMap()
    const credentials = buildSDKCredentials(config.marketData.providerKeys)
    equityClient = new SDKEquityClient(executor, 'equity', providers.equity, credentials, routeMap)
    cryptoClient = new SDKCryptoClient(executor, 'crypto', providers.crypto, credentials, routeMap)
    currencyClient = new SDKCurrencyClient(executor, 'currency', providers.currency, credentials, routeMap)
    commodityClient = new SDKCommodityClient(executor, 'commodity', providers.commodity, credentials, routeMap)
    etfClient = new SDKEtfClient(executor, 'etf', providers.equity, credentials, routeMap)
    indexClient = new SDKIndexClient(executor, 'index', providers.equity, credentials, routeMap)
    derivativesClient = new SDKDerivativesClient(executor, 'derivatives', providers.equity, credentials, routeMap)
    economyClient = new SDKEconomyClient(executor, 'economy', 'federal_reserve', credentials, routeMap)
  }

  // ==================== FX Service ====================

  const fxService = new FxService(currencyClient)
  utaManager.setFxService(fxService)

  // ==================== Equity Symbol Index ====================

  const symbolIndex = new SymbolIndex()
  await symbolIndex.load(equityClient)

  const commodityCatalog = new CommodityCatalog()
  commodityCatalog.load()

  const marketSearch = { symbolIndex, cryptoClient, currencyClient, commodityCatalog }

  // ==================== Tool Registration ====================

  toolCenter.register(createThinkingTools(), 'thinking')

  // One unified set of trading tools — routes via `source` parameter at runtime
  toolCenter.register(
    createTradingTools(utaManager, fxService),
    'trading',
  )

  toolCenter.register(createCronTools(cronEngine), 'cron')
  toolCenter.register(createMarketSearchTools(marketSearch), 'market-search')
  toolCenter.register(createEquityTools(equityClient), 'equity')
  if (config.news.enabled) {
    toolCenter.register(createNewsArchiveTools(newsStore), 'news')
  }
  toolCenter.register(createAnalysisTools(equityClient, cryptoClient, currencyClient, commodityClient), 'analysis')
  toolCenter.register(createEconomyTools(economyClient, commodityClient), 'economy')
  toolCenter.register(createNotifyUserTool(), 'notify')

  console.log(`tool-center: ${toolCenter.list().length} tools registered`)

  // ==================== AI Provider Chain ====================

  const vercelProvider = new VercelAIProvider(
    () => toolCenter.getVercelTools(),
    getInstructions,
    config.agent.maxSteps,
  )
  const agentSdkProvider = new AgentSdkProvider(
    () => toolCenter.getVercelTools(),
    getInstructions,
  )
  const codexProvider = new CodexProvider(
    () => toolCenter.getVercelTools(),
    getInstructions,
  )
  const router = new GenerateRouter(vercelProvider, agentSdkProvider, codexProvider)

  const agentCenter = new AgentCenter({
    router,
    compaction: config.compaction,
    toolCallLog,
  })

  // ==================== Notifications store + Connector Center ====================

  const notificationsStore = createNotificationsStore()
  const connectorCenter = new ConnectorCenter({ eventLog, listenerRegistry, notificationsStore })

  // Session awareness tools (registered here because they need connectorCenter)
  toolCenter.register(createSessionTools(connectorCenter), 'session')

  // ==================== AgentWork runner — shared by all autonomous trigger sources ====================

  const agentWorkRunner = new AgentWorkRunner({ agentCenter, connectorCenter })

  // ==================== AgentWork Listener (single dispatch point) ====================
  //
  // Owns all `agent.work.requested` traffic. Each trigger source
  // (cron / heartbeat / webhook) registers its source config and
  // emits the canonical event; the listener routes by source field
  // and runs the AgentWork pipeline.

  const agentWorkListener = createAgentWorkListener({
    runner: agentWorkRunner,
    registry: listenerRegistry,
  })
  await agentWorkListener.start()

  // Register the `task` (webhook-triggered) source inline. Unlike
  // heartbeat and cron, there's no listener-side wrapper — the
  // webhook ingest endpoint emits agent.work.requested directly
  // (or translates the legacy task.requested wire format).
  const taskSession = new SessionStore('task/default')
  await taskSession.restore()
  agentWorkListener.registerSource({
    source: 'task',
    session: taskSession,
    preamble: () =>
      'You are handling an externally-triggered task (session: task/default). Follow the prompt and reply with what the caller needs.',
    buildDoneMetadata: (req) => ({ prompt: req.prompt }),
    buildErrorMetadata: (req) => ({ prompt: req.prompt }),
  })

  // ==================== Cron Listener ====================

  const cronSession = new SessionStore('cron/default')
  await cronSession.restore()
  const cronListener = createCronListener({ agentWorkListener, registry: listenerRegistry, session: cronSession })
  await cronListener.start()

  // ==================== Snapshot Scheduler (Pump-driven) ====================

  const snapshotScheduler = createSnapshotScheduler({ snapshotService, config: config.snapshot })
  await snapshotScheduler.start()
  if (config.snapshot.enabled) {
    console.log(`snapshot: scheduler started (every ${config.snapshot.every})`)
  }

  // ==================== Heartbeat (Pump-driven) ====================

  const heartbeat = createHeartbeat({
    config: config.heartbeat,
    agentWorkListener, registry: listenerRegistry,
    session: new SessionStore('heartbeat'),
  })
  await heartbeat.start()
  if (config.heartbeat.enabled) {
    console.log(`heartbeat: enabled (every ${config.heartbeat.every})`)
  }

  // ==================== Event Metrics (wildcard observer) ====================

  const metricsListener = createMetricsListener({ registry: listenerRegistry })
  await metricsListener.start()

  // ==================== Activate Listeners + Start Cron Engine ====================

  await listenerRegistry.start()
  await cronEngine.start()
  console.log(`listener-registry: started (${listenerRegistry.list().length} listeners)`)
  console.log('cron: engine started')

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

  // MCP Server is always active when a port is set — Claude Code provider depends on it for tools.
  // Lives at top-level config (not under connectors:) because it exports
  // ToolCenter outward rather than consuming chat input.
  if (config.mcp.port) {
    corePlugins.push(new McpPlugin(toolCenter, config.mcp.port))
  }

  // Web UI is always active (no enabled flag)
  if (config.connectors.web.port) {
    corePlugins.push(new WebPlugin({ port: config.connectors.web.port }))
  }

  // Optional plugins — toggleable at runtime via reconnectConnectors()
  const optionalPlugins = new Map<string, Plugin>()

  if (config.connectors.mcpAsk.enabled && config.connectors.mcpAsk.port) {
    optionalPlugins.set('mcp-ask', new McpAskPlugin({ port: config.connectors.mcpAsk.port }))
  }

  if (config.connectors.telegram.enabled && config.connectors.telegram.botToken) {
    optionalPlugins.set('telegram', new TelegramPlugin({
      token: config.connectors.telegram.botToken,
      allowedChatIds: config.connectors.telegram.chatIds,
    }))
  }

  // ==================== Connector Reconnect ====================

  let connectorsReconnecting = false
  const reconnectConnectors = async (): Promise<ReconnectResult> => {
    if (connectorsReconnecting) return { success: false, error: 'Reconnect already in progress' }
    connectorsReconnecting = true
    try {
      const fresh = await loadConfig()
      const changes: string[] = []

      // --- MCP Ask ---
      const mcpAskWanted = fresh.connectors.mcpAsk.enabled && !!fresh.connectors.mcpAsk.port
      const mcpAskRunning = optionalPlugins.has('mcp-ask')
      if (mcpAskRunning && !mcpAskWanted) {
        await optionalPlugins.get('mcp-ask')!.stop()
        optionalPlugins.delete('mcp-ask')
        changes.push('mcp-ask stopped')
      } else if (!mcpAskRunning && mcpAskWanted) {
        const p = new McpAskPlugin({ port: fresh.connectors.mcpAsk.port! })
        await p.start(ctx)
        optionalPlugins.set('mcp-ask', p)
        changes.push('mcp-ask started')
      }

      // --- Telegram ---
      const telegramWanted = fresh.connectors.telegram.enabled && !!fresh.connectors.telegram.botToken
      const telegramRunning = optionalPlugins.has('telegram')
      if (telegramRunning && !telegramWanted) {
        await optionalPlugins.get('telegram')!.stop()
        optionalPlugins.delete('telegram')
        changes.push('telegram stopped')
      } else if (!telegramRunning && telegramWanted) {
        const p = new TelegramPlugin({
          token: fresh.connectors.telegram.botToken!,
          allowedChatIds: fresh.connectors.telegram.chatIds,
        })
        await p.start(ctx)
        optionalPlugins.set('telegram', p)
        changes.push('telegram started')
      }

      if (changes.length > 0) {
        console.log(`reconnect: connectors — ${changes.join(', ')}`)
      }
      return { success: true, message: changes.length > 0 ? changes.join(', ') : 'no changes' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('reconnect: connectors failed:', msg)
      return { success: false, error: msg }
    } finally {
      connectorsReconnecting = false
    }
  }

  // ==================== Engine Context ====================

  const ctx: EngineContext = {
    config, connectorCenter, notificationsStore, agentCenter, eventLog, toolCallLog, heartbeat, cronEngine, toolCenter,
    listenerRegistry,
    fire: createEventBus(eventLog),
    bbEngine: getSDKExecutor(),
    marketSearch,
    utaManager, fxService, snapshotService,
    newsProvider: newsStore,
    reconnectConnectors,
  }

  for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
    await plugin.start(ctx)
    console.log(`plugin started: ${plugin.name}`)
  }

  console.log('engine: started')

  // ==================== Broker catalog refresh ====================
  // Brokers that cache their catalog locally (Alpaca, CCXT, Mock) need
  // periodic refreshes so newly listed assets surface in search and
  // delisted ones drop. The optional `refreshCatalog` is a no-op for
  // brokers that don't cache (IBKR — server-side reqMatchingSymbols).
  const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000  // 6h
  const catalogRefreshTimer = setInterval(() => {
    for (const uta of utaManager.resolve()) {
      uta.refreshCatalog().catch((err) => {
        console.warn(`[catalog-refresh] ${uta.id} failed:`, err instanceof Error ? err.message : err)
      })
    }
  }, CATALOG_REFRESH_MS)
  // Don't keep the process alive just for the refresh loop — shutdown logic
  // below clears it anyway, this is belt-and-braces for clean Node exit.
  catalogRefreshTimer.unref?.()

  // ==================== Shutdown ====================

  let stopped = false
  const shutdown = async () => {
    stopped = true
    clearInterval(catalogRefreshTimer)
    newsCollector?.stop()
    snapshotScheduler.stop()
    heartbeat.stop()
    metricsListener.stop()
    cronListener.stop()
    cronEngine.stop()
    connectorCenter.stop()
    await listenerRegistry.stop()
    for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
      await plugin.stop()
    }
    await newsStore.close()
    await toolCallLog.close()
    await eventLog.close()
    await utaManager.closeAll()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // ==================== Tick Loop ====================

  while (!stopped) {
    await sleep(config.engine.interval)
  }
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
