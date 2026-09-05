// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionRecord } from './api'
import { ResumeCta } from './ResumeCta'

function record(runtime?: SessionRecord['runtime']): SessionRecord {
  return {
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
    ...(runtime ? { runtime } : {}),
  }
}

afterEach(cleanup)

describe('ResumeCta runtime facts', () => {
  it('preserves a long title and all Pi actions without starting the session on mount', async () => {
    const title = 'Research the complete cross-market impact of a changing policy regime across multiple portfolios'
    const onResume = vi.fn(async () => {})
    const onOpenWebPi = vi.fn(async () => { throw new Error('Surface unavailable') })
    render(<ResumeCta
      record={{ ...record(), agent: 'pi', title }}
      workspaceId="workspace-1"
      onSaveDisplayName={vi.fn(async () => {})}
      onResume={onResume}
      onOpenWebPi={onOpenWebPi}
    />)

    expect(screen.getByRole('heading', { name: title }).textContent).toBe(title)
    expect(screen.getByRole('button', { name: 'Resume in TUI' })).toBeTruthy()
    expect(document.querySelector('.resume-cta-actions')?.querySelectorAll('button')).toHaveLength(3)
    expect(onResume).not.toHaveBeenCalled()
    expect(onOpenWebPi).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open in WebPi' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Surface unavailable')
    expect(onResume).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Resume in TUI' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the persisted Vault binding', () => {
    render(<ResumeCta
      record={record({
        credentialSource: 'vault',
        credentialSlug: 'deepseek-1',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
      })}
      onResume={vi.fn(async () => {})}
    />)

    expect(screen.getByText('deepseek-1')).toBeTruthy()
    expect(screen.getByText('deepseek-v4-flash')).toBeTruthy()
    expect(screen.getByText('high reasoning')).toBeTruthy()
    expect(document.querySelector('[data-agent-runtime-icon="claude"]')).toBeTruthy()
  })

  it('shows an explicit model with omitted effort as not specified', () => {
    render(<ResumeCta
      record={record({
        credentialSource: 'vault',
        credentialSlug: 'minimax-1',
        model: 'MiniMax-M3',
      })}
      onResume={vi.fn(async () => {})}
    />)

    expect(screen.getByText('MiniMax-M3')).toBeTruthy()
    expect(screen.getByText('Not specified')).toBeTruthy()
    expect(screen.queryByText('Runtime default')).toBeNull()
  })

  it('does not mislabel missing historical metadata as Runtime defaults', () => {
    render(<ResumeCta
      record={record()}
      onResume={vi.fn(async () => {})}
    />)

    expect(screen.getAllByText('Unknown')).toHaveLength(3)
  })
})
