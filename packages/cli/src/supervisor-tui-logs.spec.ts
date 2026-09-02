import { describe, expect, it } from 'vitest'

import {
  nextSupervisorLogFilter,
  renderSupervisorLogs,
  supervisorFilteredLogCount,
  supervisorSelectedLogEntry,
} from './supervisor-tui-logs.ts'
import { displayWidth } from './supervisor-display.ts'
import { supervisorCommandTargets } from './supervisor-tui-view.ts'

describe('Supervisor Runtime log presentation', () => {
  const logs = {
    entries: [
      { text: '{"ts":"2026-09-02T03:04:05.123Z","level":"info","msg":"Runtime ready","scope":"guardian"}' },
      { text: 'adapter warning: slow response' },
      { text: '{"ts":"2026-09-02T03:04:07Z","level":"error","msg":"Probe failed","attempt":2}' },
      { text: 'plain adapter output\u001b[31m' },
    ],
  }

  it('projects structured events and preserves sanitized plain text', () => {
    const rendered = renderSupervisorLogs(logs, 100, 0, 'all')
    const output = rendered.lines.join('\n')
    expect(output).toContain('· 1  03:04:05Z Runtime ready · scope=guardian')
    expect(output).toContain('! 2  adapter warning: slow response')
    expect(output).toContain('× 3  03:04:07Z Probe failed · attempt=2')
    expect(output).toContain('· 4  plain adapter output [31m')
    expect(output).not.toContain('"msg"')
    expect(output).not.toContain('\u001b')
    expect(output).toContain('Event Lens · LINE 4 · INFO · TEXT')
    expect(output).toContain('› · 4  plain adapter output [31m')
    expect(rendered.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromEnd: 0 }),
      expect.objectContaining({ fromEnd: 3 }),
    ]))
  })

  it('cycles local severity views while retaining original line numbers', () => {
    expect(nextSupervisorLogFilter('all')).toBe('attention')
    expect(nextSupervisorLogFilter('attention')).toBe('errors')
    expect(nextSupervisorLogFilter('errors')).toBe('all')
    expect(supervisorFilteredLogCount(logs, 'attention')).toBe(2)
    expect(supervisorFilteredLogCount(logs, 'errors')).toBe(1)

    const attention = renderSupervisorLogs(logs, 80, 0, 'attention').lines.join('\n')
    expect(attention).toContain('ATTENTION · 2/4 · LATEST')
    expect(attention).toContain('! 2  adapter warning')
    expect(attention).toContain('× 3  03:04:07Z Probe failed')
    expect(attention).not.toContain('Runtime ready')

    const errors = renderSupervisorLogs(logs, 80, 0, 'errors').lines.join('\n')
    expect(errors).toContain('ERRORS · 1/4 · LATEST')
    expect(errors).toContain('× 3  03:04:07Z Probe failed')
  })

  it('returns the focused bounded event for an explicit clipboard action', () => {
    expect(supervisorSelectedLogEntry(logs, 'all', 0)).toEqual({
      number: 4,
      text: 'plain adapter output [31m',
    })
    expect(supervisorSelectedLogEntry(logs, 'attention', 1)).toEqual({
      number: 2,
      text: 'adapter warning: slow response',
    })
    expect(supervisorSelectedLogEntry(logs, 'errors', 99)?.number).toBe(3)
    expect(supervisorSelectedLogEntry({ entries: [] }, 'all', 0)).toBeNull()
  })

  it('turns unloaded, quiet, and filtered-empty snapshots into compact Runtime lenses', () => {
    const unloaded = renderSupervisorLogs(null, 80, 0, 'attention')
    expect(unloaded.lines).toHaveLength(4)
    expect(unloaded.lines.join('\n')).toContain('Runtime Lens · STANDBY')
    expect(unloaded.lines.join('\n')).toContain('◇ STANDBY · Snapshot not loaded · warnings + errors · bounded/redacted')
    expect(supervisorCommandTargets(unloaded.lines)).toEqual([
      expect.objectContaining({
        label: 'l',
        surface: '◆ [ l ] Load bounded Runtime tail',
        primary: true,
      }),
    ])

    const quiet = renderSupervisorLogs({ entries: [] }, 80, 0, 'all')
    expect(quiet.lines.join('\n')).toContain('Runtime Lens · QUIET · 0 EVENTS')
    expect(quiet.lines.join('\n')).toContain('○ QUIET · No Runtime events · all events · bounded/redacted')
    expect(quiet.lines.join('\n')).toContain('◆ [ l ] Reload Runtime snapshot')

    const clear = renderSupervisorLogs({ entries: [{ text: 'all good' }] }, 80, 0, 'errors')
    expect(clear.lines.join('\n')).toContain('CLEAR · 0/1 · ERRORS')
    expect(clear.lines.join('\n')).toContain('✓ CLEAR · 0/1 errors · source loaded · bounded/redacted')
    expect(supervisorCommandTargets(clear.lines)).toEqual([
      expect.objectContaining({
        label: 'f',
        surface: '◆ [ f ] Change severity lens',
        primary: true,
      }),
    ])
  })

  it('keeps the compact Runtime lens complete at narrow widths', () => {
    const rendered = renderSupervisorLogs(null, 46, 0, 'attention')
    expect(rendered.lines).toHaveLength(4)
    expect(rendered.lines.every((line) => displayWidth(line) === 46)).toBe(true)
    expect(rendered.lines.join('\n')).toContain('◇ STANDBY · Snapshot not loaded · warning…')
    expect(rendered.lines.join('\n')).toContain('◆ [ l ] Load Runtime tail')
  })

  it('keeps pointer targets aligned with a centered event window and inspector focus', () => {
    const many = {
      entries: Array.from({ length: 20 }, (_, index) => ({ text: `event ${index + 1}` })),
    }
    const rendered = renderSupervisorLogs(many, 80, 9, 'all', 10, undefined, 3)
    expect(rendered.lines.join('\n')).toContain('8–14/20 · ALL')
    expect(rendered.lines.join('\n')).toContain('› · 11  event 11')
    expect(rendered.lines.join('\n')).toContain('» · 10  event 10')
    expect(rendered.lines.join('\n')).toContain('Event Lens · LINE 11 · INFO · TEXT')
    expect(rendered.targets).toHaveLength(7)
    expect(rendered.targets.find((target) => target.fromEnd === 10)?.row).toBe(4)
    expect(rendered.railTargets).toEqual([
      { row: 2, column: 78, trackRow: 0, index: 0 },
      { row: 3, column: 78, trackRow: 1, index: 3 },
      { row: 4, column: 78, trackRow: 2, index: 6 },
      { row: 5, column: 78, trackRow: 3, index: 10 },
      { row: 6, column: 78, trackRow: 4, index: 13 },
      { row: 7, column: 78, trackRow: 5, index: 16 },
      { row: 8, column: 78, trackRow: 6, index: 19 },
    ])
    expect(rendered.lines[4]?.at(-3)).toBe('◆')
    expect(rendered.lines.join('\n')).toContain('█')
    expect(rendered.lines.join('\n')).toContain('│')
  })

  it('spends a wide Operational Canvas on additional real events', () => {
    const many = {
      entries: Array.from({ length: 20 }, (_, index) => ({ text: `event ${index + 1}` })),
    }
    const expanded = renderSupervisorLogs(many, 120, 0, 'all', null, 22)

    expect(expanded.lines).toHaveLength(22)
    expect(expanded.lines.join('\n')).toContain('1–20/20 · ALL · LATEST')
    expect(expanded.lines.join('\n')).toContain('› · 20  event 20')
    expect(expanded.lines.join('\n')).not.toContain('█')
    expect(expanded.targets).toHaveLength(20)
    expect(expanded.railTargets).toEqual([])
    expect(expanded.targets.at(-1)).toEqual({
      row: 21,
      startColumn: 2,
      endColumn: 63,
      fromEnd: 0,
    })

    const compact = renderSupervisorLogs(many, 80, 0, 'all')
    expect(compact.targets).toHaveLength(7)
    expect(compact.lines.join('\n')).toContain('█')
  })

  it('does not spend a wide canvas on a zero-event Runtime lens', () => {
    const expanded = renderSupervisorLogs({ entries: [] }, 120, 0, 'all', null, 22)
    const compact = renderSupervisorLogs({ entries: [] }, 80, 0, 'all', null, 22)
    const targets = supervisorCommandTargets(expanded.lines)

    expect(expanded.lines).toHaveLength(4)
    expect(expanded.lines[1]).toContain('○ QUIET · No Runtime events')
    expect(expanded.lines[2]).toContain('◆ [ l ] Reload Runtime snapshot')
    expect(expanded.lines.join('\n')).not.toContain('· ───── ○ ───── ·')
    expect(targets).toEqual([
      expect.objectContaining({ row: 3, label: 'l', primary: true }),
    ])
    expect(compact.lines).toHaveLength(4)
  })
})
