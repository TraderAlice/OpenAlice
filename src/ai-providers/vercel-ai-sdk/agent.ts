import { ToolLoopAgent, stepCountIs } from 'ai'
import type { LanguageModel, Tool } from 'ai'
import { logToolCall } from '../log-tool-call.js'

/**
 * Create a generic ToolLoopAgent with externally-provided tools.
 *
 * The caller decides what tools the agent has — Engine wires in
 * sandbox-analysis tools (market data, trading, cognition, etc.).
 */
export function createAgent(
  model: LanguageModel,
  tools: Record<string, Tool>,
  instructions: string,
  maxSteps = 20,
) {
  return new ToolLoopAgent({
    model,
    tools,
    instructions,
    stopWhen: stepCountIs(maxSteps),
    onStepFinish: (step) => {
      for (const tc of step.toolCalls) {
        logToolCall(tc.toolName, tc.input)
      }
    },
  })
}

export type Agent = ReturnType<typeof createAgent>
