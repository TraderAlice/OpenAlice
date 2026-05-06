/**
 * AgentCenter — centralized AI agent orchestration.
 *
 * Owns the GenerateRouter and manages the full session pipeline:
 *   appendUser → compact → build input → call provider.generate() → pipeline → persist → done
 *
 * Providers are slim data-source adapters; all shared logic lives here:
 *   - Session management (append, compact, read active)
 *   - Unified pipeline (logToolCall, stripImageData, extractMedia)
 *   - Message persistence (intermediate tool messages + final response)
 *
 * History serialization (text vs messages) is each provider's responsibility.
 */

import type { AskOptions, ProviderResult, ProviderEvent, GenerateOpts } from './ai-provider-manager.js'
import type { ResolvedProfile } from './config.js'
import { GenerateRouter, StreamableResult } from './ai-provider-manager.js'
import type { ISessionStore, ContentBlock } from './session.js'
import type { CompactionConfig } from './compaction.js'
import { compactIfNeeded, forceCompact } from './compaction.js'
import type { MediaAttachment } from './types.js'
import { extractMediaFromToolResultContent } from './media.js'
import { persistMedia } from './media-store.js'
import { logToolCall, stripImageData, DEFAULT_MAX_HISTORY } from '../ai-providers/utils.js'
import type { ToolCallLog } from './tool-call-log.js'

// ==================== Types ====================

export interface AgentCenterOpts {
  router: GenerateRouter
  compaction: CompactionConfig
  /** Default history preamble for text-based providers. */
  historyPreamble?: string
  /** Default max history entries for text-based providers. */
  maxHistoryEntries?: number
  /** Structured tool call logger. */
  toolCallLog?: ToolCallLog
}

// ==================== AgentCenter ====================

export class AgentCenter {
  private router: GenerateRouter
  private compaction: CompactionConfig
  private defaultPreamble?: string
  private defaultMaxHistory: number
  private toolCallLog?: ToolCallLog

  constructor(opts: AgentCenterOpts) {
    this.router = opts.router
    this.compaction = opts.compaction
    this.defaultPreamble = opts.historyPreamble
    this.defaultMaxHistory = opts.maxHistoryEntries ?? DEFAULT_MAX_HISTORY
    this.toolCallLog = opts.toolCallLog
  }

  /** Stateless prompt — routed through the configured AI provider. */
  async ask(prompt: string): Promise<ProviderResult> {
    return this.router.ask(prompt)
  }

  /** Test a saved profile by sending a prompt to its provider. */
  async testProfile(profileSlug: string, prompt = 'Hi'): Promise<ProviderResult> {
    return this.router.askWithProfileSlug(prompt, profileSlug)
  }

  /** Test an unsaved profile (inline data). Used for pre-save connection testing. */
  async testWithProfile(profile: ResolvedProfile, prompt = 'Hi'): Promise<ProviderResult> {
    return this.router.askWithProfile(prompt, profile)
  }

  /** Prompt with session history — full orchestration pipeline. */
  askWithSession(prompt: string, session: ISessionStore, opts?: AskOptions): StreamableResult {
    return new StreamableResult(this._generate(prompt, session, opts))
  }

  /** Force a full compaction (summarization) of the session. */
  async forceCompact(session: ISessionStore, opts?: AskOptions): Promise<{ preTokens: number } | null> {
    const { provider } = await this.router.resolve(opts?.profileSlug)
    return forceCompact(session, async (summarizePrompt) => {
      const result = await provider.ask(summarizePrompt)
      return result.text
    })
  }

  // ==================== Pipeline ====================

  private async *_generate(
    prompt: string,
    session: ISessionStore,
    opts?: AskOptions,
  ): AsyncGenerator<ProviderEvent> {
    // 1. Append user message to session
    await session.appendUser(prompt, 'human')

    // 2. Resolve provider + profile (may be overridden per-request via profileSlug)
    const { provider, profile } = await this.router.resolve(opts?.profileSlug)

    // 3. Compact if needed (provider can override with custom strategy)
    const compactionResult = provider.compact
      ? await provider.compact(session, this.compaction)
      : await compactIfNeeded(
          session,
          this.compaction,
          async (summarizePrompt) => (await provider.ask(summarizePrompt)).text,
        )

    // 4. Read active window
    const entries = compactionResult.activeEntries ?? await session.readActive()

    // 5. Delegate to provider — each provider decides how to serialize history
    const genOpts: GenerateOpts = {
      systemPrompt: opts?.systemPrompt,
      historyPreamble: opts?.historyPreamble ?? this.defaultPreamble,
      maxHistoryEntries: opts?.maxHistoryEntries ?? this.defaultMaxHistory,
      disabledTools: opts?.disabledTools,
      profile,
    }
    const source = provider.generate(entries, prompt, genOpts)

    // 6. Consume provider events — unified pipeline
    const media: MediaAttachment[] = []
    const intermediateMessages: Array<{ role: 'assistant' | 'user'; content: ContentBlock[] }> = []
    let currentAssistantBlocks: ContentBlock[] = []
    let currentUserBlocks: ContentBlock[] = []
    let finalResult: ProviderResult | null = null

    for await (const event of source) {
      switch (event.type) {
        case 'tool_use':
          // Flush any pending tool results before starting a new assistant round
          if (currentUserBlocks.length > 0) {
            intermediateMessages.push({ role: 'user', content: currentUserBlocks })
            currentUserBlocks = []
          }
          // Unified logging — all providers get this now
          logToolCall(event.name, event.input)
          this.toolCallLog?.start(event.id, event.name, event.input, session.id)
          currentAssistantBlocks.push({
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input,
          })
          yield event
          break

        case 'tool_result': {
          // Unified media extraction + image stripping
          media.push(...extractMediaFromToolResultContent(event.content))
          const sessionContent = stripImageData(event.content)

          // Flush assistant blocks before accumulating tool results
          if (currentAssistantBlocks.length > 0) {
            intermediateMessages.push({ role: 'assistant', content: currentAssistantBlocks })
            currentAssistantBlocks = []
          }
          // Accumulate — parallel tool calls produce multiple results that must
          // land in a single user message, so we flush only when the next round starts.
          currentUserBlocks.push({
            type: 'tool_result',
            tool_use_id: event.tool_use_id,
            content: sessionContent,
          })
          await this.toolCallLog?.complete(event.tool_use_id, sessionContent)
          yield event
          break
        }

        case 'text':
          // Flush any pending tool results before assistant text (new round)
          if (currentUserBlocks.length > 0) {
            intermediateMessages.push({ role: 'user', content: currentUserBlocks })
            currentUserBlocks = []
          }
          currentAssistantBlocks.push({ type: 'text', text: event.text })
          yield event
          break

        case 'done':
          finalResult = event.result
          break
      }
    }

    // Clean up any orphaned pending tool calls (e.g. stream error before result)
    this.toolCallLog?.flushPending()

    // Flush any remaining user blocks (defensive — tool_result already flushes)
    // NOTE: Do NOT flush trailing assistant text blocks here — the authoritative
    // final text comes from the done event and is persisted once in step 8.
    if (currentUserBlocks.length > 0) {
      intermediateMessages.push({ role: 'user', content: currentUserBlocks })
    }

    // 7. Persist intermediate messages to session
    for (const msg of intermediateMessages) {
      if (msg.role === 'assistant') {
        await session.appendAssistant(msg.content, provider.providerTag)
      } else {
        await session.appendUser(msg.content, provider.providerTag)
      }
    }

    // 8. Persist final response as ContentBlock[] (text + media)
    if (!finalResult) throw new Error('AgentCenter: provider stream ended without done event')

    const allMedia = [...finalResult.media, ...media]
    const mediaBlocks: ContentBlock[] = []
    for (const m of allMedia) {
      try {
        const name = await persistMedia(m.path)
        mediaBlocks.push({ type: 'image', url: `/api/media/${name}` })
      } catch { /* temp file gone — skip */ }
    }

    const finalBlocks: ContentBlock[] = [
      { type: 'text', text: finalResult.text },
      ...mediaBlocks,
    ]
    await session.appendAssistant(finalBlocks, provider.providerTag)

    // 9. Yield done with merged media
    const mediaUrls = mediaBlocks.map(b => (b as { type: 'image'; url: string }).url)
    yield {
      type: 'done',
      result: {
        text: finalResult.text,
        media: allMedia,
        mediaUrls,
      },
    }
  }
}
