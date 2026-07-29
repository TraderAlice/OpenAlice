// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IssueProvenanceRecord } from '../api/issues'
import { IssueActivity } from './IssueDetail'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('IssueActivity provenance identity', () => {
  it('opens a Session from its identity instead of rendering a detached Continue action', async () => {
    const record: IssueProvenanceRecord = {
      id: 'provenance-reconstructed',
      action: 'reconstructed',
      at: Date.now(),
      origin: {
        kind: 'session',
        workspaceId: 'ws-home',
        resumeId: 'resume-open-coral-harbor-j76vuu',
        agent: 'opencode',
      },
    }
    const onOpenSession = vi.fn(async () => {})

    render(
      <IssueActivity
        activity={[{ ...record, kind: 'change' }]}
        onOpenSession={onOpenSession}
        wsId="ws-home"
        issueId="audit"
        ownerResumeId={null}
        assignee="@workspace"
        onPosted={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    fireEvent.click(screen.getByRole('button', {
      name: 'Open conversation with opencode · resume-open-coral-harbor-j76vuu',
    }))

    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining(record)))
  })
})
