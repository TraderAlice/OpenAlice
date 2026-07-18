import { describe, expect, it } from 'vitest'

import { HeadlessTerminalSnapshot } from './headless-terminal-snapshot.js'

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
})
