/**
 * Engine — AI conversation service.
 *
 * Thin wrapper over an AIProvider. Delegates stateless calls to the Vercel
 * agent and session-aware calls to the configured provider (via ProviderRouter).
 *
 * Concurrency control is NOT handled here — callers (Web, Telegram, Cron, etc.)
 * manage their own serialization as appropriate for their context.
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
  private provider: AIProvider

  /** The underlying ToolLoopAgent (used by `ask()`). */
  readonly agent: Agent

  constructor(opts: EngineOpts) {
    this.agent = opts.agent
    this.provider = opts.provider
  }

  // ==================== Public API ====================

  /** Simple prompt (no session context). Uses the Vercel agent directly. */
  async ask(prompt: string): Promise<EngineResult> {
    const media: MediaAttachment[] = []
    const result = await this.agent.generate({
      prompt,
      onStepFinish: (step) => {
        for (const tr of step.toolResults) {
          media.push(...extractMediaFromToolOutput(tr.output))
        }
      },
    })
    return { text: result.text ?? '', media }
  }

  /** Prompt with session — delegates to the configured AIProvider. */
  async askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<EngineResult> {
    return this.provider.askWithSession(prompt, session, opts)
  }
}
