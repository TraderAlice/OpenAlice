/**
 * Engine — AI conversation service.
 *
 * Thin facade that delegates all calls to AgentCenter, which routes
 * through the configured AI provider (Vercel AI SDK, Claude Code, etc.)
 * via ProviderRouter.
 *
 * Both `ask()` and `askWithSession()` go through the provider route.
 *
 * Concurrency control is NOT handled here — callers (Web, Telegram, Cron, etc.)
 * manage their own serialization as appropriate for their context.
 */

import type { MediaAttachment } from './types.js'
import type { SessionStore } from './session.js'
import type { AskOptions } from './ai-provider.js'
import type { AgentCenter } from './agent-center.js'

// ==================== Types ====================

export interface EngineOpts {
  /** The AgentCenter that owns provider routing. */
  agentCenter: AgentCenter
}

export interface EngineResult {
  text: string
  /** Media produced by tools during the generation (e.g. screenshots). */
  media: MediaAttachment[]
}

// ==================== Engine ====================

export class Engine {
  private agentCenter: AgentCenter

  constructor(opts: EngineOpts) {
    this.agentCenter = opts.agentCenter
  }

  // ==================== Public API ====================

  /** Simple prompt (no session context). Routed through the configured AI provider. */
  async ask(prompt: string): Promise<EngineResult> {
    return this.agentCenter.ask(prompt)
  }

  /** Prompt with session — routed through the configured AI provider. */
  async askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<EngineResult> {
    return this.agentCenter.askWithSession(prompt, session, opts)
  }
}
