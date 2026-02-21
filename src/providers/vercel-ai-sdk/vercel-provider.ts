/**
 * VercelAIProvider — AIProvider implementation backed by Vercel AI SDK's ToolLoopAgent.
 *
 * Extracted from Engine.askWithSession() so Engine can delegate to any AIProvider.
 */

import type { ModelMessage } from 'ai'
import type { AIProvider, AskOptions, ProviderResult } from '../../core/ai-provider.js'
import type { Agent } from './agent.js'
import type { SessionStore } from '../../core/session.js'
import type { CompactionConfig } from '../../core/compaction.js'
import type { MediaAttachment } from '../../core/types.js'
import { toModelMessages } from '../../core/session.js'
import { compactIfNeeded } from '../../core/compaction.js'
import { extractMediaFromToolOutput } from '../../core/media.js'

export class VercelAIProvider implements AIProvider {
  constructor(
    private agent: Agent,
    private compaction: CompactionConfig,
  ) {}

  async ask(prompt: string): Promise<ProviderResult> {
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

  async askWithSession(prompt: string, session: SessionStore, _opts?: AskOptions): Promise<ProviderResult> {
    // AskOptions (historyPreamble, systemPrompt, etc.) are Claude Code–specific; silently ignored here.

    await session.appendUser(prompt, 'human')

    const compactionResult = await compactIfNeeded(
      session,
      this.compaction,
      async (summarizePrompt) => {
        const r = await this.agent.generate({ prompt: summarizePrompt })
        return r.text ?? ''
      },
    )

    const entries = compactionResult.activeEntries ?? await session.readActive()
    const messages = toModelMessages(entries)

    const media: MediaAttachment[] = []
    const result = await this.agent.generate({
      messages: messages as ModelMessage[],
      onStepFinish: (step) => {
        for (const tr of step.toolResults) {
          media.push(...extractMediaFromToolOutput(tr.output))
        }
      },
    })

    const text = result.text ?? ''
    await session.appendAssistant(text, 'engine')
    return { text, media }
  }
}
