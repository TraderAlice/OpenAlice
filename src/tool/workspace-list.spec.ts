import { describe, expect, it } from 'vitest'
import type { Tool } from 'ai'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { workspaceListFactory } from './workspace-list.js'

function ctx(overrides: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'workspace-manager',
    workspaceLabel: 'Workspace Manager',
    inboxStore: {} as never,
    entityStore: {} as never,
    workspaceInventory: async () => [{
      id: 'ws-market',
      tag: 'Market Desk',
      template: 'chat',
      createdAt: '2026-07-15T00:00:00.000Z',
      sessions: {
        total: 3,
        running: 1,
        recent: [{
          resumeId: 'resume-market-owner',
          agent: 'pi',
          title: 'Review market breadth',
          state: 'running',
          lastActiveAt: '2026-07-15T01:00:00.000Z',
        }],
      },
      headlessRunning: 2,
    }],
    ...overrides,
  }
}

async function run(tool: Tool) {
  return tool.execute!({}, { toolCallId: 'workspace-list-test', messages: [] })
}

describe('workspace_list', () => {
  it('returns the active office-floor inventory with live workload counts', async () => {
    await expect(run(workspaceListFactory.build(ctx()))).resolves.toEqual({
      ok: true,
      count: 1,
      workspaces: [{
        id: 'ws-market',
        tag: 'Market Desk',
        template: 'chat',
        createdAt: '2026-07-15T00:00:00.000Z',
        sessions: {
          total: 3,
          running: 1,
          recent: [{
            resumeId: 'resume-market-owner',
            agent: 'pi',
            title: 'Review market breadth',
            state: 'running',
            lastActiveAt: '2026-07-15T01:00:00.000Z',
          }],
        },
        headlessRunning: 2,
      }],
    })
  })

  it('fails explicitly when the launcher inventory seam is unavailable', async () => {
    await expect(run(workspaceListFactory.build(ctx({ workspaceInventory: undefined })))).resolves.toEqual({
      ok: false,
      error: 'workspace inventory is unavailable in this context',
    })
  })
})
