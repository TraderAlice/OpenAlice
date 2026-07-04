import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readWorkspaceIssues } from './declaration.js'
import { completeOneShotIssueAfterRun } from './auto-complete.js'
import { createIssue } from './mutate.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'issues-autocomplete-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function issueStatus(id: string) {
  const r = await readWorkspaceIssues(dir)
  if (!r.ok) throw new Error(`readWorkspaceIssues not ok: ${JSON.stringify(r)}`)
  return r.issues.find((i) => i.id === id)?.status
}

describe('completeOneShotIssueAfterRun', () => {
  it('marks a successful one-shot scheduled issue done', async () => {
    await createIssue(dir, {
      id: 'water-reminder-test',
      title: 'Reminder delivery smoke test',
      status: 'todo',
      when: { kind: 'at', at: '2030-01-01T09:00:00Z' },
      agent: 'pi',
      body: 'Make sure this keeps the body.',
    })

    const res = await completeOneShotIssueAfterRun({
      wsDir: dir,
      issueId: 'water-reminder-test',
      status: 'done',
      exitCode: 0,
      killed: false,
    })

    expect(res).toEqual({ updated: true, issueId: 'water-reminder-test', previousStatus: 'todo' })
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const issue = r.issues.find((i) => i.id === 'water-reminder-test')
      expect(issue).toMatchObject({
        status: 'done',
        agent: 'pi',
        body: 'Make sure this keeps the body.',
      })
      expect(issue?.when).toEqual({ kind: 'at', at: '2030-01-01T09:00:00Z' })
    }
  })

  it('leaves one-shot issues open when the run failed', async () => {
    await createIssue(dir, {
      id: 'failed-once',
      title: 'Failed once',
      status: 'todo',
      when: { kind: 'at', at: '2030-01-01T09:00:00Z' },
    })

    const res = await completeOneShotIssueAfterRun({
      wsDir: dir,
      issueId: 'failed-once',
      status: 'failed',
      exitCode: 1,
      killed: false,
    })

    expect(res).toEqual({ updated: false, reason: 'not_success', issueId: 'failed-once' })
    expect(await issueStatus('failed-once')).toBe('todo')
  })

  it('does not close repeating schedules after a successful fire', async () => {
    await createIssue(dir, {
      id: 'daily-scan',
      title: 'Daily scan',
      status: 'todo',
      when: { kind: 'cron', cron: '0 8 * * 1-5' },
    })

    const res = await completeOneShotIssueAfterRun({
      wsDir: dir,
      issueId: 'daily-scan',
      status: 'done',
      exitCode: 0,
      killed: false,
    })

    expect(res).toEqual({ updated: false, reason: 'not_one_shot', issueId: 'daily-scan' })
    expect(await issueStatus('daily-scan')).toBe('todo')
  })

  it('keeps already-terminal one-shot issues untouched', async () => {
    await createIssue(dir, {
      id: 'already-canceled',
      title: 'Already canceled',
      status: 'canceled',
      when: { kind: 'at', at: '2030-01-01T09:00:00Z' },
    })

    const res = await completeOneShotIssueAfterRun({
      wsDir: dir,
      issueId: 'already-canceled',
      status: 'done',
      exitCode: 0,
      killed: false,
    })

    expect(res).toEqual({
      updated: false,
      reason: 'terminal',
      issueId: 'already-canceled',
      status: 'canceled',
    })
    expect(await issueStatus('already-canceled')).toBe('canceled')
  })

  it('ignores manual headless runs that are not linked to an issue', async () => {
    await createIssue(dir, {
      id: 'manual-proof',
      title: 'Manual proof',
      status: 'todo',
      when: { kind: 'at', at: '2030-01-01T09:00:00Z' },
    })

    const res = await completeOneShotIssueAfterRun({
      wsDir: dir,
      status: 'done',
      exitCode: 0,
      killed: false,
    })

    expect(res).toEqual({ updated: false, reason: 'not_issue_run' })
    expect(await issueStatus('manual-proof')).toBe('todo')
  })
})
