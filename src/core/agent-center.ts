/**
 * AgentCenter — centralized AI agent management.
 *
 * Owns the ProviderRouter and exposes `ask()` / `askWithSession()` that
 * always go through the provider route.  Engine delegates to AgentCenter
 * so that both stateless and session-aware calls are provider-routable.
 *
 * Future: subagent orchestration will be managed here.
 */

import type { AIProvider, AskOptions, ProviderResult } from './ai-provider.js'
import type { SessionStore } from './session.js'

export class AgentCenter {
  constructor(private provider: AIProvider) {}

  /** Stateless prompt — routed through the configured AI provider. */
  async ask(prompt: string): Promise<ProviderResult> {
    return this.provider.ask(prompt)
  }

  /** Prompt with session history — routed through the configured AI provider. */
  async askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<ProviderResult> {
    return this.provider.askWithSession(prompt, session, opts)
  }
}
