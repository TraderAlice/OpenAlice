// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TemplateDetailPage } from './TemplateDetailPage'

const mocks = vi.hoisted(() => ({
  fetchTemplateReadme: vi.fn(),
  openOrFocus: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key === 'common.retry' ? 'Retry' : key,
  }),
}))

vi.mock('../components/workspace/api', () => ({
  fetchTemplateReadme: mocks.fetchTemplateReadme,
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    templates: [{
      name: 'chat',
      displayName: 'Chat',
      description: 'General-purpose workspace',
      defaultAgents: ['codex'],
      version: '0.2.0',
      hasReadme: true,
    }],
    agents: [],
    refresh: mocks.refresh,
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) => selector({
    openOrFocus: mocks.openOrFocus,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('TemplateDetailPage README recovery', () => {
  it('retries a failed README request without reloading the application', async () => {
    mocks.fetchTemplateReadme
      .mockRejectedValueOnce(new Error('README temporarily unavailable'))
      .mockResolvedValueOnce('# Chat\n\nRecovered instructions')

    render(<TemplateDetailPage spec={{ kind: 'template-detail', params: { name: 'chat' } }} />)

    expect((await screen.findByRole('alert')).textContent).toContain('README temporarily unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('Recovered instructions')
    await waitFor(() => expect(mocks.fetchTemplateReadme).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
