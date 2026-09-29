import { describe, expect, it } from 'vitest'
import { WebSessionState } from './transport.js'
import { WEB_HISTORY_WINDOW_MESSAGES } from './projection-window.js'

describe('WebSessionState projection window', () => {
  it('spills older messages out of the live snapshot and reveals them on demand', () => {
    const state = new WebSessionState()
    for (let i = 0; i < WEB_HISTORY_WINDOW_MESSAGES + 40; i += 1) {
      state.append({ role: 'user', content: `u${i}` })
    }
    expect(state.messages.length).toBeLessThanOrEqual(Math.ceil(WEB_HISTORY_WINDOW_MESSAGES * 1.5))
    expect(state.hiddenMessages.length).toBeGreaterThan(0)
    const beforeHidden = state.hiddenMessages.length
    const beforeVisible = state.messages.length
    const moved = state.revealEarlier(30)
    expect(moved).toBeGreaterThan(0)
    expect(state.hiddenMessages.length).toBe(beforeHidden - moved)
    expect(state.messages.length).toBe(beforeVisible + moved)
  })

  it('clears the hidden prefix when the runtime replaces the full message list', () => {
    const state = new WebSessionState()
    for (let i = 0; i < WEB_HISTORY_WINDOW_MESSAGES + 10; i += 1) {
      state.append({ role: 'assistant', content: [{ type: 'text', text: `a${i}` }] })
    }
    expect(state.hiddenMessages.length).toBeGreaterThan(0)
    state.replaceMessages([
      { role: 'user', content: 'fresh' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ])
    expect(state.hiddenMessages).toEqual([])
    expect(state.messages).toHaveLength(2)
  })
})
