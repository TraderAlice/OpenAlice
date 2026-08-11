// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
