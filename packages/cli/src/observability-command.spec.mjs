import { describe, expect, it, vi } from 'vitest'

import {
  formatObservabilityHelp,
  parseObservabilityArgs,
  runObservabilityCommand,
} from './observability-command.mjs'

describe('observability command presenter', () => {
  it('parses bounded logs and Doctor options', () => {
    expect(parseObservabilityArgs('logs', ['--home', '/tmp/alice', '--lines', '50', '--json'])).toEqual({
      homeRoot: '/tmp/alice',
      json: true,
      waitMs: 2_000,
      lines: 50,
    })
    expect(parseObservabilityArgs('doctor', ['--wait', '3', '--json'])).toEqual({
      homeRoot: null,
      json: true,
      waitMs: 3_000,
    })
    expect(() => parseObservabilityArgs('logs', ['--lines', '0'])).toThrow('between 1 and 5000')
  })

  it('prints redacted log entries in the shared JSON envelope', async () => {
    const stdout = sink()
    const exitCode = await runObservabilityCommand(
      'logs',
      parseObservabilityArgs('logs', ['--json']),
      {
        stdout,
        readLogs: async () => ({
          home: '/tmp/alice',
          component: 'runtime',
          lineLimit: 200,
          truncated: false,
          files: [{ name: 'server.log', size: 12, modifiedAt: '2026-07-29T00:00:00.000Z' }],
          entries: [{ file: 'server.log', text: 'ready' }],
        }),
      },
    )
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout.value)).toMatchObject({
      schemaVersion: 1,
      command: 'logs',
      ok: true,
      result: { logs: { entries: [{ text: 'ready' }] } },
    })
  })

  it('returns one for completed Doctor diagnostics with failures', async () => {
    const stdout = sink()
    const exitCode = await runObservabilityCommand(
      'doctor',
      parseObservabilityArgs('doctor', []),
      {
        stdout,
        diagnose: async () => ({
          overall: 'error',
          summary: { passed: 0, warnings: 0, failures: 1 },
          checks: [{ id: 'runtime.web', status: 'fail', summary: 'Web is unavailable' }],
        }),
      },
    )
    expect(exitCode).toBe(1)
    expect(stdout.value).toContain('[FAIL] Web is unavailable')
    expect(formatObservabilityHelp('doctor')).toContain('read-only checks')
  })
})

function sink() {
  return {
    value: '',
    write: vi.fn(function write(value) {
      this.value += value
    }),
  }
}
