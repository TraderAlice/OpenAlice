// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IssueSettingsPage } from './IssueSettingsPage'

const mocks = vi.hoisted(() => ({
  setIssueDefaultAgent: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    agents: [
      { id: 'claude', displayName: 'Claude Code', kind: 'agent', installed: true },
      { id: 'opencode', displayName: 'opencode', kind: 'agent', installed: true },
      { id: 'shell', displayName: 'Shell', kind: 'utility', installed: true },
    ],
    defaultAgent: 'opencode',
    issueDefaultAgent: null,
    setIssueDefaultAgent: mocks.setIssueDefaultAgent,
  }),
}))

afterEach(() => {
  vi.clearAllMocks()
  cleanup()
})

describe('IssueSettingsPage', () => {
  it('associates the runtime picker with its visible label and fallback explanation', () => {
    render(<IssueSettingsPage />)

    const select = screen.getByRole('combobox', { name: 'Agent runtime' })
    const descriptionId = select.getAttribute('aria-describedby')
    const description = descriptionId ? document.getElementById(descriptionId) : null

    expect(select.id).not.toBe('')
    expect(document.querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Agent runtime')
    expect(description?.textContent).toContain("each target Workspace's Session default")
    expect(description?.textContent).toContain('Alice fallback (opencode)')
    expect(screen.queryByRole('option', { name: 'Shell' })).toBeNull()
  })
})
