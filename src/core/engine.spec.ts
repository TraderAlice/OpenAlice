import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel, Tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { Engine, type EngineResult } from './engine.js'
import { DEFAULT_COMPACTION_CONFIG, type CompactionConfig } from './compaction.js'
import { createAgent } from '../providers/vercel-ai-sdk/index.js'
import { VercelAIProvider } from '../providers/vercel-ai-sdk/vercel-provider.js'
import type { SessionStore, SessionEntry } from './session.js'

// ==================== Helpers ====================

/** Minimal LanguageModelV3GenerateResult for the mock. */
function makeDoGenerate(text = 'mock response') {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    },
    warnings: [],
  }
}

function makeMockModel(text = 'mock response') {
  return new MockLanguageModelV3({ doGenerate: makeDoGenerate(text) })
}

interface MakeEngineOpts {
  model?: LanguageModel
  tools?: Record<string, Tool>
  instructions?: string
  maxSteps?: number
  compaction?: CompactionConfig
}

function makeEngine(overrides: MakeEngineOpts = {}): Engine {
  const model = overrides.model ?? makeMockModel()
  const tools = overrides.tools ?? {}
  const instructions = overrides.instructions ?? 'You are a test agent.'
  const maxSteps = overrides.maxSteps ?? 1
  const compaction = overrides.compaction ?? DEFAULT_COMPACTION_CONFIG

  const agent = createAgent(model, tools, instructions, maxSteps)
  const provider = new VercelAIProvider(agent, compaction)

  return new Engine({ agent, provider })
}

/** In-memory SessionStore mock (no filesystem). */
function makeSessionMock(entries: SessionEntry[] = []): SessionStore {
  const store: SessionEntry[] = [...entries]
  return {
    id: 'test-session',
    appendUser: vi.fn(async (content: string) => {
      const e: SessionEntry = {
        type: 'user',
        message: { role: 'user', content },
        uuid: `u-${store.length}`,
        parentUuid: null,
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
      }
      store.push(e)
      return e
    }),
    appendAssistant: vi.fn(async (content: string) => {
      const e: SessionEntry = {
        type: 'assistant',
        message: { role: 'assistant', content },
        uuid: `a-${store.length}`,
        parentUuid: null,
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
      }
      store.push(e)
      return e
    }),
    appendRaw: vi.fn(async () => {}),
    readAll: vi.fn(async () => [...store]),
    readActive: vi.fn(async () => [...store]),
    restore: vi.fn(async () => {}),
    exists: vi.fn(async () => store.length > 0),
  } as unknown as SessionStore
}

// ==================== Mock compaction ====================

vi.mock('./compaction.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./compaction.js')>()
  return {
    ...actual,
    compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false, method: 'none' }),
  }
})

// ==================== Tests ====================

describe('Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------- Construction --------------------

  describe('constructor', () => {
    it('creates an engine with agent and provider', () => {
      const engine = makeEngine({ instructions: 'custom instructions' })
      expect(engine.agent).toBeDefined()
    })
  })

  // -------------------- ask() --------------------

  describe('ask()', () => {
    it('returns text from the model', async () => {
      const model = makeMockModel('hello world')
      const engine = makeEngine({ model })

      const result = await engine.ask('say hello')
      expect(result.text).toBe('hello world')
      expect(result.media).toEqual([])
    })

    it('returns empty string when model returns null text', async () => {
      const model = new MockLanguageModelV3({
        doGenerate: {
          content: [],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 0, text: 0, reasoning: undefined },
          },
          warnings: [],
        },
      })
      const engine = makeEngine({ model })

      const result = await engine.ask('empty response')
      expect(result.text).toBe('')
    })

    it('collects media from tool results via onStepFinish', async () => {
      // Use a model that produces tool calls to test media extraction.
      // Since MockLanguageModelV3 doesn't easily simulate multi-step tool calls,
      // we'll test media extraction at the unit level separately.
      // Here we verify the basic flow returns empty media when no tools produce media.
      const model = makeMockModel('no media')
      const engine = makeEngine({ model })

      const result = await engine.ask('test')
      expect(result.media).toEqual([])
    })
  })

  // -------------------- askWithSession() --------------------

  describe('askWithSession()', () => {
    it('appends user message to session before generating', async () => {
      const model = makeMockModel('session response')
      const engine = makeEngine({ model })
      const session = makeSessionMock()

      await engine.askWithSession('user prompt', session)

      expect(session.appendUser).toHaveBeenCalledWith('user prompt', 'human')
    })

    it('appends assistant response to session after generating', async () => {
      const model = makeMockModel('assistant reply')
      const engine = makeEngine({ model })
      const session = makeSessionMock()

      await engine.askWithSession('hello', session)

      expect(session.appendAssistant).toHaveBeenCalledWith('assistant reply', 'engine')
    })

    it('returns the generated text and empty media', async () => {
      const model = makeMockModel('generated text')
      const engine = makeEngine({ model })
      const session = makeSessionMock()

      const result = await engine.askWithSession('prompt', session)
      expect(result.text).toBe('generated text')
      expect(result.media).toEqual([])
    })

    it('calls compactIfNeeded with session and compaction config', async () => {
      const { compactIfNeeded } = await import('./compaction.js')
      const model = makeMockModel('ok')
      const compaction: CompactionConfig = {
        maxContextTokens: 100_000,
        maxOutputTokens: 10_000,
        autoCompactBuffer: 5_000,
        microcompactKeepRecent: 2,
      }
      const engine = makeEngine({ model, compaction })
      const session = makeSessionMock()

      await engine.askWithSession('test', session)

      expect(compactIfNeeded).toHaveBeenCalledWith(
        session,
        compaction,
        expect.any(Function),
      )
    })

    it('uses activeEntries from compaction result when available', async () => {
      const { compactIfNeeded } = await import('./compaction.js')
      const activeEntries: SessionEntry[] = [{
        type: 'user',
        message: { role: 'user', content: 'compacted entry' },
        uuid: 'c1',
        parentUuid: null,
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
      }]
      vi.mocked(compactIfNeeded).mockResolvedValueOnce({
        compacted: true,
        method: 'microcompact',
        activeEntries,
      })

      const model = makeMockModel('from compacted')
      const engine = makeEngine({ model })
      const session = makeSessionMock()

      const result = await engine.askWithSession('test', session)
      expect(result.text).toBe('from compacted')
      // readActive should NOT be called when activeEntries is provided
      expect(session.readActive).not.toHaveBeenCalled()
    })

    it('falls back to session.readActive when no activeEntries', async () => {
      const { compactIfNeeded } = await import('./compaction.js')
      vi.mocked(compactIfNeeded).mockResolvedValueOnce({
        compacted: false,
        method: 'none',
      })

      const model = makeMockModel('from readActive')
      const engine = makeEngine({ model })
      const session = makeSessionMock()

      await engine.askWithSession('test', session)
      expect(session.readActive).toHaveBeenCalled()
    })
  })

  // -------------------- withLock (concurrency) --------------------

  describe('concurrency', () => {
    it('serializes concurrent ask() calls', async () => {
      const order: number[] = []
      let callCount = 0
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          const n = ++callCount
          order.push(n)
          // Simulate async delay
          await new Promise((r) => setTimeout(r, 10))
          return makeDoGenerate(`response ${n}`)
        },
      })
      const engine = makeEngine({ model })

      // Launch two concurrent requests
      const [r1, r2] = await Promise.all([
        engine.ask('first'),
        engine.ask('second'),
      ])

      // Both should complete — order should be sequential (1 before 2)
      expect(order).toEqual([1, 2])
      expect(r1.text).toBe('response 1')
      expect(r2.text).toBe('response 2')
    })

    it('serializes concurrent askWithSession() calls', async () => {
      const order: number[] = []
      let callCount = 0
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          const n = ++callCount
          order.push(n)
          await new Promise((r) => setTimeout(r, 10))
          return makeDoGenerate(`session response ${n}`)
        },
      })
      const engine = makeEngine({ model })
      const session = makeSessionMock()

      const [r1, r2] = await Promise.all([
        engine.askWithSession('first', session),
        engine.askWithSession('second', session),
      ])

      expect(order).toEqual([1, 2])
      expect(r1.text).toBe('session response 1')
      expect(r2.text).toBe('session response 2')
    })

    it('releases lock even when generation throws', async () => {
      let callCount = 0
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          callCount++
          if (callCount === 1) throw new Error('boom')
          return makeDoGenerate('recovered')
        },
      })
      const engine = makeEngine({ model })

      // First call should fail
      await expect(engine.ask('fail')).rejects.toThrow('boom')

      // Second call should succeed (lock released)
      const result = await engine.ask('recover')
      expect(result.text).toBe('recovered')
    })
  })

  // -------------------- isGenerating --------------------

  describe('isGenerating', () => {
    it('is false before any call', () => {
      const engine = makeEngine()
      expect(engine.isGenerating).toBe(false)
    })

    it('is true during generation and false after', async () => {
      let observedDuringGeneration = false
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          // We can't check engine.isGenerating from inside doGenerate
          // because we don't have the engine ref. But we test the state
          // transitions via concurrent observation below.
          return makeDoGenerate('done')
        },
      })
      const engine = makeEngine({ model })

      // Start a generation that takes some time
      const slowModel = new MockLanguageModelV3({
        doGenerate: async () => {
          await new Promise((r) => setTimeout(r, 50))
          return makeDoGenerate('slow')
        },
      })
      const slowEngine = makeEngine({ model: slowModel })

      const promise = slowEngine.ask('test')

      // Give it a tick to enter withLock
      await new Promise((r) => setTimeout(r, 5))
      observedDuringGeneration = slowEngine.isGenerating

      await promise
      expect(observedDuringGeneration).toBe(true)
      expect(slowEngine.isGenerating).toBe(false)
    })

    it('resets to false even on error', async () => {
      const model = new MockLanguageModelV3({
        doGenerate: async () => { throw new Error('fail') },
      })
      const engine = makeEngine({ model })

      await expect(engine.ask('test')).rejects.toThrow()
      expect(engine.isGenerating).toBe(false)
    })
  })
})
