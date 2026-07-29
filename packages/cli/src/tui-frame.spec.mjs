import { describe, expect, it } from 'vitest'

import {
  createSupervisorFrame,
  fitTerminalLine,
  sanitizeTerminalText,
  terminalStringWidth,
} from './tui-frame.mjs'
import { AnsiTerminalRenderer } from './tui-renderer.mjs'
import { createTerminalSession, shouldUseColor } from './tui-session.mjs'

const model = {
  productVersion: '0.87.0-beta',
  state: 'running',
  instance: 'default',
  endpoint: 'http://127.0.0.1:3000',
  home: '/Users/爱丽丝/.openalice',
  uptime: '2h',
  provider: 'source',
  components: [['Alice', 'ready']],
  detail: 'connected',
}

describe('Supervisor TUI frame', () => {
  it('accounts for grapheme and East Asian display widths', () => {
    expect(terminalStringWidth('Alice')).toBe(5)
    expect(terminalStringWidth('爱丽丝')).toBe(6)
    expect(terminalStringWidth('e\u0301')).toBe(1)
    expect(terminalStringWidth('👩‍💻')).toBe(2)
    expect(terminalStringWidth(fitTerminalLine('爱丽丝 workspace', 10))).toBe(10)
  })

  it('removes terminal control sequences and never emits an over-wide row', () => {
    expect(sanitizeTerminalText('safe\x1b]52;c;secret\x07\nnext')).toBe('safe next')
    const frame = createSupervisorFrame({
      ...model,
      detail: 'bad\x1b[2J\r\nstill visible',
    }, { columns: 48, rows: 16, color: false })

    expect(frame).toHaveLength(16)
    expect(frame.join('\n')).not.toContain('\x1b')
    expect(frame.every((line) => terminalStringWidth(line) === 48)).toBe(true)
  })

  it('uses a narrow projection below 60 columns and color only when requested', () => {
    const plain = createSupervisorFrame(model, { columns: 48, rows: 16, color: false })
    const colored = createSupervisorFrame(model, { columns: 80, rows: 24, color: true })
    const tiny = createSupervisorFrame(model, { columns: 10, rows: 3, color: false })

    expect(plain.join('\n')).toContain('Alice: ready')
    expect(plain.join('\n')).not.toContain('\x1b[')
    expect(colored.join('\n')).toContain('\x1b[')
    expect(tiny).toHaveLength(3)
    expect(tiny.every((line) => terminalStringWidth(line) === 10)).toBe(true)
  })
})

describe('ANSI terminal renderer', () => {
  it('updates only changed rows after the initial frame and restores once', () => {
    const writes = []
    const renderer = new AnsiTerminalRenderer({ write: (value) => writes.push(value) })
    renderer.enter()
    renderer.render(['one', 'two'])
    const firstUpdateCount = writes.length
    renderer.render(['one', 'two'])
    expect(writes).toHaveLength(firstUpdateCount)
    renderer.render(['one', 'changed'])
    renderer.close()
    renderer.close()

    expect(writes).toHaveLength(firstUpdateCount + 2)
    expect(writes.at(-2)).toBe('\x1b[2;1Hchanged\x1b[K')
    expect(writes.at(-1)).toBe('\x1b[0m\x1b[?25h\x1b[?1049l')
  })
})

describe('terminal session preflight', () => {
  it('refuses redirected input or output before changing terminal state', () => {
    expect(() => createTerminalSession({
      input: { isTTY: false },
      output: { isTTY: true },
      render: () => [],
    })).toThrow('requires an interactive terminal')
  })

  it('honors NO_COLOR and dumb terminals', () => {
    const output = { isTTY: true }
    expect(shouldUseColor(output, { TERM: 'xterm-256color' })).toBe(true)
    expect(shouldUseColor(output, { TERM: 'xterm-256color', NO_COLOR: '' })).toBe(false)
    expect(shouldUseColor(output, { TERM: 'dumb' })).toBe(false)
    expect(shouldUseColor({ isTTY: false }, { TERM: 'xterm-256color' })).toBe(false)
  })
})
