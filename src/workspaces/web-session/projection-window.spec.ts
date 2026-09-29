import { describe, expect, it } from 'vitest'
import type { WebConversationMessage } from './model.js'
import {
  splitProjectionWindow,
  takeEarlierChunk,
  WEB_HISTORY_WINDOW_MESSAGES,
} from './projection-window.js'

function user(text: string): WebConversationMessage {
  return { role: 'user', content: text }
}

function assistant(text: string): WebConversationMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function tool(id: string): WebConversationMessage {
  return {
    role: 'toolResult',
    toolCallId: id,
    toolName: 'read',
    content: `body-${id}`,
    isError: false,
  }
}

describe('splitProjectionWindow', () => {
  it('keeps short transcripts intact', () => {
    const messages = [user('a'), assistant('b')]
    expect(splitProjectionWindow(messages, 10)).toEqual({
      hidden: [],
      visible: messages,
    })
  })

  it('cuts on a user turn when possible', () => {
    const messages = [
      user('1'),
      assistant('1a'),
      tool('t1'),
      user('2'),
      assistant('2a'),
      user('3'),
      assistant('3a'),
    ]
    const { hidden, visible } = splitProjectionWindow(messages, 3)
    expect(visible[0]?.role).toBe('user')
    expect(hidden.length + visible.length).toBe(messages.length)
    expect(visible.length).toBeLessThanOrEqual(Math.ceil(3 * 1.5))
  })

  it('hard-cuts when no nearby user boundary fits the budget', () => {
    const messages = Array.from({ length: WEB_HISTORY_WINDOW_MESSAGES + 40 }, (_, i) =>
      assistant(`m${i}`),
    )
    const { hidden, visible } = splitProjectionWindow(messages, 20)
    expect(visible).toHaveLength(20)
    expect(hidden).toHaveLength(messages.length - 20)
  })
})

describe('takeEarlierChunk', () => {
  it('returns empty when nothing is hidden', () => {
    expect(takeEarlierChunk([], 10)).toEqual({ remaining: [], chunk: [] })
  })

  it('peels from the end of the hidden prefix onto a user boundary', () => {
    const hidden = [user('1'), assistant('1a'), tool('t1'), user('2'), assistant('2a')]
    const { remaining, chunk } = takeEarlierChunk(hidden, 2)
    expect(chunk[0]).toEqual(user('2'))
    expect(remaining).toEqual([user('1'), assistant('1a'), tool('t1')])
  })
})
