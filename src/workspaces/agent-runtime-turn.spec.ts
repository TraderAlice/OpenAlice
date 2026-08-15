import { describe, expect, it, vi } from 'vitest'

import {
  createHeadlessTurnJournal,
  diffHeadlessTurnEvents,
  headlessCompletionAssets,
} from './agent-runtime-turn.js'

const subject = {
  workspaceId: 'desk-a',
  resumeId: 'resume-alice',
  agent: 'codex',
  taskId: 'run-1',
  surface: 'headless' as const,
}

describe('diffHeadlessTurnEvents', () => {
  it('emits new text, tool, and error blocks once', () => {
    const first = diffHeadlessTurnEvents(subject, [], [
      { type: 'text', text: 'Looking up the desk.' },
      { type: 'tool', id: 't1', name: 'workspace_list', status: 'running' },
    ])
    expect(first.map((event) => event.type)).toEqual([
      'runtime.turn.text',
      'runtime.turn.tool',
    ])

    const second = diffHeadlessTurnEvents(subject, [
      { type: 'text', text: 'Looking up the desk.' },
      { type: 'tool', id: 't1', name: 'workspace_list', status: 'running' },
    ], [
      { type: 'text', text: 'Looking up the desk.' },
      { type: 'tool', id: 't1', name: 'workspace_list', status: 'completed' },
      { type: 'error', message: 'later warning' },
    ])
    expect(second).toEqual([
      {
        type: 'runtime.turn.tool',
        payload: {
          ...subject,
          toolId: 't1',
          toolName: 'workspace_list',
          toolStatus: 'completed',
        },
      },
      {
        type: 'runtime.turn.error',
        payload: { ...subject, message: 'later warning' },
      },
    ])
  })
})

describe('createHeadlessTurnJournal', () => {
  it('serializes turn events and falls back to assistant text without blocks', async () => {
    const record = vi.fn(async (_type: string, _payload: unknown) => undefined)
    const journal = createHeadlessTurnJournal({ subject, record })
    journal.offer({
      schemaVersion: 1,
      assistantText: 'Working.',
      blocks: [],
      metrics: { textBlocks: 0, toolCalls: 0, toolFailures: 0 },
      truncated: false,
    })
    journal.offer({
      schemaVersion: 1,
      assistantText: 'Done.',
      blocks: [{ type: 'text', text: 'Done.' }],
      metrics: { textBlocks: 1, toolCalls: 0, toolFailures: 0 },
      truncated: false,
    })
    await journal.flush()
    expect(record.mock.calls.map((call) => call[0])).toEqual([
      'runtime.turn.text',
      'runtime.turn.text',
    ])
    expect(record.mock.calls[0]?.[1]).toMatchObject({ text: 'Working.' })
    expect(record.mock.calls[1]?.[1]).toMatchObject({ text: 'Done.' })
  })
})

describe('headlessCompletionAssets', () => {
  it('clips completion text through the progress projection', () => {
    const assets = headlessCompletionAssets({
      schemaVersion: 1,
      assistantText: 'Final reply.',
      blocks: [{ type: 'text', text: 'Final reply.' }],
      metrics: { textBlocks: 1, toolCalls: 2, toolFailures: 0 },
      truncated: true,
    })
    expect(assets).toEqual({
      assistantText: 'Final reply.',
      metrics: { textBlocks: 1, toolCalls: 2, toolFailures: 0 },
      truncated: true,
    })
  })
})
