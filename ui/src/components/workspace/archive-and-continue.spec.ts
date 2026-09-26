// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  applySuggestionToDraft,
  buildAliceSuggestions,
  buildCheckpointWritePrompt,
  buildContinuePrompt,
  checkpointRelativePath,
  isWebSessionBusy,
  isWebSessionReady,
  runArchiveAndContinue,
  shouldOfferContextContinue,
} from './archive-and-continue'
import type { ConversationItem } from '../conversation/types'

describe('archive-and-continue helpers', () => {
  it('builds a dated checkpoint path under reports/checkpoints', () => {
    expect(checkpointRelativePath(new Date('2026-09-24T12:00:00.000Z'), 'abc123'))
      .toBe('reports/checkpoints/checkpoint-2026-09-24-abc123.md')
  })

  it('asks the current agent to write the consensus checkpoint and the next session to continue from it', () => {
    const write = buildCheckpointWritePrompt('reports/checkpoints/a.md', 'Gold lead study', '## 已有结论\n\n- keep ATR')
    expect(write).toContain('reports/checkpoints/a.md')
    expect(write).toContain('Gold lead study')
    expect(write).toContain('then stop')
    expect(write).toContain('keep ATR')

    const cont = buildContinuePrompt('reports/checkpoints/a.md', 'Gold lead study', '## 下一步\n\n- rerun')
    expect(cont).toContain('[[reports/checkpoints/a.md]]')
    expect(cont).toContain('Gold lead study')
    expect(cont).toContain('source of truth')
    expect(cont).toContain('rerun')
  })

  it('treats starting/working as not ready for a new checkpoint prompt', () => {
    expect(isWebSessionReady({ phase: 'idle' })).toBe(true)
    expect(isWebSessionReady({ phase: 'starting' })).toBe(false)
    expect(isWebSessionBusy({ phase: 'working' })).toBe(true)
    expect(isWebSessionBusy({ phase: 'idle' })).toBe(false)
  })
})

describe('context-continue offer rules', () => {
  const items = (n: number): ConversationItem[] => Array.from({ length: n }, (_, index) => ({
    kind: 'user' as const,
    key: `u${index}`,
    content: [{ kind: 'markdown' as const, text: `turn ${index}` }],
  }))

  it('offers only for AutoQuant idle threads past the soft threshold', () => {
    const storage = { getItem: () => null }
    expect(shouldOfferContextContinue({
      source: 'chat', phase: 'idle', items: items(20), sessionId: 's1', storage,
    })).toBe(false)
    expect(shouldOfferContextContinue({
      source: 'auto-quant', phase: 'working', items: items(20), sessionId: 's1', storage,
    })).toBe(false)
    expect(shouldOfferContextContinue({
      source: 'auto-quant', phase: 'idle', items: items(11), sessionId: 's1', storage,
    })).toBe(false)
    expect(shouldOfferContextContinue({
      source: 'auto-quant', phase: 'idle', items: items(12), sessionId: 's1', storage,
    })).toBe(true)
  })

  it('builds soft Alice cards and appends accepted text under the matching heading', () => {
    const cards = buildAliceSuggestions([
      { kind: 'user', key: 'u', content: [{ kind: 'markdown', text: '看 600531.SH' }] },
      {
        kind: 'assistant-turn', key: 'a', progress: [], final: '回测完成？', activity: {
          thinking: [], unknownParts: [], steps: Array.from({ length: 8 }, (_, id) => ({
            id: `t${id}`, name: 'run', summary: 'ok', input: '{}', thinking: [], status: 'succeeded' as const,
          })),
        },
      },
    ])
    expect(cards.some((card) => card.id === 'symbols')).toBe(true)
    expect(cards.some((card) => card.id === 'tool-outcomes')).toBe(true)
    const next = applySuggestionToDraft('## 已有结论\n\n\n## 下一步\n\n', cards.find((card) => card.id === 'tool-outcomes')!)
    expect(next).toContain('## 已有结论')
    expect(next).toContain('工具调用')
  })
})

describe('runArchiveAndContinue', () => {
  const row = {
    workspaceId: 'ws-1',
    resumeId: 'resume-1',
    title: 'Gold lead study',
    session: { id: 'sid-1', state: 'running' as const, surface: 'webpi' as const, agent: 'cursor' },
  }

  it('prompts the live Web Session, waits for the file, archives, then opens landing', async () => {
    const openLanding = vi.fn()
    const promptWebSession = vi.fn(async () => ({ phase: 'working', revision: 2 } as never))
    const getWebSession = vi.fn(async () => ({ phase: 'idle', revision: 1 } as never))
    let reads = 0
    const readWorkspaceFile = vi.fn(async () => {
      reads += 1
      return reads >= 2
        ? { kind: 'ok' as const, content: '# checkpoint' }
        : { kind: 'file_missing' as const }
    })
    const pauseSession = vi.fn(async () => undefined)
    const setSessionPresence = vi.fn(async () => undefined)

    const result = await runArchiveAndContinue(row, {
      supportsWeb: true,
      openWebSession: vi.fn(async () => undefined),
      promptWebSession,
      getWebSession,
      readWorkspaceFile,
      pauseSession,
      setSessionPresence,
      openLanding,
      now: new Date('2026-09-24T12:00:00.000Z'),
      entropy: 'abc123',
      settleTimeoutMs: 5_000,
      pollMs: 1,
      sleep: async () => undefined,
      consensus: '## 已有结论\n\n- keep ATR',
    })

    expect(result).toEqual({
      checkpointPath: 'reports/checkpoints/checkpoint-2026-09-24-abc123.md',
      wroteCheckpoint: true,
    })
    expect(promptWebSession).toHaveBeenCalledWith(
      'ws-1',
      'sid-1',
      expect.stringContaining('keep ATR'),
    )
    expect(pauseSession).toHaveBeenCalledWith('ws-1', 'sid-1')
    expect(setSessionPresence).toHaveBeenCalledWith('ws-1', 'resume-1', 'archived')
    expect(openLanding).toHaveBeenCalledWith(expect.stringContaining('[[reports/checkpoints/checkpoint-2026-09-24-abc123.md]]'))
  })

  it('still archives and opens landing when Web is unavailable', async () => {
    const openLanding = vi.fn()
    const setSessionPresence = vi.fn(async () => undefined)
    const result = await runArchiveAndContinue({
      ...row,
      session: { ...row.session, state: 'paused', surface: 'terminal' },
    }, {
      supportsWeb: false,
      openWebSession: vi.fn(async () => undefined),
      promptWebSession: vi.fn(async () => ({ phase: 'idle', revision: 1 } as never)),
      getWebSession: vi.fn(async () => null),
      readWorkspaceFile: vi.fn(async () => ({ kind: 'file_missing' as const })),
      pauseSession: vi.fn(async () => undefined),
      setSessionPresence,
      openLanding,
      now: new Date('2026-09-24T12:00:00.000Z'),
      entropy: 'zz9',
      consensus: '## 下一步\n\n- continue',
    })
    expect(result.wroteCheckpoint).toBe(false)
    expect(setSessionPresence).toHaveBeenCalledWith('ws-1', 'resume-1', 'archived')
    expect(openLanding).toHaveBeenCalledOnce()
  })
})
