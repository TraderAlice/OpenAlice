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
    const output = renderSupervisorLogs(logs, 100, 0, 'all').join('\n')
    expect(output).toContain('· 1  03:04:05Z Runtime ready · scope=guardian')
    expect(output).toContain('! 2  adapter warning: slow response')
    expect(output).toContain('× 3  03:04:07Z Probe failed · attempt=2')
    expect(output).toContain('· 4  plain adapter output [31m')
    expect(output).not.toContain('"msg"')
    expect(output).not.toContain('\u001b')
  })

  it('cycles local severity views while retaining original line numbers', () => {
    expect(nextSupervisorLogFilter('all')).toBe('attention')
    expect(nextSupervisorLogFilter('attention')).toBe('errors')
    expect(nextSupervisorLogFilter('errors')).toBe('all')
    expect(supervisorFilteredLogCount(logs, 'attention')).toBe(2)
    expect(supervisorFilteredLogCount(logs, 'errors')).toBe(1)

    const attention = renderSupervisorLogs(logs, 80, 0, 'attention').join('\n')
    expect(attention).toContain('ATTENTION · 2/4 · LATEST')
    expect(attention).toContain('! 2  adapter warning')
    expect(attention).toContain('× 3  03:04:07Z Probe failed')
    expect(attention).not.toContain('Runtime ready')

    const errors = renderSupervisorLogs(logs, 80, 0, 'errors').join('\n')
    expect(errors).toContain('ERRORS · 1/4 · LATEST')
    expect(errors).toContain('× 3  03:04:07Z Probe failed')
  })

  it('renders an explicit empty filtered state', () => {
    const output = renderSupervisorLogs({ entries: [{ text: 'all good' }] }, 80, 0, 'errors').join('\n')
    expect(output).toContain('0/1 · ERRORS')
    expect(output).toContain('✓ No error log entries in this snapshot.')
  })
})
