// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { readWorkspaceFile } from '../components/workspace/api'
import { InboxAttachment } from './InboxPage'

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return { ...actual, readWorkspaceFile: vi.fn() }
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(readWorkspaceFile).mockResolvedValue({
    kind: 'ok',
    content: '<!doctype html><html><body><h1>Close report</h1></body></html>',
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InboxAttachment', () => {
  it('keeps the collapsed state asset-like instead of leaking raw file content', async () => {
    render(
      <InboxAttachment
        workspaceId="ws-1"
        doc={{ path: 'research/close-report.html', revision: 'sha256:1234567890' }}
        defaultExpanded={false}
      />,
    )

    expect(await screen.findByText('HTML report')).toBeTruthy()
    expect(screen.getByText('close-report.html')).toBeTruthy()
    expect(screen.getByText('research')).toBeTruthy()
    expect(screen.queryByText(/doctype html/i)).toBeNull()
    expect(screen.queryByText(/sent 12345678/i)).toBeNull()
  })

  it('reveals the real viewer only after the attachment is opened', async () => {
    render(
      <InboxAttachment
        workspaceId="ws-1"
        doc={{ path: 'research/close-report.html' }}
        defaultExpanded={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview attachment close-report.html' }))

    expect(await screen.findByTitle('HTML report: research/close-report.html')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse attachment close-report.html' })).toBeTruthy()
  })
})
