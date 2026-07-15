// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InquiryRecord } from '../api/inquiries'
import { i18n } from '../i18n'
import { InboxReplyThread } from './InboxReplyThread'

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div>{text}</div>,
}))

function record(overrides: Partial<InquiryRecord> = {}): InquiryRecord {
  return {
    taskId: 'ask_123',
    resumeId: 'resume-calm-blue-harbor-a1b2c3',
    workspaceId: 'chat-market-desk',
    agent: 'pi',
    status: 'done',
    startedAt: Date.now() - 60_000,
    finishedAt: Date.now(),
    assistantText: 'The sender used the latest close data.',
    inquiry: {
      subject: { kind: 'inbox', entryId: 'inbox_123' },
      question: 'Why did you send this update?',
      resolution: { mode: 'exact' },
    },
    ...overrides,
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('InboxReplyThread', () => {
  it('keeps replying separate from opening the original conversation', async () => {
    const load = vi.fn().mockResolvedValue([])
    const ask = vi.fn().mockResolvedValue({ status: 'dispatched' })

    render(
      <InboxReplyThread sender="pi" hasExactSender load={load} ask={ask} />,
    )

    expect(await screen.findByRole('heading', { name: 'Replies' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open conversation' })).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'Reply to this update…' }), {
      target: { value: 'Which data did you use?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    await waitFor(() => expect(ask).toHaveBeenCalledWith('Which data did you use?'))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })

  it('renders completed and running replies as one chronological thread', async () => {
    const load = vi.fn().mockResolvedValue([
      record({
        taskId: 'ask_running',
        status: 'running',
        startedAt: Date.now(),
        assistantText: null,
        inquiry: {
          subject: { kind: 'inbox', entryId: 'inbox_123' },
          question: 'Can you verify it once more?',
          resolution: { mode: 'exact' },
        },
      }),
      record({
        taskId: 'ask_reconstructed',
        inquiry: {
          subject: { kind: 'inbox', entryId: 'inbox_123' },
          question: 'Why did you send this update?',
          resolution: { mode: 'reconstructed', reason: 'Original runtime session unavailable.' },
        },
      }),
    ])

    render(
      <InboxReplyThread sender="Market desk" hasExactSender={false} load={load} ask={vi.fn()} />,
    )

    expect(await screen.findByText('The sender used the latest close data.')).toBeTruthy()
    expect(screen.getByText('Reconstructed')).toBeTruthy()
    expect(screen.getByText('Can you verify it once more?')).toBeTruthy()
    expect(screen.getByText('Working on a reply…')).toBeTruthy()
  })
})
