/**
 * VercelAIProvider — GenerateProvider backed by Vercel AI SDK's ToolLoopAgent.
 *
 * The model is lazily created from config and cached.  When model.json or
 * api-keys.json changes on disk, the next request picks up the new model
 * automatically (hot-reload).
 */

import type { ModelMessage, Tool } from 'ai'
import type { ProviderResult, ProviderEvent } from '../../core/ai-provider.js'
import type { GenerateProvider, GenerateInput, GenerateOpts } from '../../core/ai-provider.js'
import type { Agent } from './agent.js'
import type { MediaAttachment } from '../../core/types.js'
import { extractMediaFromToolOutput } from '../../core/media.js'
import { createModelFromConfig, type ModelOverride } from './model-factory.js'
import { createAgent } from './agent.js'
import { createChannel } from '../../core/async-channel.js'

export class VercelAIProvider implements GenerateProvider {
  readonly inputKind = 'messages' as const
  readonly providerTag = 'vercel-ai' as const
  private cachedKey: string | null = null
  private cachedToolCount: number = 0
  private cachedSystemPrompt: string | null = null
  private cachedAgent: Agent | null = null

  constructor(
    private getTools: () => Promise<Record<string, Tool>>,
    private instructions: string,
    private maxSteps: number,
  ) {}

  /** Lazily create or return the cached agent, re-creating when config, tools, or system prompt change. */
  private async resolveAgent(systemPrompt?: string, disabledTools?: string[], modelOverride?: ModelOverride): Promise<Agent> {
    const { model, key } = await createModelFromConfig(modelOverride)
    const allTools = await this.getTools()

    // Per-channel overrides: skip cache and create a fresh agent
    if (disabledTools?.length || modelOverride) {
      const disabledSet = disabledTools?.length ? new Set(disabledTools) : null
      const tools = disabledSet
        ? Object.fromEntries(Object.entries(allTools).filter(([name]) => !disabledSet.has(name)))
        : allTools
      return createAgent(model, tools, systemPrompt ?? this.instructions, this.maxSteps)
    }

    const toolCount = Object.keys(allTools).length
    const effectivePrompt = systemPrompt ?? null
    if (key !== this.cachedKey || toolCount !== this.cachedToolCount || effectivePrompt !== this.cachedSystemPrompt) {
      this.cachedAgent = createAgent(model, allTools, systemPrompt ?? this.instructions, this.maxSteps)
      this.cachedKey = key
      this.cachedToolCount = toolCount
      this.cachedSystemPrompt = effectivePrompt
      console.log(`vercel-ai: model loaded → ${key} (${toolCount} tools)`)
    }
    return this.cachedAgent!
  }

  async ask(prompt: string): Promise<ProviderResult> {
    const agent = await this.resolveAgent(undefined)
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

  async *generate(input: GenerateInput, opts?: GenerateOpts): AsyncGenerator<ProviderEvent> {
    if (input.kind !== 'messages') throw new Error('VercelAIProvider expects messages input')

    const agent = await this.resolveAgent(input.systemPrompt, opts?.disabledTools, opts?.vercelAiSdk)

    const channel = createChannel<ProviderEvent>()
    const media: MediaAttachment[] = []

    const resultPromise = agent.generate({
      messages: input.messages as ModelMessage[],
      onStepFinish: (step) => {
        for (const tc of step.toolCalls) {
          channel.push({ type: 'tool_use', id: tc.toolCallId, name: tc.toolName, input: tc.input })
        }
        for (const tr of step.toolResults) {
          media.push(...extractMediaFromToolOutput(tr.output))
          const content = typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output ?? '')
          channel.push({ type: 'tool_result', tool_use_id: tr.toolCallId, content })
        }
        if (step.text) {
          channel.push({ type: 'text', text: step.text })
        }
      },
    })

    resultPromise.then(() => channel.close()).catch((err) => channel.error(err instanceof Error ? err : new Error(String(err))))
    yield* channel

    const result = await resultPromise
    yield { type: 'done', result: { text: result.text ?? '', media } }
  }

}
