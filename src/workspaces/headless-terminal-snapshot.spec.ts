import { describe, expect, it } from 'vitest'

import { HeadlessTerminalSnapshot } from './headless-terminal-snapshot.js'
import type { TerminalViewAttributes } from './terminal-view-attributes.js'

function viewAttributes(
  overrides: Partial<TerminalViewAttributes> = {},
): TerminalViewAttributes {
  const ansi = Array.from({ length: 256 }, (_, index) => [index, index, index] as [number, number, number])
  return {
    foreground: [0xde, 0xad, 0xbe],
    background: [0x0b, 0x0c, 0x0e],
    cursor: [0x23, 0xb9, 0x9a],
    ansi,
    colorSchemeMode: 'dark',
    cursorStyle: 'block',
    cursorBlink: true,
    ...overrides,
  }
}

describe('HeadlessTerminalSnapshot', () => {
  it('serializes the authoritative screen instead of historical redraw bytes', () => {
    const terminal = new HeadlessTerminalSnapshot({ cols: 80, rows: 24 })
    try {
      terminal.write(Buffer.from('stale frame\x1b[2J\x1b[Hcurrent frame'))

      const snapshot = terminal.snapshot()

      expect(snapshot).toContain('current frame')
      expect(snapshot).not.toContain('stale frame')
    } finally {
      terminal.dispose()
    }
  })

  it('forwards query replies only for writes that explicitly own reply authority', () => {
    const replies: string[] = []
    const terminal = new HeadlessTerminalSnapshot({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => replies.push(reply),
    })
    try {
      terminal.write('\x1b[6n')
      expect(replies).toEqual([])

      terminal.write('\x1b[6n', { forwardQueryReplies: true })
      expect(replies).toEqual(['\x1b[1;1R'])
    } finally {
      terminal.dispose()
    }
  })

  it('serializes after resizing to the renderer dimensions', () => {
    const terminal = new HeadlessTerminalSnapshot({ cols: 80, rows: 24 })
    try {
      terminal.resize(5, 4)
      terminal.write('12345\r\n67890')

      expect(terminal.snapshot()).toContain('12345\r\n67890')
    } finally {
      terminal.dispose()
    }
  })

  it('carries Kitty keyboard flags beside snapshots because SerializeAddon omits them', () => {
    const terminal = new HeadlessTerminalSnapshot({ cols: 80, rows: 24 })
    try {
      terminal.write('\x1b[>3u')
      expect(terminal.getKittyKeyboardFlags()).toBe(3)
      terminal.write('\x1b[<u')
      expect(terminal.getKittyKeyboardFlags()).toBe(0)
    } finally {
      terminal.dispose()
    }
  })

  it('answers hidden OSC color queries from renderer truth and stays silent before the push', () => {
    const replies: string[] = []
    const terminal = new HeadlessTerminalSnapshot({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => replies.push(reply),
    })
    try {
      terminal.write('\x1b]11;?\x1b\\', { forwardQueryReplies: true })
      expect(replies).toEqual([])

      terminal.setTerminalViewAttributes(viewAttributes())
      terminal.write('\x1b]10;?\x1b\\\x1b]11;?\x1b\\\x1b]12;?\x1b\\', {
        forwardQueryReplies: true,
      })
      expect(replies).toEqual([
        '\x1b]10;rgb:dede/adad/bebe\x1b\\',
        '\x1b]11;rgb:0b0b/0c0c/0e0e\x1b\\',
        '\x1b]12;rgb:2323/b9b9/9a9a\x1b\\',
      ])
      terminal.write('\x1b[?996n', { forwardQueryReplies: true })
      expect(replies.at(-1)).toBe('\x1b[?997;1n')
    } finally {
      terminal.dispose()
    }
  })

  it('tracks per-PTY OSC palette mutations and clears them on renderer theme apply', () => {
    const replies: string[] = []
    const terminal = new HeadlessTerminalSnapshot({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => replies.push(reply),
    })
    try {
      terminal.setTerminalViewAttributes(viewAttributes())
      terminal.write('\x1b]4;1;#123456\x1b\\')
      terminal.write('\x1b]4;1;?\x1b\\', { forwardQueryReplies: true })
      expect(replies.at(-1)).toBe('\x1b]4;1;rgb:1212/3434/5656\x1b\\')

      terminal.setTerminalViewAttributes(viewAttributes({ ansi: viewAttributes().ansi.map((color, index) =>
        index === 1 ? [0xaa, 0xbb, 0xcc] : color) }))
      terminal.write('\x1b]4;1;?\x1b\\', { forwardQueryReplies: true })
      expect(replies.at(-1)).toBe('\x1b]4;1;rgb:aaaa/bbbb/cccc\x1b\\')
    } finally {
      terminal.dispose()
    }
  })

  it('tracks Contour/Kitty DEC mode 2031 subscriptions beside the snapshot', () => {
    const replies: string[] = []
    const terminal = new HeadlessTerminalSnapshot({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => replies.push(reply),
    })
    try {
      expect(terminal.getColorSchemeUpdatesSubscribed()).toBe(false)
      terminal.write('\x1b[?25;2031h', { forwardQueryReplies: true })
      expect(terminal.getColorSchemeUpdatesSubscribed()).toBe(true)
      expect(replies).toEqual([])
      terminal.write('\x1b[?2031l')
      expect(terminal.getColorSchemeUpdatesSubscribed()).toBe(false)
    } finally {
      terminal.dispose()
    }
  })
})
