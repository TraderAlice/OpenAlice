// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LogsPage } from './LogsPage'

const mocks = vi.hoisted(() => ({
  conversationQuery: vi.fn(),
  toolQuery: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    agentConversations: { query: mocks.conversationQuery },
    agentStatus: { query: mocks.toolQuery },
  },
}))

const ordinary = {
  taskId: 'run-plain',
  dispatchedAt: 100,
  completedAt: 120,
  status: 'done',
  source: {
    kind: 'session',
    workspaceId: 'chat-desk',
    resumeId: 'resume-chat',
    agent: 'codex',
  },
  target: {
    workspaceId: 'quant-desk',
    resumeId: 'resume-quant',
    agent: 'codex',
  },
  requestedTarget: { kind: 'workspace', workspaceId: 'quant-desk' },
  resolution: { mode: 'reconstructed', reason: 'explicit-workspace' },
  prompt: {
    original: 'Run an ordinary research task.',
    delivered: 'Run an ordinary research task.',
    mode: 'plain',
  },
  assistantText: 'Research complete.',
  durationMs: 20,
} as const

const reconstructed = {
  ...ordinary,
  taskId: 'run-reconstructed',
  dispatchedAt: 200,
  prompt: {
    original: 'Why was this artifact created?',
    delivered: 'You are a reconstruction analyst.\n\nWhy was this artifact created?',
    mode: 'reconstruction',
  },
  assistantText: 'This is a reconstructed explanation.',
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.conversationQuery.mockResolvedValue({
    entries: [reconstructed, ordinary],
    total: 2,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  })
  mocks.toolQuery.mockResolvedValue({
    entries: [],
    total: 0,
    page: 1,
    pageSize: 100,
    totalPages: 1,
  })
})

afterEach(cleanup)

describe('LogsPage Agent conversations', () => {
  it('shows joined routing and keeps provenance separate from prompt injection', async () => {
    render(<LogsPage />)

    expect(await screen.findByText(/2 conversations/)).toBeTruthy()
    expect(screen.getAllByText('Reconstructed provenance')).toHaveLength(2)
    expect(screen.getByText('Guidance injected')).toBeTruthy()
    expect(screen.getAllByText('chat-desk · codex')).toHaveLength(2)
    expect(screen.getAllByText('quant-desk · codex')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /Run an ordinary research task/ }))

    expect(screen.getByText('Original prompt')).toBeTruthy()
    expect(screen.getByText('Research complete.')).toBeTruthy()
    expect(screen.queryByText('Delivered prompt · reconstruction guidance applied')).toBeNull()
  })

  it('shows original and delivered prompts only for explicit reconstruction', async () => {
    render(<LogsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Why was this artifact created/ }))

    expect(screen.getByText('Delivered prompt · reconstruction guidance applied')).toBeTruthy()
    expect(screen.getByText(/You are a reconstruction analyst/)).toBeTruthy()
    expect(screen.getByText('This is a reconstructed explanation.')).toBeTruthy()
    expect(screen.getByText('run-reconstructed')).toBeTruthy()
  })

  it('shows Harness-default addressing in the routing detail', async () => {
    mocks.conversationQuery.mockResolvedValue({
      entries: [{ ...ordinary, requestedTarget: { kind: 'harness', harness: 'autoquant' } }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })
    render(<LogsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Run an ordinary research task/ }))
    expect(screen.getByText('Harness autoquant')).toBeTruthy()
  })

  it('can switch back to the existing tool-call log', async () => {
    render(<LogsPage />)
    await screen.findByText(/2 conversations/)

    fireEvent.click(screen.getByRole('button', { name: 'Tool calls' }))

    await waitFor(() => expect(mocks.toolQuery).toHaveBeenCalledWith({
      page: 1,
      pageSize: 100,
      name: undefined,
    }))
    expect(screen.getByText('No tool calls yet')).toBeTruthy()
  })

  it('distinguishes an unavailable tool-call log from an empty log', async () => {
    mocks.toolQuery.mockRejectedValueOnce(new Error('offline'))
    render(<LogsPage />)
    await screen.findByText(/2 conversations/)

    fireEvent.click(screen.getByRole('button', { name: 'Tool calls' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load tool calls')
    expect(screen.getByText('Tool calls unavailable')).toBeTruthy()
    expect(screen.queryByText('No tool calls yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.toolQuery).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No tool calls yet')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers a retry when the read-only projection is unavailable', async () => {
    mocks.conversationQuery.mockRejectedValueOnce(new Error('offline'))
    render(<LogsPage />)

    expect(await screen.findByText('Could not load Agent conversations')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.conversationQuery).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/2 conversations/)).toBeTruthy()
  })

  it('requests older pages without turning off the read-only view', async () => {
    mocks.conversationQuery.mockResolvedValue({
      entries: [ordinary],
      total: 51,
      page: 1,
      pageSize: 50,
      totalPages: 2,
    })
    render(<LogsPage />)
    await screen.findByText(/51 conversations/)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(mocks.conversationQuery).toHaveBeenCalledWith({
      page: 2,
      pageSize: 50,
    }))
  })
})
