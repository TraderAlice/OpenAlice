import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { claimIssueFirstSession, issueRuntimeSelection } from './claim-session.js'
import { readWorkspaceIssues } from './declaration.js'
import { createIssue, updateIssueFields } from './mutate.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'issue-claim-session-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('issueRuntimeSelection', () => {
  it('omits an empty tuple', () => {
    expect(issueRuntimeSelection({})).toBeUndefined()
  })

  it('freezes credential, model, and effort', () => {
    expect(issueRuntimeSelection({
      credential: 'openai-primary',
      model: 'gpt-5.6-sol',
      effort: 'high',
    })).toEqual({
      credentialSlug: 'openai-primary',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
  })
})

describe('claimIssueFirstSession', () => {
  it('rewrites @new-then-resume to the dispatched Session', async () => {
    await createIssue(dir, {
      id: 'desk',
      title: 'Desk',
      assignee: '@new-then-resume',
      when: { kind: 'every', every: '4h' },
    })
    const append = vi.fn(async (input) => ({ id: 'p-1', ...input }))
    expect(await claimIssueFirstSession({
      issueWorkspace: { id: 'ws-home', dir },
      issueId: 'desk',
      taskId: 'run-1',
      resumeId: 'resume-new-owner',
      agent: 'pi',
      provenanceStore: { append, list: vi.fn(), latest: vi.fn() },
    })).toBe('claimed')
    const live = await readWorkspaceIssues(dir)
    expect(live.ok && live.issues[0]?.assignee).toBe('@resume-new-owner')
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'updated',
      origin: expect.objectContaining({ resumeId: 'resume-new-owner', agent: 'pi' }),
      mutation: expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'assignee', before: '@new-then-resume', after: '@resume-new-owner' }),
        ]),
      }),
    }), expect.anything())
  })

  it('skips when the assignee is no longer a pending first-Session claim', async () => {
    await createIssue(dir, {
      id: 'desk',
      title: 'Desk',
      assignee: '@new-then-resume',
      when: { kind: 'every', every: '4h' },
    })
    await updateIssueFields(dir, 'desk', { assignee: '@resume-already-owned' })
    const append = vi.fn(async (input) => ({ id: 'p-1', ...input }))
    expect(await claimIssueFirstSession({
      issueWorkspace: { id: 'ws-home', dir },
      issueId: 'desk',
      taskId: 'run-late',
      resumeId: 'resume-new-owner',
      agent: 'pi',
      provenanceStore: { append, list: vi.fn(), latest: vi.fn() },
    })).toBe('skipped')
    const live = await readWorkspaceIssues(dir)
    expect(live.ok && live.issues[0]?.assignee).toBe('@resume-already-owned')
    expect(append).not.toHaveBeenCalled()
  })
})
