import { describe, expect, it } from 'vitest'
import {
  activityToolLabel,
  groupWebPiTranscript,
  summarizeToolInput,
} from './webpi-transcript'

describe('groupWebPiTranscript', () => {
  it('turns Pi assistant/tool hops into one auditable activity group', () => {
    const transcript = groupWebPiTranscript([
      { role: 'user', content: [{ type: 'text', text: 'Send the report.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Create the report first.' },
          { type: 'text', text: 'I will write and send it.' },
          { type: 'toolCall', id: 'call-write', name: 'write', arguments: { path: 'research/report.md', content: '# Report' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call-write', toolName: 'write', content: [{ type: 'text', text: 'Wrote 8 bytes' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Push the Inbox entry.' },
          { type: 'toolCall', id: 'call-bash', name: 'bash', arguments: { command: 'alice-workspace inbox push --doc research/report.md' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call-bash', toolName: 'bash', content: [{ type: 'text', text: 'ok' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'Summarize.' }, { type: 'text', text: 'Done.' }] },
    ])

    expect(transcript).toHaveLength(2)
    expect(transcript[1]).toMatchObject({
      kind: 'assistant-turn',
      key: 'assistant-1',
      progress: ['I will write and send it.'],
      final: 'Done.',
      activity: {
        steps: [
          { id: 'call-write', name: 'write', status: 'succeeded', thinking: ['Create the report first.'] },
          { id: 'call-bash', name: 'bash', status: 'succeeded', thinking: ['Push the Inbox entry.'] },
        ],
        thinking: ['Summarize.'],
      },
    })
  })

  it('keeps failures openable and preserves unmatched native tool results', () => {
    const transcript = groupWebPiTranscript([
      { role: 'assistant', content: [{ type: 'toolCall', id: 'pending', name: 'bash', arguments: {} }] },
      { role: 'toolResult', toolCallId: 'orphan', toolName: 'read', isError: true, content: [{ type: 'text', text: 'missing' }] },
    ])
    expect(transcript[0]).toMatchObject({
      kind: 'assistant-turn',
      activity: {
        steps: [
          { id: 'pending', status: 'running' },
          { id: 'orphan', name: 'read', status: 'failed' },
        ],
      },
    })
  })
})

describe('WebPi activity summaries', () => {
  it('summarizes safe, useful arguments without exposing write contents', () => {
    expect(summarizeToolInput('write', { path: 'research/report.md', content: 'secret body' }))
      .toBe('research/report.md')
    expect(summarizeToolInput('write', { content: 'secret body' })).toBeNull()
    expect(summarizeToolInput('bash', { command: 'git status --short\nsecond line' }))
      .toBe('git status --short second line')
  })

  it('counts repeated tools in first-seen order', () => {
    expect(activityToolLabel([
      { id: '1', name: 'write', input: {}, thinking: [], status: 'succeeded' },
      { id: '2', name: 'bash', input: {}, thinking: [], status: 'succeeded' },
      { id: '3', name: 'bash', input: {}, thinking: [], status: 'succeeded' },
    ])).toBe('write · bash ×2')
  })
})
