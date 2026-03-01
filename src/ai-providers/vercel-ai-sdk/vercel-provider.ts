/**
 * VercelAIProvider — AIProvider implementation backed by Vercel AI SDK's ToolLoopAgent.
 *
 * The model is lazily created from config and cached.  When model.json or
 * api-keys.json changes on disk, the next request picks up the new model
 * automatically (hot-reload).
 */

import type { ModelMessage, Tool } from 'ai'
import type { AIProvider, AskOptions, ProviderResult } from '../../core/ai-provider.js'
import type { Agent } from './agent.js'
import type { SessionStore } from '../../core/session.js'
import type { CompactionConfig } from '../../core/compaction.js'
import type { MediaAttachment } from '../../core/types.js'
import { toModelMessages } from '../../core/session.js'
import { compactIfNeeded } from '../../core/compaction.js'
import { extractMediaFromToolOutput } from '../../core/media.js'
import { createModelFromConfig } from '../../core/model-factory.js'
import { createAgent } from './agent.js'

export class VercelAIProvider implements AIProvider {
  private cachedKey: string | null = null
  private cachedToolCount: number = 0
  private cachedAgent: Agent | null = null

  constructor(
    private getTools: () => Promise<Record<string, Tool>>,
    private instructions: string,
    private maxSteps: number,
    private compaction: CompactionConfig,
  ) {}

  /** Lazily create or return the cached agent, re-creating when config or tools change. */
  private async resolveAgent(): Promise<Agent> {
    const { model, key } = await createModelFromConfig()
    const tools = await this.getTools()
    const toolCount = Object.keys(tools).length
    if (key !== this.cachedKey || toolCount !== this.cachedToolCount) {
      this.cachedAgent = createAgent(model, tools, this.instructions, this.maxSteps)
      this.cachedKey = key
      this.cachedToolCount = toolCount
      console.log(`vercel-ai: model loaded → ${key} (${toolCount} tools)`)
    }
    return this.cachedAgent!
  }

  async ask(prompt: string): Promise<ProviderResult> {
    const agent = await this.resolveAgent()
    const media: MediaAttachment[] = []
    const result = await agent.generate({
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
    const agent = await this.resolveAgent()

    await session.appendUser(prompt, 'human')

    const compactionResult = await compactIfNeeded(
      session,
      this.compaction,
      async (summarizePrompt) => {
        const r = await agent.generate({ prompt: summarizePrompt })
        return r.text ?? ''
      },
    )

    const entries = compactionResult.activeEntries ?? await session.readActive()
    const messages = toModelMessages(entries)

    const media: MediaAttachment[] = []
    const result = await agent.generate({
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
