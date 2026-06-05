import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
// AgentCenter retired — the in-process agent loop now runs inside the
// native workspace CLIs; Alice drives GenerateRouter directly.
import { loadConfig } from './core/config.js'
import { dataPath, defaultPath } from '@/core/paths.js'
import type { Plugin, EngineContext } from './core/types.js'
import { McpPlugin } from './server/mcp.js'
import { WebPlugin } from './webui/index.js'
import { createWorkspaceServiceRef } from './webui/plugin.js'
import { createThinkingTools } from './tool/thinking.js'
import { createUTAClient } from '@traderalice/uta-protocol'
import { UTAManagerSDK } from './services/uta-client/index.js'
import { waitForUTAReady } from './services/uta-supervisor/health.js'
import { createTradingTools } from './tool/trading.js'
import { SymbolIndex } from './domain/market-data/equity/index.js'
import { CommodityCatalog } from './domain/market-data/commodity/index.js'
import { createEquityTools } from './tool/equity.js'
import { createEtfTools } from './tool/etf.js'
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
import { SessionStore } from './core/session.js'
import { createInboxStore } from './core/inbox-store.js'
import { ToolCenter } from './core/tool-center.js'
import { WorkspaceToolCenter } from './core/workspace-tool-center.js'
import { inboxPushFactory } from './tool/inbox-push.js'
import { createEntityStore } from './core/entity-store.js'
import { entityUpsertFactory } from './tool/entity-upsert.js'
import { entitySearchFactory } from './tool/entity-search.js'
import { AgentWorkRunner } from './core/agent-work.js'
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

const PERSONA_FILE = dataPath('brain', 'persona.md')
const PERSONA_DEFAULT = defaultPath('persona.default.md')
const HEARTBEAT_FILE = dataPath('brain', 'heartbeat.md')
const HEARTBEAT_DEFAULT = defaultPath('heartbeat.default.md')

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

  // ==================== Workspace Tool Center (factories — instantiated per wsId at MCP request time) ====================

  const workspaceToolCenter = new WorkspaceToolCenter()
  workspaceToolCenter.register(inboxPushFactory)
  workspaceToolCenter.register(entityUpsertFactory)
  workspaceToolCenter.register(entitySearchFactory)

  // ==================== UTA SDK (HTTP boundary) ====================
  //
  // Trading domain lives in the co-located UTA service spawned by
  // Guardian (`scripts/guardian/dev.ts` in dev / Docker `tini` supervisor
  // in prod). Alice talks to it through the SDK — broker init, snapshot
  // scheduling, FX, and ephemeral-UTA purges all live in UTA's
  // `services/uta/src/main.ts`.

  const utaUrl = process.env['OPENALICE_UTA_URL']
  if (!utaUrl) {
    throw new Error('OPENALICE_UTA_URL not set — Guardian must spawn the UTA service before Alice boots')
  }
  const utaClient = createUTAClient({ baseUrl: utaUrl })
  const utaHealth = await waitForUTAReady({ baseUrl: utaUrl, timeoutMs: 15_000 })
  if (!utaHealth) {
    throw new Error(`UTA service at ${utaUrl} did not become ready within 15s`)
  }
  console.log(`uta: ready (${utaHealth.utas} accounts, startedAt=${utaHealth.startedAt})`)
  const utaManager = new UTAManagerSDK({ client: utaClient })

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
    createTradingTools(utaManager),
    'trading',
  )

  toolCenter.register(createCronTools(cronEngine), 'cron')
  toolCenter.register(createMarketSearchTools(marketSearch), 'market-search')
  toolCenter.register(createEquityTools(equityClient), 'equity')
  if (etfClient) {
    toolCenter.register(createEtfTools(etfClient), 'etf')
  }
  if (config.news.enabled) {
    toolCenter.register(createNewsArchiveTools(newsStore), 'news')
  }
  toolCenter.register(createAnalysisTools(equityClient, cryptoClient, currencyClient, commodityClient), 'analysis')
  toolCenter.register(createEconomyTools(economyClient, commodityClient), 'economy')

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

  // ==================== Inbox store ====================

  const inboxStore = createInboxStore()

  // ==================== Entity store (durable cross-workspace tracked-index) ====================

  const entityStore = createEntityStore()

  // ==================== AgentWork runner — shared by all autonomous trigger sources ====================
  //
  // Drives the AI loop via GenerateRouter directly (no AgentCenter
  // layer) and delivers replies to the Inbox under a synthetic
  // `automation:<source>` workspace id.

  const agentWorkRunner = new AgentWorkRunner({ router, inboxStore })

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

  // Snapshot scheduler lives in UTA after Step 6 — Alice no longer
  // drives the periodic equity-curve writes. The UTA service starts
  // its own scheduler at boot.

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

  // Cross-plugin ref so McpPlugin can resolve workspaces for `/mcp/:wsId`
  // even though WebPlugin (the service's actual creator) starts later.
  const workspaceServiceRef = createWorkspaceServiceRef()

  // MCP Server is always active when a port is set — Claude Code provider depends on it for tools.
  // Lives at top-level config (not under connectors:) because it exports
  // ToolCenter outward rather than consuming chat input.
  if (config.mcp.port) {
    corePlugins.push(new McpPlugin(
      toolCenter,
      config.mcp.port,
      workspaceToolCenter,
      inboxStore,
      entityStore,
      () => workspaceServiceRef.current,
    ))
  }

  // Web UI is always active (no enabled flag)
  if (config.connectors.web.port) {
    corePlugins.push(new WebPlugin(
      { port: config.connectors.web.port, mcpPort: config.mcp.port },
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
    config, inboxStore, entityStore, router, eventLog, toolCallLog, heartbeat, cronEngine, toolCenter,
    listenerRegistry,
    fire: createEventBus(eventLog),
    bbEngine: getSDKExecutor(),
    marketSearch,
    utaManager,
    newsProvider: newsStore,
  }

  for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
    await plugin.start(ctx)
    console.log(`plugin started: ${plugin.name}`)
  }

  console.log('engine: started')

  // Broker catalog refresh, snapshot scheduling, and broker close-on-
  // shutdown all live in the UTA service after Step 6.

  // ==================== Shutdown ====================

  let stopped = false
  const shutdown = async () => {
    stopped = true
    newsCollector?.stop()
    heartbeat.stop()
    metricsListener.stop()
    cronListener.stop()
    cronEngine.stop()
    await listenerRegistry.stop()
    for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
      await plugin.stop()
    }
    await newsStore.close()
    await toolCallLog.close()
    await eventLog.close()
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
