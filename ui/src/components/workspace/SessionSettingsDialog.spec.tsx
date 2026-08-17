// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import type { AgentLaunchConfigState } from '../../hooks/useAgentLaunchConfig'
import type { PinnedRuntimeDraft } from '../../hooks/usePinnedRuntimeDraft'
import type { SessionRecord } from './api'
import { SessionSettingsDialog } from './SessionSettingsDialog'

const launchConfig = {
  effectiveAgent: 'claude',
  selectedAgent: { id: 'claude', displayName: 'Claude Code' },
  accessMode: 'vault',
  launchCredentialSlug: 'deepseek-1',
  launchModel: 'deepseek-v4-flash',
  launchReasoningEffort: 'high',
  credentialSelectionReady: true,
  selectRuntimeDefault: vi.fn(),
} as unknown as AgentLaunchConfigState

const editor = {
  config: launchConfig,
  draft: {
    agent: 'claude',
    accessMode: 'vault',
    credentialSlug: 'deepseek-1',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
  },
  initial: {
    agent: 'claude',
    accessMode: 'vault',
    credentialSlug: 'deepseek-1',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
  },
  dirty: false,
  toRuntimeUpdate: () => ({
    credentialSource: 'vault' as const,
    credentialSlug: 'deepseek-1',
    model: launchConfig.launchModel ?? null,
    reasoningEffort: launchConfig.launchReasoningEffort ?? null,
  }),
  capability: () => ({ access: 'DeepSeek API', model: 'deepseek-v4-flash', effort: 'high' }),
  formatCapability: () => 'DeepSeek API · deepseek-v4-flash · high',
} as unknown as PinnedRuntimeDraft

vi.mock('../../hooks/usePinnedRuntimeDraft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/usePinnedRuntimeDraft')>()),
  usePinnedRuntimeDraft: () => editor,
}))

vi.mock('./AgentLaunchControls', () => ({
  AgentLaunchSelectors: () => <div>AI selectors</div>,
}))

function record(patch?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-1',
    resumeId: 'resume-1',
    wsId: 'workspace-1',
    agent: 'claude',
    name: 'c1',
    createdAt: '2026-08-11T00:00:00.000Z',
    lastActiveAt: '2026-08-11T00:01:00.000Z',
    state: 'paused',
    surface: 'terminal',
    pid: null,
    startedAt: null,
    title: 'Paused session',
    displayName: 'AAPL desk',
    runtime: {
      credentialSource: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    },
    ...patch,
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  Object.assign(launchConfig, {
    effectiveAgent: 'claude',
    accessMode: 'vault',
    launchCredentialSlug: 'deepseek-1',
    launchModel: 'deepseek-v4-flash',
    launchReasoningEffort: 'high',
    credentialSelectionReady: true,
  })
})

afterEach(cleanup)

describe('SessionSettingsDialog', () => {
  it('saves the selected credential, model, and effort without resuming', async () => {
    const onOpenChange = vi.fn()
    const onSaveDisplayName = vi.fn(async () => {})
    const onSaveRuntime = vi.fn(async () => {})
    Object.assign(launchConfig, {
      launchModel: 'deepseek-v4-pro',
      launchReasoningEffort: 'xhigh',
    })
    Object.assign(editor, { dirty: true })

    render(<SessionSettingsDialog
      open
      onOpenChange={onOpenChange}
      record={record()}
      agents={[]}
      workspaceId="workspace-1"
      onSaveDisplayName={onSaveDisplayName}
      onSaveRuntime={onSaveRuntime}
    />)

    expect(screen.getByText('AI selectors')).toBeTruthy()
    expect(screen.getByText(/stays paused/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onSaveRuntime).toHaveBeenCalledWith({
      credentialSource: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'xhigh',
    }))
    expect(onSaveDisplayName).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('saves a coworker display name while the Session is still running', async () => {
    const onSaveDisplayName = vi.fn(async () => {})
    const onSaveRuntime = vi.fn(async () => {})
    Object.assign(launchConfig, {
      launchModel: 'deepseek-v4-flash',
      launchReasoningEffort: 'high',
    })
    Object.assign(editor, { dirty: false })

    render(<SessionSettingsDialog
      open
      onOpenChange={vi.fn()}
      record={record({ state: 'running', pid: 42, startedAt: 1 })}
      agents={[]}
      workspaceId="workspace-1"
      onSaveDisplayName={onSaveDisplayName}
      onSaveRuntime={onSaveRuntime}
    />)

    expect(screen.getByText(/Pause this Session before changing/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Earnings desk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onSaveDisplayName).toHaveBeenCalledWith('Earnings desk'))
    expect(onSaveRuntime).not.toHaveBeenCalled()
  })

  it('does not let a normalized read-only AI draft block a running rename', async () => {
    const onSaveDisplayName = vi.fn(async () => {})
    const onSaveRuntime = vi.fn(async () => {})
    Object.assign(launchConfig, {
      accessMode: 'native',
      launchCredentialSlug: null,
      launchModel: null,
      launchReasoningEffort: null,
    })
    Object.assign(editor, { dirty: true })

    render(<SessionSettingsDialog
      open
      onOpenChange={vi.fn()}
      record={record({ state: 'running', pid: 42, startedAt: 1 })}
      agents={[]}
      workspaceId="workspace-1"
      onSaveDisplayName={onSaveDisplayName}
      onSaveRuntime={onSaveRuntime}
    />)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Macro desk' } })
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).not.toHaveProperty('disabled', true)
    fireEvent.click(save)

    await waitFor(() => expect(onSaveDisplayName).toHaveBeenCalledWith('Macro desk'))
    expect(onSaveRuntime).not.toHaveBeenCalled()
  })

  it('hides AI controls for shell Sessions', () => {
    render(<SessionSettingsDialog
      open
      onOpenChange={vi.fn()}
      record={record({ agent: 'shell', runtime: undefined })}
      agents={[]}
      workspaceId="workspace-1"
      onSaveDisplayName={vi.fn(async () => {})}
    />)

    expect(screen.queryByText('AI selectors')).toBeNull()
  })
})
