import { describe, expect, it } from 'vitest'

import { buildWorkspaceSessionDirectory } from './session-directory.js'

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
      interactive: { name: 'c1', title: 'Investigate provenance' },
      latestExecution: { taskId: 'task-1', assistantPreview: 'done' },
    })
    expect(JSON.stringify(result)).not.toContain('native-secret')
    expect(JSON.stringify(result)).not.toContain('launcher-secret')
    expect(JSON.stringify(result)).not.toContain('private repeated prompt')
  })
})
