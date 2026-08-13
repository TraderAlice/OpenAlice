import { describe, expect, it } from 'vitest'

import {
  issueRunFailure,
  SCHEDULED_ISSUE_RUN_TIMEOUT_MS,
} from './run-failure.js'

describe('issueRunFailure', () => {
  it('distinguishes a late watchdog after system pause from a normal timeout', () => {
    expect(issueRunFailure({
      status: 'failed',
      killed: true,
      durationMs: SCHEDULED_ISSUE_RUN_TIMEOUT_MS + 14 * 60_000,
    })).toMatchObject({ kind: 'system_paused', retryable: true })

    expect(issueRunFailure({
      status: 'failed',
      killed: true,
      durationMs: SCHEDULED_ISSUE_RUN_TIMEOUT_MS + 5_000,
    })).toMatchObject({ kind: 'timeout', retryable: true })

    expect(issueRunFailure({
      status: 'failed',
      killed: true,
      timeoutMs: 15 * 60_000,
      durationMs: 15 * 60_000 + 2_000,
    })).toMatchObject({
      kind: 'timeout',
      message: expect.stringContaining('15m'),
    })
  })

  it('explains restart reconciliation, launch errors, and process exits', () => {
    expect(issueRunFailure({ status: 'interrupted' })).toMatchObject({ kind: 'launcher_restarted' })
    expect(issueRunFailure({ status: 'failed', error: 'spawn ENOENT' })).toMatchObject({
      kind: 'launch_error', message: 'spawn ENOENT',
    })
    expect(issueRunFailure({ status: 'failed', exitCode: 2 })).toMatchObject({ kind: 'process_exit' })
    expect(issueRunFailure({
      status: 'failed',
      timeoutMs: null,
      killed: true,
      signal: 'SIGKILL',
      durationMs: SCHEDULED_ISSUE_RUN_TIMEOUT_MS,
    })).toMatchObject({ kind: 'process_exit' })
    expect(issueRunFailure({
      status: 'failed',
      processStarted: true,
      exitCode: 7,
    })).toMatchObject({ kind: 'process_exit' })
  })

  it('does not manufacture failures for running or completed runs', () => {
    expect(issueRunFailure({ status: 'running' })).toBeUndefined()
    expect(issueRunFailure({ status: 'done' })).toBeUndefined()
  })
})
