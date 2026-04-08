/**
 * Codex provider E2E tests — verifies real API communication.
 *
 * Requires ~/.codex/auth.json (run `codex login` first).
 * Skips gracefully if auth is not configured.
 *
 * Run: pnpm test:e2e
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import OpenAI from 'openai'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ==================== Setup ====================

const OAUTH_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const MODEL = 'gpt-5.4-mini' // Use mini for faster/cheaper e2e

let client: OpenAI | null = null

async function tryLoadToken(): Promise<string | null> {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  try {
    const raw = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf-8'))
    return raw?.tokens?.access_token ?? null
  } catch {
    return null
  }
}

beforeAll(async () => {
  const token = await tryLoadToken()
  if (!token) {
    console.warn('codex e2e: ~/.codex/auth.json not found, skipping tests')
    return
  }
  client = new OpenAI({ apiKey: token, baseURL: OAUTH_BASE_URL })
  console.log('codex e2e: client initialized')
}, 15_000)

// ==================== Tests ====================

describe('Codex API — basic communication', () => {
  beforeEach(({ skip }) => { if (!client) skip('no codex auth') })

  it('receives a text response for a simple prompt', async () => {
    const stream = client!.responses.stream({
      model: MODEL,
      instructions: 'You are a helpful assistant. Be very brief.',
      input: [{ role: 'user', content: 'What is 2+2? Answer with just the number.' }],
      store: false,
    })

    let text = ''
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') text += event.delta
    }

    expect(text).toBeTruthy()
    expect(text).toContain('4')
  }, 30_000)
})

describe('Codex API — tool call round-trip', () => {
  beforeEach(({ skip }) => { if (!client) skip('no codex auth') })

  const tools: OpenAI.Responses.Tool[] = [{
    type: 'function',
    name: 'get_price',
    description: 'Get the current price of a stock by symbol',
    parameters: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Stock ticker symbol' } },
      required: ['symbol'],
    },
    strict: null,
  }]

  it('receives a function call with call_id, name, and arguments', async () => {
    const stream = client!.responses.stream({
      model: MODEL,
      instructions: 'You are a stock assistant. Always use the get_price tool when asked about prices.',
      input: [{ role: 'user', content: 'What is the price of AAPL?' }],
      tools,
      store: false,
    })

    let funcCall: { call_id: string; name: string; arguments: string } | null = null
    for await (const event of stream) {
      if (event.type === 'response.output_item.done') {
        const item = (event as any).item
        if (item?.type === 'function_call') {
          funcCall = { call_id: item.call_id, name: item.name, arguments: item.arguments }
        }
      }
    }

    expect(funcCall).not.toBeNull()
    expect(funcCall!.call_id).toBeTruthy()
    expect(funcCall!.name).toBe('get_price')
    const args = JSON.parse(funcCall!.arguments)
    expect(args.symbol).toMatch(/AAPL/i)
  }, 30_000)

  it('completes a full tool call round-trip', async () => {
    // Round 1: get function call
    const stream1 = client!.responses.stream({
      model: MODEL,
      instructions: 'You are a stock assistant. Always use the get_price tool.',
      input: [{ role: 'user', content: 'Price of MSFT?' }],
      tools,
      store: false,
    })

    let funcCall: { call_id: string; name: string; arguments: string } | null = null
    for await (const event of stream1) {
      if (event.type === 'response.output_item.done') {
        const item = (event as any).item
        if (item?.type === 'function_call') {
          funcCall = { call_id: item.call_id, name: item.name, arguments: item.arguments }
        }
      }
    }

    expect(funcCall).not.toBeNull()

    // Round 2: send tool result back, get final text
    const stream2 = client!.responses.stream({
      model: MODEL,
      instructions: 'You are a stock assistant.',
      input: [
        { role: 'user', content: 'Price of MSFT?' },
        { type: 'function_call', call_id: funcCall!.call_id, name: funcCall!.name, arguments: funcCall!.arguments } as any,
        { type: 'function_call_output', call_id: funcCall!.call_id, output: '{"price": 420.50, "currency": "USD"}' } as any,
      ],
      tools,
      store: false,
    })

    let responseText = ''
    for await (const event of stream2) {
      if (event.type === 'response.output_text.delta') responseText += event.delta
    }

    expect(responseText).toBeTruthy()
    expect(responseText).toMatch(/420/i)
  }, 30_000)
})

describe('Codex API — structured multi-turn input', () => {
  beforeEach(({ skip }) => { if (!client) skip('no codex auth') })

  it('references earlier conversation context', async () => {
    const stream = client!.responses.stream({
      model: MODEL,
      instructions: 'You are a helpful assistant. Be very brief.',
      input: [
        { role: 'user', content: 'My name is Alice.' },
        { role: 'assistant', content: 'Nice to meet you, Alice!' },
        { role: 'user', content: 'What is my name?' },
      ],
      store: false,
    })

    let text = ''
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') text += event.delta
    }

    expect(text).toBeTruthy()
    expect(text.toLowerCase()).toContain('alice')
  }, 30_000)
})
