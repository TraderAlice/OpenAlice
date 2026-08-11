// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentLaunchConfigState } from '../../hooks/useAgentLaunchConfig'
import type { SessionRecord } from './api'
import { SessionRuntimeEditorDialog } from './SessionRuntimeEditorDialog'

const launchConfig = {
  effectiveAgent: 'claude',
  accessMode: 'vault',
  launchCredentialSlug: 'deepseek-1',
  launchModel: 'deepseek-v4-flash',
  launchReasoningEffort: 'high',
  credentialSelectionReady: true,
  selectRuntimeDefault: vi.fn(),
} as unknown as AgentLaunchConfigState

vi.mock('../../hooks/useAgentLaunchConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useAgentLaunchConfig')>()),
  useAgentLaunchConfig: () => launchConfig,
}))

vi.mock('./AgentLaunchControls', () => ({
  AgentLaunchSelectors: () => <div>AI selectors</div>,
}))

const record: SessionRecord = {
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
  runtime: {
    credentialSource: 'vault',
    credentialSlug: 'deepseek-1',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
  },
}

afterEach(cleanup)

describe('SessionRuntimeEditorDialog', () => {
  it('saves the selected credential, model, and effort without resuming', async () => {
    const onOpenChange = vi.fn()
    const onSave = vi.fn(async () => {})

    render(<SessionRuntimeEditorDialog
      open
      onOpenChange={onOpenChange}
      record={record}
      agents={[]}
      workspaceId="workspace-1"
      onSave={onSave}
    />)

    expect(screen.getByText('AI selectors')).toBeTruthy()
    expect(screen.getByText(/stays paused/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      credentialSource: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
