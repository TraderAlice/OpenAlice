import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorTransferFlightDeck,
  renderSupervisorTransferArrival,
  renderSupervisorTransferFlightDeck,
  renderSupervisorTransferChoice,
  renderSupervisorTransferInput,
  renderSupervisorTransferPlanning,
  renderSupervisorTransferProgress,
  renderSupervisorTransferRecovery,
  renderSupervisorTransferReview,
} from './supervisor-transfer-view.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor Transfer Flight Deck', () => {
  it('pairs the full flight path with a wide Mission Brief', () => {
    const rendered = renderSupervisorTransferFlightDeck({
      phase: 'credentials',
      sourceName: 'Default AliceProject',
      destinationName: 'Cloud Dev',
      content: ['Credentials', '', '› Transfer and re-seal', '  Leave credentials behind'],
      message: 'Choose how private values cross the SSH boundary.',
    }, 100)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Flight Deck · 4/8 · SECRETS')
    expect(output).toContain('Mission Brief · Default AliceProject → Cloud Dev')
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

  it('turns the tiny Transfer overlay into one borderless emergency step', () => {
    const rendered = renderSupervisorTransferFlightDeck({
      phase: 'destination',
      sourceName: 'Source Project',
      content: [
        '◆ Transfer Source · destination Machine',
        '',
        '› Cloud fixture · alice@example.test',
        '',
        '◆ [ Enter ] Choose  │  [ Esc ] Back',
      ],
      message: 'Choose the SSH Machine that will own the new AliceProject.',
    }, 44)
    const output = rendered.lines.join('\n')

    expect(output).toContain('◆ TRANSFER · 1/8 · DESTINATION')
    expect(output).toContain('PATH  ◆ Machine  → Project ID')
    expect(output).toContain('ROUTE Source Project → Choose Machine')
    expect(output).toContain('› Cloud fixture · alice@example.test')
    expect(output).not.toContain('◆ [ Enter ] Choose  │  [ Esc ] Back')
    expect(output).toContain('◇ SAFETY · Machine')
    expect(output).not.toContain('╭')
    expect(output).not.toContain('╰')
    expect(rendered.lines).toHaveLength(6)
    expect(rendered.contentFirstRow).toBe(4)
    expect(rendered.choiceFirstRow).toBe(5)
    expect(rendered.contentStartColumn).toBe(1)
    expect(rendered.contentEndColumn).toBe(44)
    expect(rendered.lines.every((line) => displayWidth(line) <= 44)).toBe(true)
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

  it('projects entry controls as semantic Mission Console content', () => {
    expect(renderSupervisorTransferInput(
      'Destination AliceProject key',
      ['> research'],
      'Existing remote AliceProjects are never replaced.',
    )).toEqual([
      '◆ Destination AliceProject key',
      '> research',
      '',
      'Existing remote AliceProjects are never replaced.',
      '',
      '◆ [ Enter ] Continue  │  [ Esc ] Back',
    ])
    expect(renderSupervisorTransferInput(
      'Destination complete Home',
      ['> relative'],
      'Enter an absolute remote path.',
      true,
    )[0]).toBe('! Destination complete Home · FIX')
    const choice = renderSupervisorTransferChoice('Credentials', ['› Transfer and re-seal'])
    expect(choice).toContain('◆ Credentials')
    expect(choice).toContain('◆ [ Enter ] Choose  │  [ Esc ] Back')
  })

  it('keeps Mission Console action hover visible without color', () => {
    const line = '│ ◆ [ Enter ] Continue  │  [ Esc ] Back │'
    const plain = decorateSupervisorTransferFlightDeck(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      'Enter',
    )[0]!
    expect(plain).toContain('│ › [ Enter ] Continue')
  })

  it('projects planning and review as a bounded Manifest console', () => {
    const planning = renderSupervisorTransferPlanning(44)
    expect(planning).toContain('◇ Building transfer manifest · CHECKSUMS')
    expect(planning.every((line) => displayWidth(line) <= 44)).toBe(true)

    const review = renderSupervisorTransferReview([
      'Review AliceProject transfer',
      '',
      'From      Research (research)',
      'To        cloud / Research',
      '',
      'Source stays unchanged.',
      '',
      '[ y ] / [ Enter ] Transfer · [ n ] / [ Esc ] Cancel',
    ], true, 44)
    expect(review[0]).toBe('◆ Transfer manifest · READY')
    expect(review).toContain('✓ Boundaries checked; ready to transfer.')
    expect(review).toContain('◆ [ Enter ] Transfer  │  [ Esc ] Cancel')
    expect(review.join('\n')).not.toContain('Review AliceProject transfer')
  })

  it('renders responsive streaming, recovery, and arrival status cards', () => {
    const progress = renderSupervisorTransferProgress({
      files: 3,
      totalFiles: 4,
      bytes: 3 * 1024,
      totalBytes: 4 * 1024,
    }, 36)
    expect(progress).toContain('◈ Transfer in flight · STREAMING')
    expect(progress).toContain('[━━━━━━━━━━━━━━━━━━━━━·······]  75%')
    expect(progress).toContain('3.0 KiB / 4.0 KiB')
    expect(progress.every((line) => displayWidth(line) <= 36)).toBe(true)

    const recovery = renderSupervisorTransferRecovery(
      'Remote checksum did not match the manifest after the receiver verified every file.',
      true,
      38,
    )
    expect(recovery[0]).toBe('! Transfer interrupted · RECOVERY')
    expect(recovery).toContain('◆ [ r ] Retry  │  [ Esc ] Close')
    expect(recovery.every((line) => displayWidth(line) <= 38)).toBe(true)

    const arrival = renderSupervisorTransferArrival([
      'AliceProject transfer complete',
      '',
      'Cloud / research',
      '/home/alice/.openalice-research',
      '',
      '[ s ] Start · [ o ] Connect/Open · [ Enter ] Done',
    ], 56)
    expect(arrival[0]).toBe('✓ AliceProject arrived · PUBLISHED')
    expect(arrival).toContain('◆ Remote Runtime is stopped · source unchanged')
    expect(arrival).toContain('◆ [ s ] Start  │  [ o ] Open  │  [ Enter ] Done')
  })

  it('keeps Mission Control shelves clickable and visible without color', () => {
    const line = '│ ◆ [ r ] Retry  │  [ Esc ] Close │'
    const plain = decorateSupervisorTransferFlightDeck(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      'r',
    )[0]!
    expect(plain).toContain('│ › [ r ] Retry')
  })
})
