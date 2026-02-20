import { anthropic } from '@ai-sdk/anthropic'
import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { Engine } from './core/engine.js'
import { loadConfig } from './core/config.js'
import type { Plugin, EngineContext } from './core/types.js'
import { HttpPlugin } from './plugins/http.js'
import { McpPlugin } from './plugins/mcp.js'
import { TelegramPlugin } from './connectors/telegram/index.js'
import { WebPlugin } from './connectors/web/index.js'
import { Sandbox, RealMarketDataProvider, RealNewsProvider, fetchRealtimeData } from './extension/analysis-kit/index.js'
import type { MarketData, NewsItem } from './extension/analysis-kit/index.js'
import { createAnalysisTools } from './extension/analysis-kit/index.js'
import type { ICryptoTradingEngine, Operation, WalletExportState } from './extension/crypto-trading/index.js'
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
import { SessionStore } from './core/session.js'
import { ProviderRouter } from './core/ai-provider.js'
import { createAgent } from './providers/vercel-ai-sdk/index.js'
import { VercelAIProvider } from './providers/vercel-ai-sdk/vercel-provider.js'
import { ClaudeCodeProvider } from './providers/claude-code/claude-code-provider.js'
import { createEventLog } from './core/event-log.js'
import { createCronEngine, createCronListener, createCronTools } from './task/cron/index.js'

const WALLET_FILE = resolve('data/crypto-trading/commit.json')
const SEC_WALLET_FILE = resolve('data/securities-trading/commit.json')
const BRAIN_FILE = resolve('data/brain/commit.json')
const FRONTAL_LOBE_FILE = resolve('data/brain/frontal-lobe.md')
const EMOTION_LOG_FILE = resolve('data/brain/emotion-log.md')
const PERSONA_FILE = resolve('data/config/persona.md')

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function main() {
  const config = await loadConfig()
  const model = anthropic(config.model.model)

  // ==================== Infrastructure ====================

  // Initialize crypto trading symbol whitelist from config
  initCryptoAllowedSymbols(config.crypto.allowedSymbols)

  // Crypto trading engine (CCXT or none) — non-fatal on failure
  let cryptoResult: Awaited<ReturnType<typeof createCryptoTradingEngine>> = null
  try {
    cryptoResult = await createCryptoTradingEngine(config)
  } catch (err) {
    console.warn('crypto trading engine init failed (non-fatal, continuing without it):', err)
  }
  const cryptoEngine: ICryptoTradingEngine = cryptoResult?.engine ?? null as unknown as ICryptoTradingEngine

  // Wallet: wire callbacks to crypto trading engine (or throw stubs if no provider)
  const cryptoWalletStateBridge = cryptoResult
    ? createCryptoWalletStateBridge(cryptoResult.engine)
    : undefined

  const onCryptoCommit = async (state: WalletExportState) => {
    await mkdir(resolve('data/crypto-trading'), { recursive: true })
    await writeFile(WALLET_FILE, JSON.stringify(state, null, 2))
  }

  const cryptoWalletConfig = cryptoResult
    ? {
        executeOperation: createCryptoOperationDispatcher(cryptoResult.engine),
        getWalletState: cryptoWalletStateBridge!,
        onCommit: onCryptoCommit,
      }
    : {
        executeOperation: async (_op: Operation) => {
          throw new Error('Crypto trading service not connected')
        },
        getWalletState: async () => {
          throw new Error('Crypto trading service not connected')
        },
        onCommit: onCryptoCommit,
      }

  // Restore wallet from disk if available
  let savedState: WalletExportState | undefined
  try {
    const raw = await readFile(WALLET_FILE, 'utf-8')
    savedState = JSON.parse(raw)
  } catch { /* file not found → fresh start */ }

  const wallet = savedState
    ? Wallet.restore(savedState, cryptoWalletConfig)
    : new Wallet(cryptoWalletConfig)

  // ==================== Securities Trading ====================

  initSecAllowedSymbols(config.securities.allowedSymbols)

  let secResult: Awaited<ReturnType<typeof createSecuritiesTradingEngine>> = null
  try {
    secResult = await createSecuritiesTradingEngine(config)
  } catch (err) {
    console.warn('securities trading engine init failed (non-fatal, continuing without it):', err)
  }

  const secWalletStateBridge = secResult
    ? createSecWalletStateBridge(secResult.engine)
    : undefined

  const onSecCommit = async (state: SecWalletExportState) => {
    await mkdir(resolve('data/securities-trading'), { recursive: true })
    await writeFile(SEC_WALLET_FILE, JSON.stringify(state, null, 2))
  }

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

  let secSavedState: SecWalletExportState | undefined
  try {
    const raw = await readFile(SEC_WALLET_FILE, 'utf-8')
    secSavedState = JSON.parse(raw)
  } catch { /* file not found → fresh start */ }

  const secWallet = secSavedState
    ? SecWallet.restore(secSavedState, secWalletConfig)
    : new SecWallet(secWalletConfig)

  // Sandbox (data access + realtime market & news data)
  let marketData: Record<string, MarketData[]> = {}
  let news: NewsItem[] = []
  try {
    const realtimeData = await fetchRealtimeData()
    marketData = realtimeData.marketData
    news = realtimeData.news
  } catch (err) {
    console.warn('DotAPI initial fetch failed (non-fatal, starting with empty data):', err)
  }
  const marketProvider = new RealMarketDataProvider(marketData)
  const newsProvider = new RealNewsProvider(news)

  const sandbox = new Sandbox(
    { timeframe: config.engine.timeframe },
    marketProvider,
    newsProvider,
  )

  // Brain: cognitive state with commit-based tracking
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

  let brainExport: BrainExportState | undefined
  try {
    const raw = await readFile(BRAIN_FILE, 'utf-8')
    brainExport = JSON.parse(raw)
  } catch { /* not found → fresh start */ }

  const brain = brainExport
    ? Brain.restore(brainExport, { onCommit: brainOnCommit })
    : new Brain({ onCommit: brainOnCommit })

  // Build system prompt: persona + current brain state
  let persona = ''
  try { persona = await readFile(PERSONA_FILE, 'utf-8') } catch { /* use empty */ }

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

  // Refresh market data & news periodically
  setInterval(async () => {
    try {
      const { marketData, news } = await fetchRealtimeData()
      marketProvider.reload(marketData)
      newsProvider.reload(news)
    } catch (err) {
      console.error('DotAPI refresh failed:', err)
    }
  }, config.engine.dataRefreshInterval)

  // ==================== Event Log ====================

  const eventLog = await createEventLog()

  // ==================== Cron ====================

  const cronEngine = createCronEngine({ eventLog })

  // ==================== Tool Assembly ====================

  const tools = {
    ...createAnalysisTools(sandbox),
    ...createCryptoTradingTools(cryptoEngine, wallet, cryptoWalletStateBridge),
    ...(secResult ? createSecuritiesTradingTools(secResult.engine, secWallet, secWalletStateBridge) : {}),
    ...createBrainTools(brain),
    ...createBrowserTools(),
    ...createCronTools(cronEngine),
  }

  // ==================== AI Provider Chain ====================

  const agent = createAgent(model, tools, instructions, config.agent.maxSteps)
  const vercelProvider = new VercelAIProvider(agent, config.compaction)
  const claudeCodeProvider = new ClaudeCodeProvider(config.agent.claudeCode, config.compaction)
  const router = new ProviderRouter(vercelProvider, claudeCodeProvider)

  const engine = new Engine({ agent, tools, provider: router })

  // ==================== Cron Lifecycle ====================

  await cronEngine.start()
  const cronSession = new SessionStore('cron/default')
  await cronSession.restore()
  const cronListener = createCronListener({ eventLog, engine, session: cronSession })
  cronListener.start()
  console.log('cron: engine + listener started')

  // ==================== Plugins ====================

  const plugins: Plugin[] = [new HttpPlugin()]

  if (config.engine.mcpPort) {
    plugins.push(new McpPlugin(engine.tools, config.engine.mcpPort))
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

  const ctx: EngineContext = { config, engine, sandbox, cryptoEngine, eventLog }

  for (const plugin of plugins) {
    await plugin.start(ctx)
    console.log(`plugin started: ${plugin.name}`)
  }

  // ==================== Shutdown ====================

  let stopped = false
  const shutdown = async () => {
    stopped = true
    cronListener.stop()
    cronEngine.stop()
    for (const plugin of plugins) {
      await plugin.stop()
    }
    await eventLog.close()
    await cryptoResult?.close()
    await secResult?.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // ==================== Tick Loop ====================

  console.log('engine: started')
  while (!stopped) {
    sandbox.setPlayheadTime(new Date())
    await sleep(config.engine.interval)
  }
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
