/**
 * Engine — AI conversation service.
 *
 * Owns the generation lock (one-at-a-time) and delegates to an AIProvider
 * for session-aware calls.  The stateless `ask()` still goes directly through
 * the Vercel AI SDK agent (for MCP, compaction callbacks, etc.).
 */

import type { MediaAttachment } from './types.js'
import type { SessionStore } from './session.js'
import type { AIProvider, AskOptions, ProviderResult } from './ai-provider.js'
import { type Agent } from '../providers/vercel-ai-sdk/index.js'
import { extractMediaFromToolOutput } from './media.js'

// ==================== Types ====================

export interface EngineOpts {
  /** Pre-built Vercel AI SDK agent (still used by `ask()`). */
  agent: Agent
  /** The provider router (or any AIProvider) that handles session-aware calls. */
  provider: AIProvider
}

export interface EngineResult {
  text: string
  /** Media produced by tools during the generation (e.g. screenshots). */
  media: MediaAttachment[]
}

// ==================== Engine ====================

export class Engine {
  private generationLock = Promise.resolve()
  private _generating = false
  private provider: AIProvider

  /** The underlying ToolLoopAgent (used by `ask()`). */
  readonly agent: Agent

  constructor(opts: EngineOpts) {
    this.agent = opts.agent
    this.provider = opts.provider
  }

  // ==================== Public API ====================

  /** Whether a generation is currently in progress (for requests-in-flight guard). */
  get isGenerating(): boolean { return this._generating }

  /** Simple prompt (no session context). Uses the Vercel agent directly. */
  async ask(prompt: string): Promise<EngineResult> {
    const media: MediaAttachment[] = []
    const result = await this.withLock(() => this.agent.generate({
      prompt,
      onStepFinish: (step) => {
        for (const tr of step.toolResults) {
          media.push(...extractMediaFromToolOutput(tr.output))
        }
      },
    }))
    return { text: result.text ?? '', media }
  }

  /** Prompt with session — delegates to the configured AIProvider, serialized by the generation lock. */
  async askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<EngineResult> {
    return this.withLock(() => this.provider.askWithSession(prompt, session, opts))
  }

  // ==================== Internals ====================

  /** Serialize concurrent calls — one generation at a time. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.generationLock
    let resolve!: () => void
    this.generationLock = new Promise<void>((r) => { resolve = r })
    await prev
    this._generating = true
    try {
      return await fn()
    } finally {
      this._generating = false
      resolve()
    }
  }
}
