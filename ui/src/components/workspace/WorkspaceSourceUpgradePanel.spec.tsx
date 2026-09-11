// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import { WorkspaceSourceUpgradePanel } from './WorkspaceSourceUpgradePanel'
import * as api from './api'

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  getHarnessSourceUpgradePlan: vi.fn(),
  applyHarnessSourceUpgrade: vi.fn(),
}))

const plan = {
  workspaceId: 'aq-1',
  template: 'auto-quant-v2',
  fromVersion: 'v0.9.34',
  fromCommit: 'a'.repeat(40),
  toVersion: 'v0.9.35',
  toCommit: 'b'.repeat(40),
  verified: false,
  strategy: 'source-merge' as const,
  protocolCompatible: true,
  manifestVersion: 1,
  planDigest: 'digest-1',
  blocked: false,
  blockers: [],
  activity: { busy: false, sessions: [], headless: [] },
  changedPaths: ['harness.json', 'studio/server.ts'],
  conflictedPaths: [],
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(api.getHarnessSourceUpgradePlan).mockResolvedValue(plan)
  vi.mocked(api.applyHarnessSourceUpgrade).mockResolvedValue({
    workspaceId: 'aq-1',
    fromVersion: 'v0.9.34',
    toVersion: 'v0.9.35',
    commit: 'c'.repeat(40),
    verified: false,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspaceSourceUpgradePanel', () => {
  it('labels an upstream-only release and requires the explicit unverified action', async () => {
    const changed = vi.fn()
    render(<WorkspaceSourceUpgradePanel wsId="aq-1" onWorkspaceChanged={changed} />)
    expect(await screen.findByText('Not verified by OpenAlice')).toBeTruthy()
    expect(screen.getByText('studio/server.ts')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'I understand — apply unverified upgrade' }))
    await waitFor(() => expect(api.applyHarnessSourceUpgrade).toHaveBeenCalledWith(
      'aq-1', 'digest-1', 'v0.9.35',
    ))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  })

  it('keeps apply disabled while the Workspace has source merge blockers', async () => {
    vi.mocked(api.getHarnessSourceUpgradePlan).mockResolvedValue({
      ...plan,
      blocked: true,
      blockers: ['working_tree_changes'],
    })
    render(<WorkspaceSourceUpgradePanel wsId="aq-1" onWorkspaceChanged={vi.fn()} />)
    expect(await screen.findByText('Commit or discard working-tree changes first.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'I understand — apply unverified upgrade' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
