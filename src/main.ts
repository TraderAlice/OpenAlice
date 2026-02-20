import { anthropic } from '@ai-sdk/anthropic'
import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { Engine } from './core/engine.js'
import { loadConfig } from './core/config.js'
import type { Plugin, EngineContext, MediaAttachment } from './core/types.js'
import { HttpPlugin } from './plugins/http.js'
import { McpPlugin } from './plugins/mcp.js'
import { TelegramPlugin } from './connectors/telegram/index.js'
import { WebPlugin } from './connectors/web/index.js'
import { Sandbox, RealMarketDataProvider, RealNewsProvider, fetchRealtimeData } from './extension/analysis-kit/index.js'
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
import { createCronTools } from './extension/cron/index.js'
import {
  createScheduler, stripAckToken,
  readHeartbeatFile, isHeartbeatFileEmpty, HeartbeatDedup,
  type Scheduler,
} from './core/scheduler.js'
import { createCronEngine, type CronEngine } from './core/cron.js'
import { resolveDeliveryTarget } from './core/connector-registry.js'
import { enqueue, ack, recoverPending } from './core/delivery.js'
import { emit } from './core/agent-events.js'
import { SessionStore } from './core/session.js'
import { readAIConfig } from './core/ai-config.js'
import { askClaudeCodeWithSession } from './providers/claude-code/index.js'

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
  const { marketData, news } = await fetchRealtimeData()
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

  // ==================== Tool Assembly ====================

  // Cron engine (created early so tools can reference it; timers start later after plugins)
  let cronEngine: CronEngine | null = null
  if (config.scheduler.cron.enabled) {
    cronEngine = createCronEngine({
      config: config.scheduler.cron,
      onWake: (reason) => scheduler?.requestWake(reason),
    })
  }

  const tools = {
    ...createAnalysisTools(sandbox),
    ...createCryptoTradingTools(cryptoEngine, wallet, cryptoWalletStateBridge),
    ...(secResult ? createSecuritiesTradingTools(secResult.engine, secWallet, secWalletStateBridge) : {}),
    ...createBrainTools(brain),
    ...createBrowserTools(),
    ...(cronEngine ? createCronTools(cronEngine) : {}),
  }

  // ==================== Engine ====================

  const engine = new Engine({
    model,
    tools,
    instructions,
    maxSteps: config.agent.maxSteps,
    compaction: config.compaction,
  })

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

  const ctx: EngineContext = { config, engine, sandbox, cryptoEngine }

  for (const plugin of plugins) {
    await plugin.start(ctx)
    console.log(`plugin started: ${plugin.name}`)
  }

  // ==================== Scheduling Subsystem ====================

  // Dedicated session for heartbeat/cron conversations (separate from user chat sessions)
  const heartbeatSession = new SessionStore('heartbeat')
  await heartbeatSession.restore()

  // Heartbeat dedup — suppress identical messages within 24h
  const heartbeatDedup = new HeartbeatDedup()

  // HEARTBEAT.md path (convention: workspace root)
  const heartbeatFilePath = resolve('HEARTBEAT.md')

  // RunOnce callback: bridge scheduler → engine → delivery
  const runOnce: Parameters<typeof createScheduler>[1] = async ({ reason, prompt, systemEvents }) => {
    // --- Guard 1: requests-in-flight ---
    // If the engine is already generating (e.g. user chat), defer this tick
    if (engine.isGenerating) {
      console.log('scheduler: engine busy, deferring heartbeat')
      return { status: 'skipped', reason: 'engine-busy' }
    }

    // --- Guard 2: empty heartbeat file ---
    // For interval/retry ticks, skip if HEARTBEAT.md has no actionable content.
    // Cron, manual, hook wakes always run regardless.
    const isLowPriority = reason === 'interval' || reason === 'retry'
    if (isLowPriority && systemEvents.length === 0) {
      const fileContent = await readHeartbeatFile(heartbeatFilePath)
      if (fileContent === null || isHeartbeatFileEmpty(fileContent)) {
        return { status: 'skipped', reason: 'empty-heartbeat-file' }
      }
    }

    // Build prompt — cron/exec events get a dedicated prompt instead of the heartbeat one
    const hasCronEvents = systemEvents.some((e) => e.source === 'cron')
    let fullPrompt: string

    if (hasCronEvents) {
      // Cron events: build a purpose-built prompt so the agent relays the reminder
      const eventLines = systemEvents.map((evt) => `- ${evt.text}`)
      fullPrompt = [
        'A scheduled reminder has been triggered. The reminder content is shown below.',
        'Please relay this reminder to the user in a helpful and friendly way.',
        'Do NOT reply with HEARTBEAT_OK — this is a cron event that must be delivered.',
        '',
        ...eventLines,
      ].join('\n')
    } else if (systemEvents.length > 0) {
      // Other system events (exec, etc.): append to heartbeat prompt
      const parts: string[] = [prompt, '', '--- System Events ---']
      for (const evt of systemEvents) {
        parts.push(`[${evt.source}] ${evt.text}`)
      }
      fullPrompt = parts.join('\n')
    } else {
      fullPrompt = prompt
    }

    // Route based on configured AI provider
    const aiConfig = await readAIConfig()
    console.log(`scheduler: runOnce provider=${aiConfig.provider} hasCronEvents=${hasCronEvents}`)
    let result: { text: string; media?: MediaAttachment[] }

    if (aiConfig.provider === 'claude-code') {
      result = await askClaudeCodeWithSession(fullPrompt, heartbeatSession, {
        claudeCode: config.agent.claudeCode,
        compaction: config.compaction,
        systemPrompt: instructions,
        maxHistoryEntries: 30,
        historyPreamble: 'The following is the recent heartbeat/cron conversation history. Use it as context if it references earlier events or decisions.',
      })
    } else {
      result = await engine.askWithSession(fullPrompt, heartbeatSession)
    }

    // Strip ack token to decide if the response should be delivered.
    // Cron events bypass the ack check — they must always be delivered.
    const { shouldSkip, text } = stripAckToken(
      result.text,
      config.scheduler.heartbeat.ackToken,
      config.scheduler.heartbeat.ackMaxChars,
    )

    if (shouldSkip && !hasCronEvents) {
      return { status: 'ok-ack', text }
    }

    if (!text.trim()) {
      return { status: 'ok-empty' }
    }

    // --- Guard 3: dedup ---
    // Suppress identical alert text within 24h window
    if (heartbeatDedup.isDuplicate(text)) {
      console.log('scheduler: duplicate heartbeat response suppressed')
      return { status: 'skipped', reason: 'duplicate' }
    }

    // Resolve delivery target (last-interacted channel)
    const target = resolveDeliveryTarget()
    if (!target) {
      console.warn('scheduler: no delivery target available, response dropped')
      return { status: 'skipped', reason: 'no-delivery-target', text }
    }

    // Persist to delivery queue first, then attempt immediate delivery
    const deliveryConfig = config.scheduler.delivery
    const entryId = await enqueue(deliveryConfig, {
      channel: target.channel,
      to: target.to,
      text,
    })

    try {
      await target.deliver(text)
      await ack(deliveryConfig, entryId)
      heartbeatDedup.record(text)
      emit('delivery', { status: 'sent', channel: target.channel, to: target.to })
      return { status: 'sent', text }
    } catch (err) {
      console.error('scheduler: delivery failed, queued for retry:', err)
      emit('delivery', { status: 'failed', channel: target.channel, error: String(err) })
      return { status: 'sent', text, reason: 'queued-for-retry' }
    }
  }

  // Create scheduler (timers start immediately if heartbeat enabled)
  let scheduler: Scheduler | null = null
  if (config.scheduler.heartbeat.enabled) {
    scheduler = createScheduler(
      { heartbeat: config.scheduler.heartbeat },
      runOnce,
    )
    console.log(`scheduler: heartbeat enabled (every ${config.scheduler.heartbeat.every})`)
  }

  if (cronEngine) {
    console.log('scheduler: cron enabled')
  }

  // ==================== Post-Plugin Init ====================
  // Plugins are started → connectors are registered → safe to start cron & recovery

  // Start cron engine (loads jobs from disk, arms timers)
  if (cronEngine) {
    await cronEngine.start()
  }

  // Recover any pending deliveries from previous runs (fire-and-forget)
  recoverPending({
    config: config.scheduler.delivery,
    deliver: async (entry) => {
      const target = resolveDeliveryTarget()
      if (!target) throw new Error('no delivery target')
      await target.deliver(entry.text)
    },
    log: { info: console.log, warn: console.warn },
  }).catch((err) => console.error('delivery recovery error:', err))

  // ==================== Shutdown ====================

  let stopped = false
  const shutdown = async () => {
    stopped = true
    scheduler?.stop()
    cronEngine?.stop()
    for (const plugin of plugins) {
      await plugin.stop()
    }
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
