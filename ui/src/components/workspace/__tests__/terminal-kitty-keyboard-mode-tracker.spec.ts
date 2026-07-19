import { describe, expect, it } from 'vitest'
import { TerminalKittyKeyboardModeTracker } from '../terminal-kitty-keyboard-mode-tracker'

describe('TerminalKittyKeyboardModeTracker', () => {
  it('tracks split push, set, and pop sequences', () => {
    const tracker = new TerminalKittyKeyboardModeTracker()
    tracker.scan('\x1b[>')
    tracker.scan('3u')
    expect(tracker.flags).toBe(3)
    tracker.scan('\x1b[=1;3u')
    expect(tracker.flags).toBe(2)
    tracker.scan('\x1b[<u')
    expect(tracker.flags).toBe(0)
  })

  it('keeps independent flags across the alternate screen', () => {
    const tracker = new TerminalKittyKeyboardModeTracker()
    tracker.scan('\x1b[=1u\x1b[?1049h\x1b[=3u')
    expect(tracker.flags).toBe(3)
    tracker.scan('\x1b[?1049l')
    expect(tracker.flags).toBe(1)
  })
})
