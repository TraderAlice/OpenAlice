import { describe, expect, it } from 'vitest'
import { piContent, presentPiTranscript } from './webpi-presentation'

describe('Pi presentation boundary', () => {
  it('normalizes wire content without losing unrecognized events', () => {
    expect(piContent([{ type: 'text', text: 'Hello' }, { type: 'thinking', thinking: 'Reason' }, { type: 'future', value: 42 }])).toEqual([
      { kind: 'markdown', text: 'Hello' },
      { kind: 'disclosure', label: 'Thinking', content: [{ kind: 'markdown', text: 'Reason' }] },
      { kind: 'data', text: JSON.stringify({ type: 'future', value: 42 }, null, 2) },
    ])
  })
  it('normalizes correlated tool results rather than passing Pi parts into the UI', () => {
    const items = presentPiTranscript([
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } }] },
      { role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: 'Not found' }], isError: true },
    ])
    expect(items[0]).toMatchObject({ kind: 'assistant-turn', activity: { steps: [{
      status: 'failed', result: [{ kind: 'markdown', text: 'Not found' }], input: JSON.stringify({ path: 'README.md' }, null, 2),
    }] } })
  })
})
