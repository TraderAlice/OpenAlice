import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceSessionDirectory,
  connectorDeskRosterExclusions,
  issueRosterAttachments,
} from './session-directory.js'

describe('buildWorkspaceSessionDirectory', () => {
  it('joins useful state while hiding native and launcher ids', () => {
    const result = buildWorkspaceSessionDirectory({
      workspace: { id: 'ws-1', tag: 'research' },
      identities: [{
        resumeId: 'resume-kind-owl-abc123',
        wsId: 'ws-1',
        agent: 'codex',
        agentSessionId: 'native-secret',
        latestTaskId: 'task-1',
        createdAt: 1,
        updatedAt: 2,
        lifecycle: 'active',
        metadata: {
          createdBy: {
            kind: 'issue',
            workspaceId: 'ws-1',
            issueId: 'daily-market-close',
            policy: 'new-then-resume',
            fire: 'schedule',
          },
        },
        displayName: 'AAPL desk',
        runtimeBinding: {
          version: 1,
          credential: { source: 'vault', credentialSlug: 'secret-slug', wireShape: 'openai-responses' },
          model: 'gpt-5.6-terra',
          reasoningEffort: 'high',
        },
      }],
      interactiveFor: () => ({
        id: 'launcher-secret',
        resumeId: 'resume-kind-owl-abc123',
        wsId: 'ws-1',
        agent: 'codex',
        name: 'c1',
        title: 'Investigate provenance',
        createdAt: '2026-07-11T00:00:00Z',
        lastActiveAt: '2026-07-11T00:01:00Z',
        state: 'paused',
      }),
      latestExecutionFor: () => ({
        taskId: 'task-1',
        resumeId: 'resume-kind-owl-abc123',
        wsId: 'ws-1',
        agent: 'codex',
        prompt: 'private repeated prompt',
        status: 'done',
        startedAt: 1,
        agentSessionId: 'native-secret',
        output: { hasAssistantReply: true, assistantPreview: 'done', blockCount: 1, toolCalls: 0, toolFailures: 0 },
      }),
      isActive: () => false,
    })

    expect(result.sessions[0]).toMatchObject({
      resumeId: 'resume-kind-owl-abc123',
      resumable: true,
      createdBy: {
        kind: 'issue',
        workspaceId: 'ws-1',
        issueId: 'daily-market-close',
        policy: 'new-then-resume',
        fire: 'schedule',
      },
      displayName: 'AAPL desk',
      runtime: { credentialSource: 'vault', credentialSlug: 'secret-slug', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      interactive: { name: 'c1', title: 'Investigate provenance' },
      latestExecution: { taskId: 'task-1', assistantPreview: 'done' },
    })
    expect(JSON.stringify(result)).not.toContain('native-secret')
    expect(JSON.stringify(result)).not.toContain('launcher-secret')
    expect(JSON.stringify(result)).not.toContain('private repeated prompt')
  })

  it('projects connector-owned Sessions as hidden roster state', () => {
    const result = buildWorkspaceSessionDirectory({
      workspace: { id: 'ws-1', tag: 'research' },
      identities: [{
        resumeId: 'resume-phone-desk',
        wsId: 'ws-1',
        agent: 'pi',
        createdAt: 1,
        updatedAt: 2,
        lifecycle: 'active',
      }],
      interactiveFor: () => undefined,
      latestExecutionFor: () => null,
      isActive: () => false,
      rosterVisibilityFor: () => 'hidden',
    })

    expect(result.sessions[0]?.rosterVisibility).toBe('hidden')
  })

  it('does not describe a headless Session record as an interactive opening', () => {
    const result = buildWorkspaceSessionDirectory({
      workspace: { id: 'ws-1', tag: 'research' },
      identities: [{
        resumeId: 'resume-headless',
        wsId: 'ws-1',
        agent: 'pi',
        createdAt: 1,
        updatedAt: 2,
        lifecycle: 'active',
      }],
      interactiveFor: () => ({
        id: 'session-headless',
        resumeId: 'resume-headless',
        wsId: 'ws-1',
        agent: 'pi',
        name: 'p1',
        createdAt: '2026-08-01T00:00:00.000Z',
        lastActiveAt: '2026-08-01T00:01:00.000Z',
        state: 'paused',
        surface: 'headless',
      }),
      latestExecutionFor: () => null,
      isActive: () => false,
    })

    expect(result.sessions[0]?.interactive).toBeUndefined()
  })

  it('projects archived presence and keeps a deleted Session non-resumable', () => {
    const archived = buildWorkspaceSessionDirectory({
      workspace: { id: 'ws-1', tag: 'research' },
      identities: [{
        resumeId: 'resume-archived',
        wsId: 'ws-1',
        agent: 'pi',
        agentSessionId: 'native-1',
        createdAt: 1,
        updatedAt: 2,
        lifecycle: 'active',
        presence: 'archived',
      }],
      interactiveFor: () => undefined,
      latestExecutionFor: () => null,
      isActive: () => false,
    })
    expect(archived.sessions[0]).toMatchObject({
      resumeId: 'resume-archived',
      presence: 'archived',
      resumable: true,
    })

    const deleted = buildWorkspaceSessionDirectory({
      workspace: { id: 'ws-1', tag: 'research' },
      identities: [{
        resumeId: 'resume-deleted',
        wsId: 'ws-1',
        agent: 'pi',
        agentSessionId: 'native-1',
        createdAt: 1,
        updatedAt: 2,
        lifecycle: 'active',
        presence: 'deleted',
      }],
      interactiveFor: () => undefined,
      latestExecutionFor: () => null,
      isActive: () => false,
    })
    expect(deleted.sessions[0]).toMatchObject({
      resumeId: 'resume-deleted',
      presence: 'deleted',
      resumable: false,
    })
  })
})

describe('connectorDeskRosterExclusions', () => {
  it('finds the fixed owner plus scheduled and inbound connector conversations', () => {
    const hidden = connectorDeskRosterExclusions({
      issues: [
        { id: 'telegram-phone-desk', assignee: '@resume-current', connectorDesk: 'telegram' },
        { id: 'ordinary-issue', assignee: '@resume-visible' },
      ],
      executionsForIssue: (issueId) => issueId === 'telegram-phone-desk'
        ? [{ resumeId: 'resume-scheduled' }]
        : [{ resumeId: 'resume-visible-run' }],
      inquiriesForIssue: (issueId) => issueId === 'telegram-phone-desk'
        ? [{ resumeId: 'resume-inbound' }]
        : [{ resumeId: 'resume-visible-inquiry' }],
    })

    expect([...hidden].sort()).toEqual([
      'resume-current',
      'resume-inbound',
      'resume-scheduled',
    ])
  })
})

describe('issueRosterAttachments', () => {
  it('finds exact Issue owners and Sessions currently executing an Issue', () => {
    const attached = issueRosterAttachments({
      issues: [
        { id: 'owned', assignee: '@resume-owner' },
        { id: 'fresh', assignee: '@new-each-run' },
      ],
      runningExecutions: [{
        resumeId: 'resume-running',
        trigger: { kind: 'issue', workspaceId: 'ws-1', issueId: 'fresh' },
      }, {
        resumeId: 'resume-unrelated',
        trigger: { kind: 'issue', workspaceId: 'ws-1', issueId: 'other' },
      }],
    })

    expect([...attached].sort()).toEqual(['resume-owner', 'resume-running'])
  })
})
