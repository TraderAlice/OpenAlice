import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { Engine } from './core/engine.js'
import { loadConfig } from './core/config.js'
import type { Plugin, EngineContext, ReconnectResult } from './core/types.js'
import { McpPlugin } from './plugins/mcp.js'
import { TelegramPlugin } from './connectors/telegram/index.js'
import { WebPlugin } from './connectors/web/index.js'
import { McpAskPlugin } from './connectors/mcp-ask/index.js'
import { DiscordPlugin } from './connectors/discord/index.js'
import { createThinkingTools } from './extension/thinking-kit/index.js'
import type { WalletExportState } from './extension/crypto-trading/index.js'
import {
  Wallet,
  createCryptoTradingEngine,
  createCryptoTradingTools,
  createCryptoOperationDispatcher,
  createCryptoWalletStateBridge,
  createGuardPipeline,
  resolveGuards,
} from './extension/crypto-trading/index.js'
import type { SecOperation, SecWalletExportState } from './extension/securities-trading/index.js'
import {
  SecWallet,
  createSecuritiesTradingEngine,
  createSecuritiesTradingTools,
  createSecOperationDispatcher,
  createSecWalletStateBridge,
  createSecGuardPipeline,
  resolveSecGuards,
} from './extension/securities-trading/index.js'
import { Brain, createBrainTools } from './extension/brain/index.js'
import type { BrainExportState } from './extension/brain/index.js'
import { createBrowserTools } from './extension/browser/index.js'
import { OpenBBEquityClient, SymbolIndex } from './openbb/equity/index.js'
import { createEquityTools } from './extension/equity/index.js'
import { OpenBBCryptoClient } from './openbb/crypto/index.js'
import { OpenBBCurrencyClient } from './openbb/currency/index.js'
import { OpenBBEconomyClient } from './openbb/economy/index.js'
import { OpenBBCommodityClient } from './openbb/commodity/index.js'
import { OpenBBNewsClient } from './openbb/news/index.js'
import { createCryptoTools } from './extension/crypto/index.js'
import { createCurrencyTools } from './extension/currency/index.js'
import { createNewsTools } from './extension/news/index.js'
import { createAnalysisTools } from './extension/analysis-kit/index.js'
import { SessionStore } from './core/session.js'
import { ConnectorCenter } from './core/connector-center.js'
import { ToolCenter } from './core/tool-center.js'
import { AgentCenter } from './core/agent-center.js'
import { ProviderRouter } from './core/ai-provider.js'
import { VercelAIProvider } from './ai-providers/vercel-ai-sdk/vercel-provider.js'
import { ClaudeCodeProvider } from './ai-providers/claude-code/claude-code-provider.js'
import { createEventLog } from './core/event-log.js'
import { createCronEngine, createCronListener, createCronTools } from './task/cron/index.js'
import { createHeartbeat } from './task/heartbeat/index.js'
import { NewsCollectorStore, NewsCollector, wrapNewsToolsForPiggyback, createNewsArchiveTools } from './extension/news-collector/index.js'

const WALLET_FILE = resolve('data/crypto-trading/commit.json')
const SEC_WALLET_FILE = resolve('data/securities-trading/commit.json')
const BRAIN_FILE = resolve('data/brain/commit.json')
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

async function main() {
  const config = await loadConfig()

  // ==================== Infrastructure ====================

  // Start CCXT init in background — do NOT await here, letting everything else proceed immediately
  const cryptoInitPromise = createCryptoTradingEngine(config).catch((err) => {
    console.warn('crypto trading engine init failed (non-fatal, continuing without it):', err)
    return null
  })

  // Run Securities init + all local file reads in parallel
  const [
    secResultOrNull,
    savedState,
    secSavedState,
    brainExport,
    persona,
  ] = await Promise.all([
    createSecuritiesTradingEngine(config).catch((err) => {
      console.warn('securities trading engine init failed (non-fatal, continuing without it):', err)
      return null
    }),
    readFile(WALLET_FILE, 'utf-8').then((r) => JSON.parse(r) as WalletExportState).catch(() => undefined),
    readFile(SEC_WALLET_FILE, 'utf-8').then((r) => JSON.parse(r) as SecWalletExportState).catch(() => undefined),
    readFile(BRAIN_FILE, 'utf-8').then((r) => JSON.parse(r) as BrainExportState).catch(() => undefined),
    readWithDefault(PERSONA_FILE, PERSONA_DEFAULT),
  ])

  let secResultRef = secResultOrNull

  // ==================== Commit callbacks ====================

  const onCryptoCommit = async (state: WalletExportState) => {
    await mkdir(resolve('data/crypto-trading'), { recursive: true })
    await writeFile(WALLET_FILE, JSON.stringify(state, null, 2))
  }

  const onSecCommit = async (state: SecWalletExportState) => {
    await mkdir(resolve('data/securities-trading'), { recursive: true })
    await writeFile(SEC_WALLET_FILE, JSON.stringify(state, null, 2))
  }

  // ==================== Securities Trading ====================

  const secWalletStateBridge = secResultRef
    ? createSecWalletStateBridge(secResultRef.engine)
    : undefined

  const secGuards = resolveSecGuards(config.securities.guards)

  const secWalletConfig = secResultRef
    ? {
        executeOperation: createSecGuardPipeline(
          createSecOperationDispatcher(secResultRef.engine),
          secResultRef.engine,
          secGuards,
        ),
        getWalletState: secWalletStateBridge!,
        onCommit: onSecCommit,
      }
    : {
        executeOperation: async (_op: SecOperation) => {
          throw new Error('Securities trading service not connected')
        },
        getWalletState: async () => {
          throw new Error('Securities trading service not connected')
        },
        onCommit: onSecCommit,
      }

  const secWallet = secSavedState
    ? SecWallet.restore(secSavedState, secWalletConfig)
    : new SecWallet(secWalletConfig)

  // Mutable wallet references — updated on reconnect so REST getters always return current instance
  let currentCryptoWallet: InstanceType<typeof Wallet> | null = null
  let currentSecWallet: InstanceType<typeof SecWallet> = secWallet

  // Kept for shutdown cleanup reference (populated when CCXT resolves)
  let cryptoResultRef: Awaited<ReturnType<typeof createCryptoTradingEngine>> = null

  // ==================== Brain ====================

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

  // ==================== Cron ====================

  const cronEngine = createCronEngine({ eventLog })

  // ==================== News Collector Store ====================

  const newsStore = new NewsCollectorStore({
    maxInMemory: config.newsCollector.maxInMemory,
    retentionDays: config.newsCollector.retentionDays,
  })
  await newsStore.init()

  // ==================== OpenBB Clients ====================

  const providerKeys = config.openbb.providerKeys
  const { providers } = config.openbb
  const equityClient = new OpenBBEquityClient(config.openbb.apiUrl, providers.equity, providerKeys)
  const cryptoClient = new OpenBBCryptoClient(config.openbb.apiUrl, providers.crypto, providerKeys)
  const currencyClient = new OpenBBCurrencyClient(config.openbb.apiUrl, providers.currency, providerKeys)
  const commodityClient = new OpenBBCommodityClient(config.openbb.apiUrl, undefined, providerKeys)
  const economyClient = new OpenBBEconomyClient(config.openbb.apiUrl, undefined, providerKeys)
  const newsClient = new OpenBBNewsClient(config.openbb.apiUrl, undefined, providerKeys)

  // ==================== Equity Symbol Index ====================

  const symbolIndex = new SymbolIndex()
  await symbolIndex.load(equityClient)

  // ==================== Tool Center ====================

  const toolCenter = new ToolCenter()
  toolCenter.register(createThinkingTools())
  // Crypto trading tools are injected later in the background when CCXT resolves
  if (secResultRef) {
    toolCenter.register(createSecuritiesTradingTools(secResultRef.engine, secWallet, secWalletStateBridge))
  }
  toolCenter.register(createBrainTools(brain))
  toolCenter.register(createBrowserTools())
  toolCenter.register(createCronTools(cronEngine))
  toolCenter.register(createEquityTools(symbolIndex, equityClient))
  toolCenter.register(createCryptoTools(cryptoClient))
  toolCenter.register(createCurrencyTools(currencyClient))
  let newsTools = createNewsTools(newsClient, {
    companyProvider: providers.newsCompany,
    worldProvider: providers.newsWorld,
  })
  if (config.newsCollector.piggybackOpenBB) {
    newsTools = wrapNewsToolsForPiggyback(newsTools, newsStore)
  }
  toolCenter.register(newsTools)
  if (config.newsCollector.enabled) {
    toolCenter.register(createNewsArchiveTools(newsStore))
  }
  toolCenter.register(createAnalysisTools(equityClient, cryptoClient, currencyClient))

  console.log(`tool-center: ${toolCenter.list().length} tools registered (crypto trading pending ccxt)`)

  // ==================== AI Provider Chain ====================

  const vercelProvider = new VercelAIProvider(
    () => toolCenter.getVercelTools(),
    instructions,
    config.agent.maxSteps,
    config.compaction,
  )
  const claudeCodeProvider = new ClaudeCodeProvider(config.compaction, instructions)
  const router = new ProviderRouter(vercelProvider, claudeCodeProvider)

  const agentCenter = new AgentCenter(router)
  const engine = new Engine({ agentCenter })

  // ==================== Connector Center ====================

  const connectorCenter = new ConnectorCenter(eventLog)

  // ==================== Cron Lifecycle ====================

  await cronEngine.start()
  const cronSession = new SessionStore('cron/default')
  await cronSession.restore()
  const cronListener = createCronListener({ connectorCenter, eventLog, engine, session: cronSession })
  cronListener.start()
  console.log('cron: engine + listener started')

  // ==================== Heartbeat ====================

  const heartbeat = createHeartbeat({
    config: config.heartbeat,
    connectorCenter, cronEngine, eventLog, engine,
  })
  await heartbeat.start()
  if (config.heartbeat.enabled) {
    console.log(`heartbeat: enabled (every ${config.heartbeat.every})`)
  }

  // ==================== News Collector ====================

  let newsCollector: NewsCollector | null = null
  if (config.newsCollector.enabled && config.newsCollector.feeds.length > 0) {
    newsCollector = new NewsCollector({
      store: newsStore,
      feeds: config.newsCollector.feeds,
      intervalMs: config.newsCollector.intervalMinutes * 60 * 1000,
    })
    newsCollector.start()
    console.log(`news-collector: started (${config.newsCollector.feeds.length} feeds, every ${config.newsCollector.intervalMinutes}m)`)
  }

  // ==================== Engine Reconnect ====================

  let cryptoReconnecting = false
  const reconnectCrypto = async (): Promise<ReconnectResult> => {
    if (cryptoReconnecting) return { success: false, error: 'Reconnect already in progress' }
    cryptoReconnecting = true
    try {
      const freshConfig = await loadConfig()

      // Create new engine FIRST — if this fails, old engine stays functional
      const newResult = await createCryptoTradingEngine(freshConfig)
      await cryptoResultRef?.close()
      cryptoResultRef = newResult

      if (!newResult) {
        return { success: true, message: 'Crypto trading disabled (provider: none)' }
      }

      const bridge = createCryptoWalletStateBridge(newResult.engine)
      const rawDispatcher = createCryptoOperationDispatcher(newResult.engine)
      const guards = resolveGuards(freshConfig.crypto.guards)
      const walletConfig = {
        executeOperation: createGuardPipeline(rawDispatcher, newResult.engine, guards),
        getWalletState: bridge,
        onCommit: onCryptoCommit,
      }
      const savedWallet = await readFile(WALLET_FILE, 'utf-8')
        .then((r) => JSON.parse(r) as WalletExportState).catch(() => undefined)
      const newWallet = savedWallet ? Wallet.restore(savedWallet, walletConfig) : new Wallet(walletConfig)
      currentCryptoWallet = newWallet

      toolCenter.register(createCryptoTradingTools(newResult.engine, newWallet, bridge))
      console.log(`reconnect: crypto trading engine online (${toolCenter.list().length} tools)`)
      return { success: true, message: 'Crypto trading engine reconnected' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('reconnect: crypto failed:', msg)
      return { success: false, error: msg }
    } finally {
      cryptoReconnecting = false
    }
  }

  let secReconnecting = false
  const reconnectSecurities = async (): Promise<ReconnectResult> => {
    if (secReconnecting) return { success: false, error: 'Reconnect already in progress' }
    secReconnecting = true
    try {
      const freshConfig = await loadConfig()

      const newResult = await createSecuritiesTradingEngine(freshConfig)
      await secResultRef?.close()
      secResultRef = newResult

      if (!newResult) {
        return { success: true, message: 'Securities trading disabled (provider: none)' }
      }

      const bridge = createSecWalletStateBridge(newResult.engine)
      const rawDispatcher = createSecOperationDispatcher(newResult.engine)
      const guards = resolveSecGuards(freshConfig.securities.guards)
      const walletConfig = {
        executeOperation: createSecGuardPipeline(rawDispatcher, newResult.engine, guards),
        getWalletState: bridge,
        onCommit: onSecCommit,
      }
      const savedWallet = await readFile(SEC_WALLET_FILE, 'utf-8')
        .then((r) => JSON.parse(r) as SecWalletExportState).catch(() => undefined)
      const newWallet = savedWallet ? SecWallet.restore(savedWallet, walletConfig) : new SecWallet(walletConfig)
      currentSecWallet = newWallet

      toolCenter.register(createSecuritiesTradingTools(newResult.engine, newWallet, bridge))
      console.log(`reconnect: securities trading engine online (${toolCenter.list().length} tools)`)
      return { success: true, message: 'Securities trading engine reconnected' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('reconnect: securities failed:', msg)
      return { success: false, error: msg }
    } finally {
      secReconnecting = false
    }
  }

  // ==================== Plugins ====================

  // Core plugins — always-on, not toggleable at runtime
  const corePlugins: Plugin[] = []

  // MCP Server is always active when a port is set — Claude Code provider depends on it for tools
  if (config.connectors.mcp.port) {
    corePlugins.push(new McpPlugin(toolCenter.getMcpTools(), config.connectors.mcp.port))
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

  if (config.connectors.discord.enabled && config.connectors.discord.botToken) {
    optionalPlugins.set('discord', new DiscordPlugin({
      enabled: true,
      botToken: config.connectors.discord.botToken,
      channelId: config.connectors.discord.channelId,
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

  // --- Discord ---
  const discordWanted = fresh.connectors.discord.enabled && !!fresh.connectors.discord.botToken
  const discordRunning = optionalPlugins.has('discord')
  if (discordRunning && !discordWanted) {
    await optionalPlugins.get('discord')!.stop()
    optionalPlugins.delete('discord')
    changes.push('discord stopped')
  } else if (!discordRunning && discordWanted) {
    const p = new DiscordPlugin({
      enabled: true,
      botToken: fresh.connectors.discord.botToken!,
      channelId: fresh.connectors.discord.channelId,
    })
    await p.start(ctx)
    optionalPlugins.set('discord', p)
    changes.push('discord started')
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

  const ctx: EngineContext = {
    config, connectorCenter, engine, cryptoEngine: null, eventLog, heartbeat, cronEngine,
    reconnectCrypto, reconnectSecurities, reconnectConnectors,
    getCryptoEngine: () => cryptoResultRef?.engine ?? null,
    getSecuritiesEngine: () => secResultRef?.engine ?? null,
    getCryptoWallet: () => currentCryptoWallet,
    getSecWallet: () => currentSecWallet,
  }

  for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
    await plugin.start(ctx)
    console.log(`plugin started: ${plugin.name}`)
  }

  console.log('engine: started (crypto trading tools pending ccxt init)')

  // ==================== CCXT Background Injection ====================
  // When the CCXT engine is ready, register crypto trading tools so the next
  // agent call picks them up automatically (VercelAIProvider re-checks tool count).

  cryptoInitPromise.then((cryptoResult) => {
    cryptoResultRef = cryptoResult
    if (!cryptoResult) return
    const bridge = createCryptoWalletStateBridge(cryptoResult.engine)
    const rawDispatcher = createCryptoOperationDispatcher(cryptoResult.engine)
    const guards = resolveGuards(config.crypto.guards)
    const realWalletConfig = {
      executeOperation: createGuardPipeline(rawDispatcher, cryptoResult.engine, guards),
      getWalletState: bridge,
      onCommit: onCryptoCommit,
    }
    const realWallet = savedState
      ? Wallet.restore(savedState, realWalletConfig)
      : new Wallet(realWalletConfig)
    currentCryptoWallet = realWallet
    toolCenter.register(createCryptoTradingTools(cryptoResult.engine, realWallet, bridge))
    console.log(`ccxt: crypto trading tools online (${toolCenter.list().length} tools total)`)
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
    await eventLog.close()
    await cryptoResultRef?.close()
    await secResultRef?.close()
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
