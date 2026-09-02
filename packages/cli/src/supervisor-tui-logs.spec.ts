import { describe, expect, it } from 'vitest'

import {
  nextSupervisorLogFilter,
  renderSupervisorLogs,
  supervisorFilteredLogCount,
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

  it('turns unloaded, quiet, and filtered-empty snapshots into truthful Signal Scopes', () => {
    const unloaded = renderSupervisorLogs(null, 80, 0, 'attention')
    expect(unloaded.lines).toHaveLength(7)
    expect(unloaded.lines.join('\n')).toContain('Event Signal Scope · STANDBY')
    expect(unloaded.lines.join('\n')).toContain('◇  SIGNAL STANDBY')
    expect(unloaded.lines.join('\n')).toContain('LENS       warnings + errors · awaiting capture')
    expect(supervisorCommandTargets(unloaded.lines)).toEqual([
      expect.objectContaining({
        label: 'l',
        surface: '◆ [ l ] Load bounded Runtime tail',
        primary: true,
      }),
    ])

    const quiet = renderSupervisorLogs({ entries: [] }, 80, 0, 'all')
    expect(quiet.lines.join('\n')).toContain('Event Signal Scope · QUIET · 0 EVENTS')
    expect(quiet.lines.join('\n')).toContain('○  SIGNAL QUIET')
    expect(quiet.lines.join('\n')).toContain('SNAPSHOT   Loaded · 0 Runtime events')
    expect(quiet.lines.join('\n')).toContain('◆ [ l ] Reload Runtime snapshot')

    const clear = renderSupervisorLogs({ entries: [{ text: 'all good' }] }, 80, 0, 'errors')
    expect(clear.lines.join('\n')).toContain('CLEAR · 0/1 · ERRORS')
    expect(clear.lines.join('\n')).toContain('✓  LENS CLEAR')
    expect(clear.lines.join('\n')).toContain('LENS       errors · 0 matches')
    expect(supervisorCommandTargets(clear.lines)).toEqual([
      expect.objectContaining({
        label: 'f',
        surface: '◆ [ f ] Change severity lens',
        primary: true,
      }),
    ])
  })

  it('keeps the Signal Scope complete at narrow widths', () => {
    const rendered = renderSupervisorLogs(null, 46, 0, 'attention')
    expect(rendered.lines).toHaveLength(7)
    expect(rendered.lines.every((line) => displayWidth(line) === 46)).toBe(true)
    expect(rendered.lines.join('\n')).toContain('◇  SIGNAL STANDBY')
    expect(rendered.lines.join('\n')).toContain('Lens      warnings + errors · awaiting ca…')
    expect(rendered.lines.join('\n')).toContain('◆ [ l ] Load Runtime tail')
  })

  it('keeps pointer targets aligned with a centered event window and inspector focus', () => {
    const many = {
      entries: Array.from({ length: 20 }, (_, index) => ({ text: `event ${index + 1}` })),
    }
    const rendered = renderSupervisorLogs(many, 80, 9, 'all', 10)
    expect(rendered.lines.join('\n')).toContain('8–14/20 · ALL')
    expect(rendered.lines.join('\n')).toContain('› · 11  event 11')
    expect(rendered.lines.join('\n')).toContain('» · 10  event 10')
    expect(rendered.lines.join('\n')).toContain('Event Lens · LINE 11 · INFO · TEXT')
    expect(rendered.targets).toHaveLength(7)
    expect(rendered.targets.find((target) => target.fromEnd === 10)?.row).toBe(4)
    expect(rendered.lines.join('\n')).toContain('█')
    expect(rendered.lines.join('\n')).toContain('│')
  })
})
