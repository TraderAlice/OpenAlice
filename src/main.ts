import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { Engine } from './core/engine.js'
import { loadConfig } from './core/config.js'
import type { Plugin, EngineContext } from './core/types.js'
import { HttpPlugin } from './plugins/http.js'
import { McpPlugin } from './plugins/mcp.js'
import { TelegramPlugin } from './connectors/telegram/index.js'
import { WebPlugin } from './connectors/web/index.js'
import { McpAskPlugin } from './connectors/mcp-ask/index.js'
import { createThinkingTools } from './extension/thinking-kit/index.js'
import type { WalletExportState } from './extension/crypto-trading/index.js'
import {
  Wallet,
  initCryptoAllowedSymbols,
  createCryptoTradingEngine,
  createCryptoTradingTools,
  createCryptoOperationDispatcher,
  createCryptoWalletStateBridge,
} from './extension/crypto-trading/index.js'
import type { SecOperation, SecWalletExportState } from './extension/securities-trading/index.js'
import {
  SecWallet,
  initSecAllowedSymbols,
  createSecuritiesTradingEngine,
  createSecuritiesTradingTools,
  createSecOperationDispatcher,
  createSecWalletStateBridge,
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
import { createCryptoTools } from './extension/crypto/index.js'
import { createCurrencyTools } from './extension/currency/index.js'
import { createAnalysisTools } from './extension/analysis-kit/index.js'
import { SessionStore } from './core/session.js'
import { ToolCenter } from './core/tool-center.js'
import { AgentCenter } from './core/agent-center.js'
import { ProviderRouter } from './core/ai-provider.js'
import { VercelAIProvider } from './providers/vercel-ai-sdk/vercel-provider.js'
import { ClaudeCodeProvider } from './providers/claude-code/claude-code-provider.js'
import { createEventLog } from './core/event-log.js'
import { createCronEngine, createCronListener, createCronTools } from './task/cron/index.js'
import { createHeartbeat } from './task/heartbeat/index.js'

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

  // Initialize crypto trading symbol whitelist from config
  initCryptoAllowedSymbols(config.crypto.allowedSymbols)
  initSecAllowedSymbols(config.securities.allowedSymbols)

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

  const secResult = secResultOrNull

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

  const secWalletStateBridge = secResult
    ? createSecWalletStateBridge(secResult.engine)
    : undefined

  const secWalletConfig = secResult
    ? {
        executeOperation: createSecOperationDispatcher(secResult.engine),
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

  // ==================== OpenBB Clients ====================

  const providerKeys = config.openbb.providerKeys
  const { providers } = config.openbb
  const equityClient = new OpenBBEquityClient(config.openbb.apiUrl, providers.equity, providerKeys)
  const cryptoClient = new OpenBBCryptoClient(config.openbb.apiUrl, providers.crypto, providerKeys)
  const currencyClient = new OpenBBCurrencyClient(config.openbb.apiUrl, providers.currency, providerKeys)
  const commodityClient = new OpenBBCommodityClient(config.openbb.apiUrl, providers.commodity, providerKeys)
  const economyClient = new OpenBBEconomyClient(config.openbb.apiUrl, undefined, providerKeys)

  // ==================== Equity Symbol Index ====================

  const symbolIndex = new SymbolIndex()
  await symbolIndex.load(equityClient)

  // ==================== Tool Center ====================

  const toolCenter = new ToolCenter()
  toolCenter.register(createThinkingTools())
  // Crypto trading tools are injected later in the background when CCXT resolves
  if (secResult) {
    toolCenter.register(createSecuritiesTradingTools(secResult.engine, secWallet, secWalletStateBridge))
  }
  toolCenter.register(createBrainTools(brain))
  toolCenter.register(createBrowserTools())
  toolCenter.register(createCronTools(cronEngine))
  toolCenter.register(createEquityTools(symbolIndex))
  toolCenter.register(createCryptoTools(cryptoClient))
  toolCenter.register(createCurrencyTools(currencyClient))
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

  // ==================== Cron Lifecycle ====================

  await cronEngine.start()
  const cronSession = new SessionStore('cron/default')
  await cronSession.restore()
  const cronListener = createCronListener({ eventLog, engine, session: cronSession })
  cronListener.start()
  console.log('cron: engine + listener started')

  // ==================== Heartbeat ====================

  const heartbeat = createHeartbeat({
    config: config.heartbeat,
    cronEngine, eventLog, engine,
  })
  await heartbeat.start()
  if (config.heartbeat.enabled) {
    console.log(`heartbeat: enabled (every ${config.heartbeat.every})`)
  }

  // ==================== Plugins ====================

  const plugins: Plugin[] = [new HttpPlugin()]

  if (config.engine.mcpPort) {
    plugins.push(new McpPlugin(toolCenter.getMcpTools(), config.engine.mcpPort))
  }

  if (config.engine.askMcpPort) {
    plugins.push(new McpAskPlugin({ port: config.engine.askMcpPort }))
  }

  if (config.engine.webPort) {
    plugins.push(new WebPlugin({ port: config.engine.webPort }))
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    plugins.push(new TelegramPlugin({
      token: process.env.TELEGRAM_BOT_TOKEN,
      allowedChatIds: process.env.TELEGRAM_CHAT_ID
        ? process.env.TELEGRAM_CHAT_ID.split(',').map(Number)
        : [],
    }))
  }

  const ctx: EngineContext = { config, engine, cryptoEngine: null, eventLog, heartbeat, cronEngine }

  for (const plugin of plugins) {
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
    const realWalletConfig = {
      executeOperation: createCryptoOperationDispatcher(cryptoResult.engine),
      getWalletState: bridge,
      onCommit: onCryptoCommit,
    }
    const realWallet = savedState
      ? Wallet.restore(savedState, realWalletConfig)
      : new Wallet(realWalletConfig)
    toolCenter.register(createCryptoTradingTools(cryptoResult.engine, realWallet, bridge))
    console.log(`ccxt: crypto trading tools online (${toolCenter.list().length} tools total)`)
  })

  // ==================== Shutdown ====================

  let stopped = false
  const shutdown = async () => {
    stopped = true
    heartbeat.stop()
    cronListener.stop()
    cronEngine.stop()
    for (const plugin of plugins) {
      await plugin.stop()
    }
    await eventLog.close()
    await cryptoResultRef?.close()
    await secResult?.close()
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
