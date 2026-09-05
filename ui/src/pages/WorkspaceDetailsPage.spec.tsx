// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { WorkspaceDetailsPage } from './WorkspaceDetailsPage'
import type { useWorkspaceDetails } from '../hooks/useWorkspaceDetails'

const mocks = vi.hoisted(() => ({ details: {} as ReturnType<typeof useWorkspaceDetails>, openOrFocus: vi.fn() }))
vi.mock('../hooks/useWorkspaceDetails', () => ({ useWorkspaceDetails: () => mocks.details }))
vi.mock('../tabs/store', () => ({ useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) => selector(mocks) }))
vi.mock('../components/FileContentView', () => ({ FileContentView: ({ result }: { result: { content?: string } }) => <article>{result.content}</article> }))
vi.mock('../components/MarkdownContent', () => ({ MarkdownContent: ({ text }: { text: string }) => <article>{text}</article> }))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  mocks.details = {
    workspace: { id: 'one', tag: 'desk', template: 'chat', dir: '/tmp/desk', createdAt: '2026-09-05', sessions: [], currentVersion: '1.0' },
    template: { name: 'chat', version: '9.0', defaultAgents: [], hasReadme: true },
    sessionCount: 2, loading: false, error: null,
    refresh: vi.fn(async () => {}), retryDocuments: vi.fn(),
    readme: { kind: 'ok', content: 'My customized workspace' },
    guide: { name: 'chat', content: 'Current catalog guide', error: null },
  }
})
afterEach(cleanup)

describe('WorkspaceDetailsPage', () => {
  it('shows instance content first, with a separate catalog guide and its own version', () => {
    render(<WorkspaceDetailsPage spec={{ kind: 'workspace-details', params: { wsId: 'one', source: 'chat' } }} />)
    expect(screen.getByRole('heading', { name: 'desk' })).toBeTruthy()
    expect(screen.getByText('v1.0')).toBeTruthy()
    expect(screen.getByText('My customized workspace')).toBeTruthy()
    expect(screen.queryByText('Current catalog guide')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Harness guide' }))
    expect(screen.getByText('Current catalog guide')).toBeTruthy()
    expect(screen.getByText(/v9.0/)).toBeTruthy()
    expect(screen.queryByText('My customized workspace')).toBeNull()
  })

  it('shows an honest empty README state and keeps guide failures retryable', () => {
    mocks.details.readme = { kind: 'file_missing' }
    mocks.details.guide = { name: 'chat', content: null, error: 'Guide unavailable' }
    render(<WorkspaceDetailsPage spec={{ kind: 'workspace-details', params: { wsId: 'one', source: 'chat' } }} />)
    expect(screen.getByText(/There is no README.md/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Harness guide' }))
    expect(screen.getByRole('alert').textContent).toContain('Guide unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.details.retryDocuments).toHaveBeenCalledOnce()
  })

  it('refreshes metadata and documentation without opening configuration', () => {
    render(<WorkspaceDetailsPage spec={{ kind: 'workspace-details', params: { wsId: 'one', source: 'chat' } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(mocks.details.refresh).toHaveBeenCalledOnce()
    expect(mocks.details.retryDocuments).toHaveBeenCalledOnce()
    expect(mocks.openOrFocus).not.toHaveBeenCalled()
  })

  it.each([
    ['chat', 'chat-landing'], ['auto-quant', 'auto-quant-landing'], ['prediction', 'auto-prediction-landing'],
  ] as const)('returns to the same Workspace in %s', (source, kind) => {
    render(<WorkspaceDetailsPage spec={{ kind: 'workspace-details', params: { wsId: 'one', source } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversations' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind, params: { targetWsId: 'one' } })
  })
})
