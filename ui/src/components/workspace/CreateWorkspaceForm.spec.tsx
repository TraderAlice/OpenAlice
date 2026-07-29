// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CreateWorkspaceForm } from './CreateWorkspaceForm'

const mocks = vi.hoisted(() => ({
  setTag: vi.fn(),
  submit: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({ workspaces: [] }),
}))

vi.mock('../../hooks/useCreateWorkspace', () => ({
  TAG_HINT: 'tag hint',
  defaultTagFor: () => 'chat-jul29',
  useCreateWorkspace: () => ({
    tag: 'chat-jul29',
    setTag: mocks.setTag,
    creating: false,
    error: 'Workspace bootstrap failed',
    submit: mocks.submit,
  }),
}))

afterEach(cleanup)

describe('CreateWorkspaceForm error feedback', () => {
  it('exposes creation failures as an immediate alert', () => {
    render(
      <CreateWorkspaceForm
        templates={[{
          name: 'chat',
          displayName: 'Chat',
          defaultAgents: ['codex'],
          version: '0.2.0',
          hasReadme: true,
        }]}
        onCreated={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toBe('Workspace bootstrap failed')
  })
})
