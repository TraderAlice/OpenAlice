import { describe, expect, it } from 'vitest'

import { issueAutomationHealth, type IssueAutomationHealthInput } from './automation-health.js'

const base: IssueAutomationHealthInput = {
  status: 'todo',
  nowMs: 1_000,
  nextDueAtMs: 2_000,
  ownerState: 'workspace',
}

describe('issueAutomationHealth', () => {
  it('distinguishes an untouched schedule from one that is due', () => {
    expect(issueAutomationHealth(base).state).toBe('not_started')
    expect(issueAutomationHealth({ ...base, nextDueAtMs: base.nowMs }).state).toBe('due')
  })

  it('blocks a live Issue whose schedule cannot produce another fire', () => {
    expect(issueAutomationHealth({ ...base, nextDueAtMs: null })).toMatchObject({
      state: 'blocked',
      message: expect.stringMatching(/no future fire/),
    })
  })

  it('projects the latest scheduled execution', () => {
    expect(issueAutomationHealth({ ...base, latestRun: { taskId: 'run-a', status: 'running' } })).toMatchObject({
      state: 'running', latestTaskId: 'run-a',
    })
    expect(issueAutomationHealth({ ...base, latestRun: { taskId: 'run-b', status: 'done' } })).toMatchObject({
      state: 'healthy', latestTaskId: 'run-b',
    })
    expect(issueAutomationHealth({ ...base, latestRun: { taskId: 'run-c', status: 'interrupted' } })).toMatchObject({
      state: 'interrupted', latestTaskId: 'run-c',
    })
    expect(issueAutomationHealth({
      ...base,
      latestRun: {
        taskId: 'run-sleep',
        status: 'failed',
        failure: {
          kind: 'system_paused',
          title: 'Computer or launcher was paused',
          message: 'watchdog ran late',
          retryable: true,
        },
      },
    })).toMatchObject({ state: 'interrupted', message: 'watchdog ran late' })
  })

  it('blocks a future dispatch when an exact Session cannot resume', () => {
    expect(issueAutomationHealth({ ...base, ownerState: 'missing' }).state).toBe('blocked')
    expect(issueAutomationHealth({ ...base, ownerState: 'retired' }).message).toMatch(/retired/)
    expect(issueAutomationHealth({ ...base, ownerState: 'unbound' }).message).toMatch(/resumable/)
  })

  it('lets an in-flight run finish before surfacing a newly blocked owner', () => {
    expect(issueAutomationHealth({
      ...base,
      ownerState: 'retired',
      latestRun: { taskId: 'run-live', status: 'running' },
    }).state).toBe('running')
  })

  it('makes terminal Issue status the schedule switch', () => {
    expect(issueAutomationHealth({ ...base, status: 'done', nextDueAtMs: base.nowMs }).state).toBe('inactive')
  })
})
