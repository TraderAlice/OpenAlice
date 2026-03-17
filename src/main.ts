import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
// Engine removed — AgentCenter is the top-level AI entry point
import { loadConfig, loadTradingConfig } from './core/config.js'
import type { Plugin, EngineContext, ReconnectResult } from './core/types.js'
import { McpPlugin } from './server/mcp.js'
import { TelegramPlugin } from './connectors/telegram/index.js'
import { WebPlugin } from './connectors/web/index.js'
import { McpAskPlugin } from './connectors/mcp-ask/index.js'
import { createThinkingTools } from './tool/thinking.js'
import {
  AccountManager,
  UnifiedTradingAccount,
  CcxtBroker,
  createCcxtProviderTools,
  createPlatformFromConfig,
  createBrokerFromConfig,
  validatePlatformRefs,
} from './domain/trading/index.js'
import { createTradingTools } from './tool/trading.js'
import type { GitExportState, IPlatform } from './domain/trading/index.js'
import { Brain } from './domain/brain/index.js'
import { createBrainTools } from './tool/brain.js'
import type { BrainExportState } from './domain/brain/index.js'
import { createBrowserTools } from './tool/browser.js'
import { SymbolIndex } from './domain/market-data/equity/index.js'
import { createEquityTools } from './tool/equity.js'
import { getSDKExecutor, buildRouteMap, SDKEquityClient, SDKCryptoClient, SDKCurrencyClient } from './domain/market-data/client/typebb/index.js'
import type { EquityClientLike, CryptoClientLike, CurrencyClientLike } from './domain/market-data/client/types.js'
import { buildSDKCredentials } from './domain/market-data/credential-map.js'
import { OpenBBEquityClient } from './domain/market-data/client/openbb-api/equity-client.js'
import { OpenBBCryptoClient } from './domain/market-data/client/openbb-api/crypto-client.js'
import { OpenBBCurrencyClient } from './domain/market-data/client/openbb-api/currency-client.js'
import { OpenBBServerPlugin } from './server/opentypebb.js'
import { createMarketSearchTools } from './tool/market.js'
import { createAnalysisTools } from './tool/analysis.js'
import { SessionStore } from './core/session.js'
import { ConnectorCenter } from './core/connector-center.js'
import { ToolCenter } from './core/tool-center.js'
import { AgentCenter } from './core/agent-center.js'
import { GenerateRouter } from './core/ai-provider-manager.js'
import { VercelAIProvider } from './ai-providers/vercel-ai-sdk/vercel-provider.js'
import { ClaudeCodeProvider } from './ai-providers/claude-code/claude-code-provider.js'
import { AgentSdkProvider } from './ai-providers/agent-sdk/agent-sdk-provider.js'
import { createEventLog } from './core/event-log.js'
import { createToolCallLog } from './core/tool-call-log.js'
import { createCronEngine, createCronListener, createCronTools } from './task/cron/index.js'
import { createHeartbeat } from './task/heartbeat/index.js'
import { NewsCollectorStore, NewsCollector } from './domain/news/index.js'
import { createNewsArchiveTools } from './tool/news.js'

// ==================== Persistence paths ====================

const BRAIN_FILE = resolve('data/brain/commit.json')

/** Per-account git state path. Falls back to legacy paths for backward compat.
 *  TODO: remove LEGACY_GIT_PATHS before v1.0 */
function gitFilePath(accountId: string): string {
  return resolve(`data/trading/${accountId}/commit.json`)
}
const LEGACY_GIT_PATHS: Record<string, string> = {
  'bybit-main': resolve('data/crypto-trading/commit.json'),
  'alpaca-paper': resolve('data/securities-trading/commit.json'),
  'alpaca-live': resolve('data/securities-trading/commit.json'),
}
const FRONTAL_LOBE_FILE = resolve('data/brain/frontal-lobe.md')
const EMOTION_LOG_FILE = resolve('data/brain/emotion-log.md')
const PERSONA_FILE = resolve('data/brain/persona.md')
const PERSONA_DEFAULT = resolve('data/default/persona.default.md')

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

/** Create a git commit persistence callback for a given file path. */
function createGitPersister(filePath: string) {
  return async (state: GitExportState) => {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(state, null, 2))
  }
}

/** Read saved git state from disk, trying primary path then legacy fallback. */
async function loadGitState(accountId: string): Promise<GitExportState | undefined> {
  const primary = gitFilePath(accountId)
  try {
    return JSON.parse(await readFile(primary, 'utf-8')) as GitExportState
  } catch { /* try legacy */ }
  const legacy = LEGACY_GIT_PATHS[accountId]
  if (legacy) {
    try {
      return JSON.parse(await readFile(legacy, 'utf-8')) as GitExportState
    } catch { /* no saved state */ }
  }
  return undefined
}

async function main() {
  const config = await loadConfig()

  // ==================== Trading Account Manager ====================

  const accountManager = new AccountManager()

  // ==================== Platform-driven Account Init ====================

  const tradingConfig = await loadTradingConfig()
  const platformRegistry = new Map<string, IPlatform>()
  for (const pc of tradingConfig.platforms) {
    platformRegistry.set(pc.id, createPlatformFromConfig(pc))
  }
  validatePlatformRefs([...platformRegistry.values()], tradingConfig.accounts)

  /** Initialize and register a single account. Returns true if successful. */
  async function initAccount(
    accountCfg: { id: string; platformId: string; guards: Array<{ type: string; options: Record<string, unknown> }> },
    platform: IPlatform,
  ): Promise<boolean> {
    const broker = createBrokerFromConfig(platform, accountCfg)
    try {
      await broker.init()
    } catch (err) {
      console.warn(`trading: ${accountCfg.id} init failed (non-fatal):`, err)
      return false
    }
    const savedState = await loadGitState(accountCfg.id)
    const filePath = gitFilePath(accountCfg.id)
    const uta = new UnifiedTradingAccount(broker, {
      guards: accountCfg.guards,
      savedState,
      onCommit: createGitPersister(filePath),
      platformId: accountCfg.platformId,
    })
    accountManager.add(uta)
    console.log(`trading: ${uta.label} initialized`)
    return true
  }

  // Alpaca accounts — sync init (fast, blocks startup)
  // CCXT accounts — async background init (loadMarkets is slow)
  const ccxtAccountConfigs: Array<{ cfg: typeof tradingConfig.accounts[number]; platform: IPlatform }> = []

  for (const accCfg of tradingConfig.accounts) {
    const platform = platformRegistry.get(accCfg.platformId)!
    if (platform.providerType === 'alpaca') {
      await initAccount(accCfg, platform)
    } else {
      ccxtAccountConfigs.push({ cfg: accCfg, platform })
    }
  }

  // CCXT init in background — register tools when ready
  const ccxtInitPromise = ccxtAccountConfigs.length > 0
    ? (async () => {
        for (const { cfg, platform } of ccxtAccountConfigs) {
          await initAccount(cfg, platform)
        }
      })()
    : Promise.resolve()

  // ==================== Brain ====================

  const [brainExport, persona] = await Promise.all([
    readFile(BRAIN_FILE, 'utf-8').then((r) => JSON.parse(r) as BrainExportState).catch(() => undefined),
    readWithDefault(PERSONA_FILE, PERSONA_DEFAULT),
  ])

  const brainDir = resolve('data/brain')
  const brainOnCommit = async (state: BrainExportState) => {
    await mkdir(brainDir, { recursive: true })
    await writeFile(BRAIN_FILE, JSON.stringify(state, null, 2))
    await writeFile(FRONTAL_LOBE_FILE, state.state.frontalLobe)
    const latest = state.commits[state.commits.length - 1]
    if (latest?.type === 'emotion') {
      const prev = state.commits.length > 1
        ? state.commits[state.commits.length - 2]?.stateAfter.emotion ?? 'unknown'
        : 'unknown'
      await appendFile(EMOTION_LOG_FILE,
        `## ${latest.timestamp}\n**${prev} → ${latest.stateAfter.emotion}**\n${latest.message}\n\n`)
    }
  }

  const brain = brainExport
    ? Brain.restore(brainExport, { onCommit: brainOnCommit })
    : new Brain({ onCommit: brainOnCommit })

  const frontalLobe = brain.getFrontalLobe()
  const emotion = brain.getEmotion().current
  const instructions = [
    persona,
    '---',
    '## Current Brain State',
    '',
    `**Frontal Lobe:** ${frontalLobe || '(empty)'}`,
    '',
    `**Emotion:** ${emotion}`,
  ].join('\n')

  // ==================== Event Log ====================

  const eventLog = await createEventLog()
  const toolCallLog = await createToolCallLog()

  // ==================== Cron ====================

  const cronEngine = createCronEngine({ eventLog })

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

  if (config.marketData.backend === 'openbb-api') {
    const url = config.marketData.apiUrl
    const keys = config.marketData.providerKeys
    equityClient = new OpenBBEquityClient(url, providers.equity, keys)
    cryptoClient = new OpenBBCryptoClient(url, providers.crypto, keys)
    currencyClient = new OpenBBCurrencyClient(url, providers.currency, keys)
  } else {
    const executor = getSDKExecutor()
    const routeMap = buildRouteMap()
    const credentials = buildSDKCredentials(config.marketData.providerKeys)
    equityClient = new SDKEquityClient(executor, 'equity', providers.equity, credentials, routeMap)
    cryptoClient = new SDKCryptoClient(executor, 'crypto', providers.crypto, credentials, routeMap)
    currencyClient = new SDKCurrencyClient(executor, 'currency', providers.currency, credentials, routeMap)
  }

  // OpenBB API server is started later via optionalPlugins

  // ==================== Equity Symbol Index ====================

  const symbolIndex = new SymbolIndex()
  await symbolIndex.load(equityClient)

  // ==================== Tool Center ====================

  const toolCenter = new ToolCenter()
  toolCenter.register(createThinkingTools(), 'thinking')

  // One unified set of trading tools — routes via `source` parameter at runtime
  toolCenter.register(
    createTradingTools(accountManager),
    'trading',
  )

  toolCenter.register(createBrainTools(brain), 'brain')
  toolCenter.register(createBrowserTools(), 'browser')
  toolCenter.register(createCronTools(cronEngine), 'cron')
  toolCenter.register(createMarketSearchTools(symbolIndex, cryptoClient, currencyClient), 'market-search')
  toolCenter.register(createEquityTools(equityClient), 'equity')
  if (config.news.enabled) {
    toolCenter.register(createNewsArchiveTools(newsStore), 'news')
  }
  toolCenter.register(createAnalysisTools(equityClient, cryptoClient, currencyClient), 'analysis')

  console.log(`tool-center: ${toolCenter.list().length} tools registered`)

  // ==================== AI Provider Chain ====================

  const vercelProvider = new VercelAIProvider(
    () => toolCenter.getVercelTools(),
    instructions,
    config.agent.maxSteps,
  )
  const claudeCodeProvider = new ClaudeCodeProvider(instructions)
  const agentSdkProvider = new AgentSdkProvider(
    () => toolCenter.getVercelTools(),
    instructions,
  )
  const router = new GenerateRouter(vercelProvider, claudeCodeProvider, agentSdkProvider)

  const agentCenter = new AgentCenter({
    router,
    compaction: config.compaction,
    toolCallLog,
  })

  // ==================== Connector Center ====================

  const connectorCenter = new ConnectorCenter(eventLog)

  // ==================== Cron Lifecycle ====================

  await cronEngine.start()
  const cronSession = new SessionStore('cron/default')
  await cronSession.restore()
  const cronListener = createCronListener({ connectorCenter, eventLog, agentCenter, session: cronSession })
  cronListener.start()
  console.log('cron: engine + listener started')

  // ==================== Heartbeat ====================

  const heartbeat = createHeartbeat({
    config: config.heartbeat,
    connectorCenter, cronEngine, eventLog, agentCenter,
  })
  await heartbeat.start()
  if (config.heartbeat.enabled) {
    console.log(`heartbeat: enabled (every ${config.heartbeat.every})`)
  }

  // ==================== News Collector ====================

  let newsCollector: NewsCollector | null = null
  if (config.news.enabled && config.news.feeds.length > 0) {
    newsCollector = new NewsCollector({
      store: newsStore,
      feeds: config.news.feeds,
      intervalMs: config.news.intervalMinutes * 60 * 1000,
    })
    newsCollector.start()
    console.log(`news-collector: started (${config.news.feeds.length} feeds, every ${config.news.intervalMinutes}m)`)
  }

  // ==================== Account Reconnect ====================

  const reconnectingAccounts = new Set<string>()

  const reconnectAccount = async (accountId: string): Promise<ReconnectResult> => {
    if (reconnectingAccounts.has(accountId)) {
      return { success: false, error: 'Reconnect already in progress' }
    }
    reconnectingAccounts.add(accountId)
    try {
      // Re-read trading config to pick up credential/guard changes
      const freshTrading = await loadTradingConfig()

      // Close old account
      const currentUta = accountManager.get(accountId)
      if (currentUta) {
        await currentUta.close()
        accountManager.remove(accountId)
      }

      // Find this account in fresh config
      const accCfg = freshTrading.accounts.find((a) => a.id === accountId)
      if (!accCfg) {
        return { success: true, message: `Account "${accountId}" not found in config (removed or disabled)` }
      }

      // Build platform registry from fresh config
      const freshPlatforms = new Map<string, IPlatform>()
      for (const pc of freshTrading.platforms) {
        freshPlatforms.set(pc.id, createPlatformFromConfig(pc))
      }

      const platform = freshPlatforms.get(accCfg.platformId)
      if (!platform) {
        return { success: false, error: `Platform "${accCfg.platformId}" not found for account "${accountId}"` }
      }

      const ok = await initAccount(accCfg, platform)
      if (!ok) {
        return { success: false, error: `Account "${accountId}" init failed` }
      }

      // Re-register CCXT-specific tools if this is a CCXT account
      if (platform.providerType !== 'alpaca') {
        toolCenter.register(
          createCcxtProviderTools(accountManager),
          'trading-ccxt',
        )
      }

      const label = accountManager.get(accountId)?.label ?? accountId
      console.log(`reconnect: ${label} online`)
      return { success: true, message: `${label} reconnected` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`reconnect: ${accountId} failed:`, msg)
      return { success: false, error: msg }
    } finally {
      reconnectingAccounts.delete(accountId)
    }
  }

  // ==================== Plugins ====================

  // Core plugins — always-on, not toggleable at runtime
  const corePlugins: Plugin[] = []

  // MCP Server is always active when a port is set — Claude Code provider depends on it for tools
  if (config.connectors.mcp.port) {
    corePlugins.push(new McpPlugin(toolCenter, config.connectors.mcp.port))
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

  if (config.marketData.apiServer.enabled) {
    optionalPlugins.set('openbb-server', new OpenBBServerPlugin({ port: config.marketData.apiServer.port }))
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

      // --- OpenBB API Server ---
      const openbbWanted = fresh.marketData.apiServer.enabled
      const openbbRunning = optionalPlugins.has('openbb-server')
      if (openbbRunning && !openbbWanted) {
        await optionalPlugins.get('openbb-server')!.stop()
        optionalPlugins.delete('openbb-server')
        changes.push('openbb-server stopped')
      } else if (!openbbRunning && openbbWanted) {
        const p = new OpenBBServerPlugin({ port: fresh.marketData.apiServer.port })
        await p.start(ctx)
        optionalPlugins.set('openbb-server', p)
        changes.push('openbb-server started')
      } else if (openbbRunning && openbbWanted) {
        const current = optionalPlugins.get('openbb-server') as OpenBBServerPlugin
        if (current.port !== fresh.marketData.apiServer.port) {
          await current.stop()
          optionalPlugins.delete('openbb-server')
          const p = new OpenBBServerPlugin({ port: fresh.marketData.apiServer.port })
          await p.start(ctx)
          optionalPlugins.set('openbb-server', p)
          changes.push(`openbb-server restarted on port ${fresh.marketData.apiServer.port}`)
        }
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
    config, connectorCenter, agentCenter, eventLog, toolCallLog, heartbeat, cronEngine, toolCenter,
    accountManager,
    reconnectAccount,
    reconnectConnectors,
  }

  for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
    await plugin.start(ctx)
    console.log(`plugin started: ${plugin.name}`)
  }

  console.log('engine: started')

  // ==================== CCXT Background Injection ====================
  // CCXT accounts init in background (loadMarkets is slow). When done, register
  // CCXT-specific tools so the next agent call picks them up automatically.
  ccxtInitPromise.then(() => {
    // Check if any CCXT accounts were successfully registered
    const hasCcxt = accountManager.resolve().some((uta) => uta.broker instanceof CcxtBroker)
    if (!hasCcxt) return

    toolCenter.register(
      createCcxtProviderTools(accountManager),
      'trading-ccxt',
    )
    console.log('ccxt: provider tools registered')
  }).catch((err) => {
    console.error('ccxt: background init failed:', err instanceof Error ? err.message : String(err))
  })

  // ==================== Shutdown ====================

  let stopped = false
  const shutdown = async () => {
    stopped = true
    newsCollector?.stop()
    heartbeat.stop()
    cronListener.stop()
    cronEngine.stop()
    for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
      await plugin.stop()
    }
    await newsStore.close()
    await toolCallLog.close()
    await eventLog.close()
    await accountManager.closeAll()
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
