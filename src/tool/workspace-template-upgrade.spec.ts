import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import type { TemplateUpgradePlan } from '../workspaces/template-upgrade.js'
import { workspaceTemplateUpgradeFactory } from './workspace-template-upgrade.js'

async function run(tool: Tool, args: Record<string, unknown>) {
  return await tool.execute!(args, { toolCallId: 'upgrade', messages: [] }) as Record<string, any>
}

function plan(overrides: Partial<TemplateUpgradePlan> = {}): TemplateUpgradePlan {
  return {
    workspaceId: 'ws-1',
    template: 'chat',
    fromVersion: '1.5.0',
    toVersion: '1.6.1',
    strategy: 'managed-context',
    planDigest: 'digest-1',
    source: 'recorded-baseline',
    blocked: false,
    blockers: [],
    activity: { busy: false, sessions: [], headless: [] },
    files: [{
      path: 'AGENTS.md',
      status: 'ready',
      operation: 'update',
      currentPreview: 'old',
      templatePreview: 'new',
      currentTruncated: false,
      templateTruncated: false,
      canUseTemplate: true,
    }],
    summary: { ready: 1, preserved: 0, conflicts: 0, unchanged: 0 },
    ...overrides,
  }
}

function setup(currentPlan = plan()) {
  const templateUpgrades = {
    plan: vi.fn(async () => currentPlan),
    apply: vi.fn(async () => ({
      workspaceId: 'ws-1',
      fromVersion: currentPlan.fromVersion,
      toVersion: currentPlan.toVersion,
      commit: 'commit-1',
      changedPaths: ['AGENTS.md'],
      keptPaths: [],
    })),
  }
  const ctx = {
    workspaceId: 'ws-1',
    workspaceLabel: 'desk',
    inboxStore: {} as never,
    entityStore: {} as never,
    templateUpgrades,
  } satisfies WorkspaceToolContext
  return { tool: workspaceTemplateUpgradeFactory.build(ctx), templateUpgrades }
}

describe('workspace_template_upgrade', () => {
  it('applies Alice Harness configuration changes at the same source version', async () => {
    const { tool, templateUpgrades } = setup(plan({ template: 'alice-harness', fromVersion: '1.0.0', toVersion: '1.0.0' }))
    const result = await run(tool, { apply: true, mode: 'summary' })
    expect(result.action).toBe('applied')
    expect(templateUpgrades.apply).toHaveBeenCalledOnce()
  })

  it('previews by default without dumping file bodies', async () => {
    const { tool, templateUpgrades } = setup()
    const result = await run(tool, { apply: false, mode: 'summary' })

    expect(result).toMatchObject({
      ok: true,
      action: 'preview',
      preview: {
        status: 'ready',
        fromVersion: '1.5.0',
        toVersion: '1.6.1',
        nextCommand: 'alice template upgrade --apply',
      },
    })
    expect(result.preview.changes[0]).not.toHaveProperty('currentPreview')
    expect(templateUpgrades.apply).not.toHaveBeenCalled()
  })

  it('re-plans and applies the exact current digest after --apply', async () => {
    const { tool, templateUpgrades } = setup()
    const result = await run(tool, { apply: true, mode: 'summary' })

    expect(result).toMatchObject({ ok: true, action: 'applied', result: { commit: 'commit-1' } })
    expect(templateUpgrades.apply).toHaveBeenCalledWith('ws-1', { planDigest: 'digest-1' })
  })

  it('can target a paused peer Workspace without changing the caller identity', async () => {
    const { tool, templateUpgrades } = setup(plan({ workspaceId: 'ws-peer' }))
    const result = await run(tool, { id: 'ws-peer', apply: true, mode: 'summary' })

    expect(result.ok).toBe(true)
    expect(templateUpgrades.plan).toHaveBeenCalledWith('ws-peer')
    expect(templateUpgrades.apply).toHaveBeenCalledWith('ws-peer', { planDigest: 'digest-1' })
  })

  it('allows headless peer previews but refuses cross-Workspace apply', async () => {
    const { tool, templateUpgrades } = setup(plan({ workspaceId: 'ws-peer' }))
    const headlessTool = workspaceTemplateUpgradeFactory.build({
      workspaceId: 'ws-1',
      workspaceLabel: 'desk',
      inboxStore: {} as never,
      entityStore: {} as never,
      templateUpgrades,
      origin: { kind: 'headless', runId: 'run-1' },
    })

    expect(await run(headlessTool, { id: 'ws-peer', apply: false, mode: 'summary' }))
      .toMatchObject({ ok: true, action: 'preview' })
    expect(await run(headlessTool, { id: 'ws-peer', apply: true, mode: 'summary' }))
      .toMatchObject({ ok: false, error: { code: 'interactive_required' } })
    expect(templateUpgrades.apply).not.toHaveBeenCalled()
  })

  it('requires every conflict exactly once and forwards explicit resolutions', async () => {
    const conflictPlan = plan({
      files: [{
        path: 'AGENTS.md',
        status: 'conflict',
        operation: 'update',
        currentPreview: 'mine',
        templatePreview: 'theirs',
        currentTruncated: false,
        templateTruncated: false,
        canUseTemplate: true,
      }],
      summary: { ready: 0, preserved: 0, conflicts: 1, unchanged: 0 },
    })
    const { tool, templateUpgrades } = setup(conflictPlan)

    const unresolved = await run(tool, { apply: true, mode: 'detailed' })
    expect(unresolved).toMatchObject({
      ok: false,
      error: { code: 'invalid_resolutions', unresolved: ['AGENTS.md'] },
      preview: { conflicts: [{ currentPreview: 'mine', templatePreview: 'theirs' }] },
    })
    expect(templateUpgrades.apply).not.toHaveBeenCalled()

    const applied = await run(tool, {
      apply: true,
      keepWorkspace: ['AGENTS.md'],
      useTemplate: [],
      mode: 'summary',
    })
    expect(applied.ok).toBe(true)
    expect(templateUpgrades.apply).toHaveBeenCalledWith('ws-1', {
      planDigest: 'digest-1',
      resolutions: { 'AGENTS.md': 'workspace' },
    })
  })

  it('does not apply while the Workspace is busy', async () => {
    const { tool, templateUpgrades } = setup(plan({
      blocked: true,
      blockers: ['active_sessions'],
      activity: {
        busy: true,
        sessions: [{
          sessionId: 'session-1',
          resumeId: 'resume-1',
          name: 'p1',
          agent: 'pi',
          surface: 'terminal',
          startedAt: 1,
        }],
        headless: [],
      },
    }))
    const result = await run(tool, { apply: true, mode: 'summary' })
    expect(result).toMatchObject({ ok: false, error: { code: 'blocked' } })
    expect(templateUpgrades.apply).not.toHaveBeenCalled()
  })

  it('surfaces changed template contents that forgot to advance the version', async () => {
    const { tool, templateUpgrades } = setup(plan({ fromVersion: '1.6.1', toVersion: '1.6.1' }))
    const result = await run(tool, { apply: true, mode: 'summary' })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'template_version_not_bumped' },
      preview: { status: 'template_version_not_bumped' },
    })
    expect(templateUpgrades.apply).not.toHaveBeenCalled()
  })
})
