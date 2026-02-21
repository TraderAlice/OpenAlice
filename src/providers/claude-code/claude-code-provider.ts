/**
 * ClaudeCodeProvider — AIProvider implementation backed by the Claude Code CLI.
 *
 * Thin adapter: delegates to askClaudeCodeWithSession which owns the full
 * session management flow (append → compact → build <chat_history> → call CLI → persist).
 */

import type { AIProvider, AskOptions, ProviderResult } from '../../core/ai-provider.js'
import type { SessionStore } from '../../core/session.js'
import type { CompactionConfig } from '../../core/compaction.js'
import type { ClaudeCodeConfig } from './types.js'
import { askClaudeCode } from './provider.js'
import { askClaudeCodeWithSession } from './session.js'

export class ClaudeCodeProvider implements AIProvider {
  constructor(
    private claudeCodeConfig: ClaudeCodeConfig,
    private compaction: CompactionConfig,
  ) {}

  async ask(prompt: string): Promise<ProviderResult> {
    const result = await askClaudeCode(prompt, this.claudeCodeConfig)
    return { text: result.text, media: [] }
  }

  async askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<ProviderResult> {
    return askClaudeCodeWithSession(prompt, session, {
      claudeCode: this.claudeCodeConfig,
      compaction: this.compaction,
      ...opts,
    })
  }
}
