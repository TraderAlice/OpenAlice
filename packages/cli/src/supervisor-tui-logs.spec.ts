import { describe, expect, it } from 'vitest'

import {
  nextSupervisorLogFilter,
  renderSupervisorLogs,
  supervisorFilteredLogCount,
} from './supervisor-tui-logs.ts'

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

  it('renders an explicit empty filtered state', () => {
    const output = renderSupervisorLogs({ entries: [{ text: 'all good' }] }, 80, 0, 'errors').lines.join('\n')
    expect(output).toContain('0/1 · ERRORS')
    expect(output).toContain('✓ No error log entries in this snapshot.')
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
  })
})
