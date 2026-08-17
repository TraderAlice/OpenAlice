// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { IssuePendingReply } from './IssueDetail'

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div>{text}</div>,
}))

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
})

describe('IssuePendingReply', () => {
  it('keeps the waiting line and shows live progress when the sidecar has blocks', () => {
    render(
      <IssuePendingReply
        targetResumeId="resume-owner"
        progress={{
          updatedAt: 1,
          assistantText: 'Checking the book.',
          blocks: [
            { type: 'text', text: 'Checking the book.' },
            { type: 'tool', id: 't1', name: 'Read', status: 'running' },
          ],
          metrics: { textBlocks: 1, toolCalls: 1, toolFailures: 0 },
        }}
      />,
    )

    expect(screen.getByText('@resume-owner')).toBeTruthy()
    expect(screen.getByText(/Waiting for/)).toBeTruthy()
    expect(screen.getByText('Checking the book.')).toBeTruthy()
    expect(screen.getByText('Read')).toBeTruthy()
  })

  it('stays a waiting line when progress has not arrived yet', () => {
    render(<IssuePendingReply targetResumeId="resume-owner" />)
    expect(screen.getByText('@resume-owner')).toBeTruthy()
    expect(screen.queryByLabelText('Live reply')).toBeNull()
  })
})
