import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorTransferFlightDeck,
  renderSupervisorTransferFlightDeck,
} from './supervisor-transfer-view.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor Transfer Flight Deck', () => {
  it('pairs the full flight path with a wide Mission Brief', () => {
    const rendered = renderSupervisorTransferFlightDeck({
      phase: 'credentials',
      sourceName: 'Default AliceProject',
      destinationName: 'Railway Beta',
      content: ['Credentials', '', '› Transfer and re-seal', '  Leave credentials behind'],
      message: 'Choose how private values cross the SSH boundary.',
    }, 100)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Flight Deck · 4/8 · SECRETS')
    expect(output).toContain('Mission Brief · Default AliceProject → Railway Beta')
    expect(output).toContain('✓ 03 Remote Home')
    expect(output).toContain('◆ 04 Credentials')
    expect(output).toContain('· 05 Issue Owners')
    expect(output).toContain('Safety Rail · Credentials')
    expect(output).not.toContain('…')
    expect(rendered.contentFirstRow).toBe(2)
    expect(rendered.contentStartColumn).toBe(40)
    expect(rendered.contentEndColumn).toBe(99)
    expect(rendered.lines.every((line) => displayWidth(line) <= 100)).toBe(true)
  })

  it('compresses completed, current, and next stages above a narrow Brief', () => {
    const rendered = renderSupervisorTransferFlightDeck({
      phase: 'home',
      sourceName: 'Default AliceProject',
      destinationName: 'Cloud',
      content: ['Destination complete Home', '', '/srv/alice'],
      message: 'Must be a new absolute POSIX path.',
    }, 50)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Transfer Flight Deck · 3/8 · LOCATION')
    expect(output).toContain('✓ Project ID  ◆ Remote Home  → Credentials')
    expect(output).toContain('Mission Brief · Default AliceProject → Cloud')
    expect(output).toContain('◆ SAFETY · Remote Home')
    expect(rendered.lines).toHaveLength(11)
    expect(rendered.contentFirstRow).toBe(6)
    expect(rendered.contentStartColumn).toBe(2)
    expect(rendered.contentEndColumn).toBe(49)
    expect(rendered.lines.every((line) => displayWidth(line) <= 50)).toBe(true)
  })

  it('keeps the current route leg visible without color', () => {
    const lines = renderSupervisorTransferFlightDeck({
      phase: 'transferring',
      sourceName: 'Local',
      destinationName: 'Cloud',
      content: ['Transferring…'],
      message: 'Streaming over SSH.',
    }, 100).lines
    const color = decorateSupervisorTransferFlightDeck(
      lines,
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
    )
    const plain = decorateSupervisorTransferFlightDeck(
      lines,
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
    )
    expect(color.join('\n')).toContain('\u001b[')
    expect(plain.join('\n')).toContain('◆ 07 Transfer')
  })
})
