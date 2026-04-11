import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createExplorer, __internal } from '../explorer.js'
import { createSkillCurator } from '../skill-curator.js'
import { explorationConfigSchema } from '../types.js'
import type { ExplorationConfig } from '../types.js'

// ==================== Fakes ====================

interface FakeStreamOpts {
  toolCalls: number
  finalText: string
}

function makeFakeStream({ toolCalls, finalText }: FakeStreamOpts) {
  const result = { text: finalText, media: [] as unknown[] }
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < toolCalls; i++) {
        yield { type: 'tool_use' as const, id: `t${i}`, name: 'fake', input: {} }
      }
      yield { type: 'text' as const, text: finalText }
      yield { type: 'done' as const, result }
    },
    then<T = typeof result>(
      resolve?: ((value: typeof result) => T | PromiseLike<T>) | null,
    ) {
      return Promise.resolve(result).then(resolve)
    },
  }
}

function makeFakeAgentCenter(opts: {
  streamOpts: FakeStreamOpts
  reflectionText: string
}) {
  const askMock = vi.fn(async () => ({
    text: opts.reflectionText,
    media: [],
  }))
  const askWithSessionMock = vi.fn(() => makeFakeStream(opts.streamOpts))
  return {
    ask: askMock,
    askWithSession: askWithSessionMock,
  }
}

function makeFakeBrain() {
  const commits: string[] = []
  return {
    commits,
    updateFrontalLobe: vi.fn((content: string) => {
      commits.push(content)
      return { success: true, message: 'ok' }
    }),
  }
}

function makeFakeEventLog() {
  const events: Array<{ type: string; payload: unknown }> = []
  return {
    events,
    append: vi.fn(async <T>(type: string, payload: T) => {
      events.push({ type, payload })
      return { seq: events.length, ts: Date.now(), type, payload }
    }),
    recent: vi.fn(() => []),
  }
}

function makeFakeConnectorCenter() {
  return { notify: vi.fn(async () => undefined) }
}

// ==================== Helpers ====================

function baseConfig(overrides: Partial<ExplorationConfig> = {}): ExplorationConfig {
  return explorationConfigSchema.parse({
    enabled: true,
    pauseIfUserActiveWithinMin: 0, // disable guard by default in tests
    ...overrides,
  })
}

// ==================== Tests ====================

describe('Explorer', () => {
  let skillsDir: string
  let sessionsDir: string

  beforeEach(async () => {
    skillsDir = await mkdtemp(join(tmpdir(), 'alice-skills-'))
    sessionsDir = await mkdtemp(join(tmpdir(), 'alice-sessions-'))
  })

  afterEach(async () => {
    await rm(skillsDir, { recursive: true, force: true })
    await rm(sessionsDir, { recursive: true, force: true })
  })

  it('runs the full loop and persists a skill when reflection returns JSON', async () => {
    const curator = createSkillCurator({ skillsDir })
    const agentCenter = makeFakeAgentCenter({
      streamOpts: { toolCalls: 5, finalText: 'INSIGHT: VIX 低檔反轉的 signal' },
      reflectionText: JSON.stringify({
        triggers: ['vix', '反轉'],
        confidence: 0.8,
        summary: 'VIX 低檔反轉',
        body: '# VIX 低檔反轉\n\n## When to load\n當 VIX < 15 且 fear_greed > 80\n\n## Procedure\n1. 查 VIX 日線\n2. 查 fear & greed\n',
      }),
    })
    const brain = makeFakeBrain()
    const eventLog = makeFakeEventLog()
    const connectorCenter = makeFakeConnectorCenter()
    const config = baseConfig()

    const explorer = createExplorer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentCenter: agentCenter as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventLog: eventLog as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connectorCenter: connectorCenter as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      brain: brain as any,
      skillCurator: curator,
      config,
      sessionsDir,
    })

    const result = await explorer.run({ source: 'manual', topic: 'test topic' })

    expect(result.ok).toBe(true)
    expect(result.toolCalls).toBe(5)
    expect(result.createdSkillId).toBeTruthy()
    expect(result.summary).toContain('INSIGHT')

    const skills = await curator.list()
    expect(skills).toHaveLength(1)
    expect(skills[0].frontmatter.triggers).toEqual(['vix', '反轉'])

    // Brain commit recorded
    expect(brain.updateFrontalLobe).toHaveBeenCalledOnce()
    expect(brain.commits[0]).toContain('Exploration')
    expect(brain.commits[0]).toContain('New skill:')

    // Event log saw the expected sequence
    const types = eventLog.events.map((e) => e.type)
    expect(types).toContain('exploration.started')
    expect(types).toContain('exploration.recall.completed')
    expect(types).toContain('exploration.explore.completed')
    expect(types).toContain('exploration.skill.created')
    expect(types).toContain('exploration.completed')
  })

  it('skips skill creation when reflection returns SKIP', async () => {
    const curator = createSkillCurator({ skillsDir })
    const agentCenter = makeFakeAgentCenter({
      streamOpts: { toolCalls: 3, finalText: 'no new insight' },
      reflectionText: 'SKIP',
    })
    const config = baseConfig()

    const explorer = createExplorer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentCenter: agentCenter as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventLog: makeFakeEventLog() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connectorCenter: makeFakeConnectorCenter() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      brain: makeFakeBrain() as any,
      skillCurator: curator,
      config,
      sessionsDir,
    })

    const result = await explorer.run({ source: 'manual', topic: 'x' })
    expect(result.createdSkillId).toBeNull()
    expect(await curator.list()).toHaveLength(0)
  })

  it('skips reflection entirely when tool call count is below threshold', async () => {
    const curator = createSkillCurator({ skillsDir })
    const agentCenter = makeFakeAgentCenter({
      streamOpts: { toolCalls: 1, finalText: 'too shallow' },
      reflectionText: 'should not be called',
    })
    const config = baseConfig({
      reflection: { minToolCalls: 5, maxSkills: 100 },
    })

    const explorer = createExplorer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentCenter: agentCenter as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventLog: makeFakeEventLog() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connectorCenter: makeFakeConnectorCenter() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      brain: makeFakeBrain() as any,
      skillCurator: curator,
      config,
      sessionsDir,
    })

    await explorer.run({ source: 'manual' })
    expect(agentCenter.ask).not.toHaveBeenCalled()
    expect(await curator.list()).toHaveLength(0)
  })

  it('pauses when a user session was modified recently', async () => {
    // Write a recent jsonl file in the sessions dir (outside exploration namespace)
    await mkdir(join(sessionsDir, 'chat'), { recursive: true })
    await writeFile(join(sessionsDir, 'chat', 'live.jsonl'), '{}\n')

    const curator = createSkillCurator({ skillsDir })
    const agentCenter = makeFakeAgentCenter({
      streamOpts: { toolCalls: 0, finalText: '' },
      reflectionText: '',
    })
    const config = baseConfig({ pauseIfUserActiveWithinMin: 60 })

    const explorer = createExplorer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentCenter: agentCenter as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventLog: makeFakeEventLog() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connectorCenter: makeFakeConnectorCenter() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      brain: makeFakeBrain() as any,
      skillCurator: curator,
      config,
      sessionsDir,
    })

    const result = await explorer.run({ source: 'cron' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('paused_user_active')
    expect(agentCenter.askWithSession).not.toHaveBeenCalled()
  })
})

describe('parseReflection', () => {
  it('accepts plain JSON', () => {
    const r = __internal.parseReflection(
      JSON.stringify({
        triggers: ['a'],
        confidence: 0.5,
        body: '# x',
      }),
    )
    expect(r.skip).toBe(false)
    expect(r.triggers).toEqual(['a'])
    expect(r.body).toBe('# x')
  })

  it('strips markdown code fences', () => {
    const r = __internal.parseReflection(
      '```json\n{"triggers": ["a"], "confidence": 0.5, "body": "# x"}\n```',
    )
    expect(r.skip).toBe(false)
    expect(r.triggers).toEqual(['a'])
  })

  it('returns skip on SKIP literal', () => {
    expect(__internal.parseReflection('SKIP').skip).toBe(true)
    expect(__internal.parseReflection('SKIP — not enough').skip).toBe(true)
  })

  it('returns skip on malformed JSON', () => {
    expect(__internal.parseReflection('not json').skip).toBe(true)
    expect(__internal.parseReflection('{"triggers": [], "body": ""}').skip).toBe(true)
  })
})
