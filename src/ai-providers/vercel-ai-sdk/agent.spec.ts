import { describe, it, expect } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import { generateText, tool, stepCountIs } from 'ai'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { z } from 'zod'

/**
 * Helper: build a mock LanguageModelV3GenerateResult.
 *
 * AI SDK v6 changed the return shape significantly from v5:
 *   - `args` → `input` (tool call content)
 *   - `finishReason` is now `{ unified, raw }` instead of a plain string
 *   - `rawCall` was removed
 *   - `usage.inputTokens` / `outputTokens` require sub-fields (noCache, cacheRead, etc.)
 *   - `warnings` is required
 */
function mockResult(
  content: LanguageModelV3GenerateResult['content'],
  finish: 'stop' | 'tool-calls' = 'stop',
): LanguageModelV3GenerateResult {
  return {
    content,
    finishReason: { unified: finish, raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: undefined, reasoning: undefined },
    },
    warnings: [],
  }
}

function mockToolCall(toolName: string, args: Record<string, unknown>, id = 'call-1') {
  return mockResult(
    [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(args) }],
    'tool-calls',
  )
}

function mockText(text: string) {
  return mockResult([{ type: 'text', text }], 'stop')
}

/**
 * Helper: create a mock model that returns different results per call.
 *
 * NOTE: MockLanguageModelV3's array form doesn't advance properly in
 * multi-step tool loops. Use a function with a call counter instead.
 */
function sequentialModel(responses: LanguageModelV3GenerateResult[]) {
  let callCount = 0
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const response = responses[callCount] ?? responses[responses.length - 1]
      callCount++
      return response
    },
  })
}

/**
 * AI SDK v6 defaults to `stopWhen: stepCountIs(1)`, which means tool calls
 * are generated but never executed. For tool-loop agents, you MUST set
 * `stopWhen: stepCountIs(N)` with N > 1 to allow the execute→respond cycle.
 *
 * Also note: `result.toolResults` only contains the LAST step's results.
 * For earlier steps, check `result.steps[i].toolResults`.
 */
describe('Trading Agent', () => {
  it('calls fetchPrice tool when asked about price', async () => {
    const toolCalls: string[] = []

    const model = sequentialModel([
      mockToolCall('fetchPrice', { pair: 'BTC/USDT' }),
      mockText('BTC/USDT is at $95,000'),
    ])

    const result = await generateText({
      model,
      prompt: 'What is the current price of BTC?',
      tools: {
        fetchPrice: tool({
          description: 'Fetch current price of a trading pair',
          inputSchema: z.object({ pair: z.string() }),
          execute: async ({ pair }) => {
            toolCalls.push(pair)
            return { pair, price: 95000, timestamp: Date.now() }
          },
        }),
      },
      stopWhen: stepCountIs(10),
    })

    expect(toolCalls).toContain('BTC/USDT')
    expect(result.steps[0].toolResults.length).toBeGreaterThan(0)
  })

  it('respects risk check before executing trade', async () => {
    let tradeExecuted = false
    let riskChecked = false

    const model = sequentialModel([
      mockToolCall('riskCheck', { pair: 'BTC/USDT', amount: 0.1, side: 'buy' }),
      mockToolCall('executeTrade', { pair: 'BTC/USDT', amount: 0.1, side: 'buy' }, 'call-2'),
      mockText('Trade executed successfully.'),
    ])

    await generateText({
      model,
      prompt: 'Buy 0.1 BTC/USDT',
      tools: {
        riskCheck: tool({
          description: 'Check if trade passes risk rules',
          inputSchema: z.object({
            pair: z.string(),
            amount: z.number(),
            side: z.enum(['buy', 'sell']),
          }),
          execute: async (input) => {
            riskChecked = true
            const approved = input.amount <= 1.0
            return { approved, reason: approved ? 'within limits' : 'exceeds max position' }
          },
        }),
        executeTrade: tool({
          description: 'Execute a trade on the exchange',
          inputSchema: z.object({
            pair: z.string(),
            amount: z.number(),
            side: z.enum(['buy', 'sell']),
          }),
          execute: async () => {
            tradeExecuted = true
            return { orderId: 'mock-001', status: 'filled' }
          },
        }),
      },
      stopWhen: stepCountIs(10),
    })

    expect(riskChecked).toBe(true)
    expect(tradeExecuted).toBe(true)
  })

  it('agent stops when no tools are needed', async () => {
    const model = sequentialModel([
      mockText('Current portfolio looks healthy, no action needed.'),
    ])

    const result = await generateText({
      model,
      prompt: 'Check if any action is needed',
      tools: {
        executeTrade: tool({
          description: 'Execute a trade',
          inputSchema: z.object({ pair: z.string(), amount: z.number(), side: z.string() }),
          execute: async () => ({ orderId: 'x', status: 'filled' }),
        }),
      },
      stopWhen: stepCountIs(10),
    })

    expect(result.text).toContain('no action needed')
    expect(result.toolResults).toHaveLength(0)
  })
})
