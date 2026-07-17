import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import {
  applyTemplateUpgrade,
  getTemplateUpgradePlan,
  type TemplateUpgradePlan,
} from './api'
import { WorkspaceTemplateUpgradePanel } from './WorkspaceTemplateUpgradePanel'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getTemplateUpgradePlan: vi.fn(),
  applyTemplateUpgrade: vi.fn(),
}))

const plan: TemplateUpgradePlan = {
  workspaceId: 'chat-old',
  template: 'chat',
  fromVersion: '1.2.0',
  toVersion: '1.6.1',
  strategy: 'managed-context',
  planDigest: 'preview-1',
  source: 'legacy-root-commit',
  blocked: false,
  blockers: [],
  activity: { busy: false, sessions: [], headless: [] },
  files: [
    {
      path: 'README.md',
      status: 'ready',
      operation: 'update',
      currentPreview: 'old readme',
      templatePreview: 'new readme',
      currentTruncated: false,
      templateTruncated: false,
      canUseTemplate: true,
    },
    {
      path: 'AGENTS.md',
      status: 'preserved',
      operation: 'keep',
      currentPreview: 'local instructions',
      templatePreview: 'old template instructions',
      currentTruncated: false,
      templateTruncated: false,
      canUseTemplate: true,
    },
    {
      path: '.agents/skills/self-scheduling/SKILL.md',
      status: 'conflict',
      operation: 'update',
      currentPreview: 'local scheduling',
      templatePreview: 'template scheduling',
      currentTruncated: false,
      templateTruncated: false,
      canUseTemplate: true,
      note: 'Both sides changed.',
    },
  ],
  summary: { ready: 1, preserved: 1, conflicts: 1, unchanged: 0 },
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(getTemplateUpgradePlan).mockResolvedValue(plan)
  vi.mocked(applyTemplateUpgrade).mockResolvedValue({
    workspaceId: plan.workspaceId,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    commit: 'abc12345deadbeef',
    changedPaths: ['README.md'],
    keptPaths: ['AGENTS.md'],
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspaceTemplateUpgradePanel', () => {
  it('separates safe updates, protected customizations, and explicit conflict choices', async () => {
    render(<WorkspaceTemplateUpgradePanel wsId="chat-old" onWorkspaceChanged={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Ready to update')).toBeTruthy()
    expect(screen.getByText('Your customizations stay')).toBeTruthy()
    expect(screen.getByText('Needs your choice')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply and commit' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Compare copies' }))
    expect(screen.getByText('local scheduling')).toBeTruthy()
    expect(screen.getByText('template scheduling')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Keep workspace' }))
    expect((screen.getByRole('button', { name: 'Apply and commit' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('applies the reviewed digest and refreshes to the recorded current baseline', async () => {
    const onWorkspaceChanged = vi.fn()
    vi.mocked(getTemplateUpgradePlan)
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce({
        ...plan,
        fromVersion: plan.toVersion,
        source: 'recorded-baseline',
        files: [],
        summary: { ready: 0, preserved: 0, conflicts: 0, unchanged: 0 },
      })
    render(<WorkspaceTemplateUpgradePanel wsId="chat-old" onWorkspaceChanged={onWorkspaceChanged} onClose={vi.fn()} />)

    await screen.findByText('Needs your choice')
    fireEvent.click(screen.getByRole('radio', { name: 'Use template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply and commit' }))

    await waitFor(() => expect(applyTemplateUpgrade).toHaveBeenCalledWith(
      'chat-old',
      'preview-1',
      { '.agents/skills/self-scheduling/SKILL.md': 'template' },
    ))
    await waitFor(() => expect(screen.getByText('Template upgrade complete')).toBeTruthy())
    expect(screen.getByText('Latest version')).toBeTruthy()
    expect(screen.getAllByText(`v${plan.toVersion}`)).toHaveLength(1)
    expect(onWorkspaceChanged).toHaveBeenCalled()
  })

  it('explains why applying is blocked while a Workspace is active', async () => {
    vi.mocked(getTemplateUpgradePlan).mockResolvedValue({
      ...plan,
      blocked: true,
      blockers: ['active_sessions'],
      activity: {
        busy: true,
        sessions: [{
          sessionId: 'pi-live',
          resumeId: 'resume-live',
          name: 'p1',
          agent: 'pi',
          surface: 'webpi',
          startedAt: Date.now(),
        }],
        headless: [],
      },
    })
    render(<WorkspaceTemplateUpgradePanel wsId="chat-old" onWorkspaceChanged={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Prepare this Workspace before applying')).toBeTruthy()
    expect(screen.getByText(/p1.*pi.*WebPi/i)).toBeTruthy()
  })
})
