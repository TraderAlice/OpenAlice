// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HeadlessTurnProgress } from '../api/headless'
import { i18n } from '../i18n'
import { hasTurnProgress, TurnProgress } from './TurnProgress'

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div>{text}</div>,
}))

function progress(blocks: HeadlessTurnProgress['blocks']): HeadlessTurnProgress {
  return {
    updatedAt: 1,
    assistantText: null,
    blocks,
    metrics: { textBlocks: 0, toolCalls: 0, toolFailures: 0 },
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
})

describe('hasTurnProgress', () => {
  it('is false for missing or empty snapshots', () => {
    expect(hasTurnProgress(undefined)).toBe(false)
    expect(hasTurnProgress(progress([]))).toBe(false)
    expect(hasTurnProgress(progress([{ type: 'text', text: 'Checking the book.' }]))).toBe(true)
  })
})

describe('TurnProgress', () => {
  it('renders interleaved text, tool status, and errors without tool payloads', () => {
    render(
      <TurnProgress
        progress={progress([
          { type: 'text', text: 'Checking the book.' },
          { type: 'tool', id: 't1', name: 'Read', status: 'running' },
          { type: 'error', message: 'The runtime paused.' },
        ])}
      />,
    )

    expect(screen.getByLabelText('Live reply')).toBeTruthy()
    expect(screen.getByText('Checking the book.')).toBeTruthy()
    expect(screen.getByText('Read')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
    expect(screen.getByText('The runtime paused.')).toBeTruthy()
    expect(screen.queryByText(/input/i)).toBeNull()
  })

  it('renders nothing when the snapshot has no blocks', () => {
    const { container } = render(<TurnProgress progress={progress([])} />)
    expect(container.textContent).toBe('')
  })
})
