import { describe, expect, it } from 'vitest'

import { projectIssueAssigneeSession } from './assignee-session.js'

const identity = {
  resumeId: 'resume-gentle-otter-abc123',
  wsId: 'ws-1',
  agent: 'grok',
  agentSessionId: 'native-private-id',
  createdAt: 1,
  updatedAt: 2,
  lifecycle: 'active' as const,
}

describe('projectIssueAssigneeSession', () => {
  it.each(['terminal', 'webpi'] as const)(
    'keeps an exact owner active while its %s Session is running',
    (surface) => {
      expect(projectIssueAssigneeSession({
        assignee: '@resume-gentle-otter-abc123',
        identity,
        workspace: { id: 'ws-1', tag: 'research' },
        interactive: { state: 'running', surface },
      })).toMatchObject({
        resumeId: identity.resumeId,
        state: 'ready',
        active: true,
      })
    },
  )

  it('does not treat a persisted headless record as live without its launcher lease', () => {
    expect(projectIssueAssigneeSession({
      assignee: '@resume-gentle-otter-abc123',
      identity,
      workspace: { id: 'ws-1', tag: 'research' },
      interactive: { state: 'running', surface: 'headless' },
    })?.active).toBe(false)
  })

  it('keeps a live headless owner active through the launcher lease', () => {
    expect(projectIssueAssigneeSession({
      assignee: '@resume-gentle-otter-abc123',
      identity,
      workspace: { id: 'ws-1', tag: 'research' },
      interactive: { state: 'paused', surface: 'headless' },
      headlessActive: true,
    })?.active).toBe(true)
  })

  it('projects missing exact owners without inventing activity', () => {
    expect(projectIssueAssigneeSession({
      assignee: '@resume-missing',
    })).toEqual({ resumeId: 'resume-missing', state: 'missing', active: false })
  })
})
