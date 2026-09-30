// @vitest-environment jsdom
import { setLaunchPreview, getLaunchPreview } from '../conversation/launch-preview'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcriptHasTrailingUser, useWebConversation } from './useWebConversation'
import { clearWebSessionCache, writeWebSessionCache } from './web-session-cache'
import type { WebSessionSnapshot } from './api'

const api = vi.hoisted(() => ({
  getWebSession: vi.fn(),
  openWebSession: vi.fn(),
  promptWebSession: vi.fn(),
  abortWebSession: vi.fn(),
  respondWebSession: vi.fn(),
}))
vi.mock('./api', () => ({ ...api }))

afterEach(() => { cleanup(); clearWebSessionCache(); vi.resetAllMocks() })

const snapshot = (
  revision: number,
  phase: WebSessionSnapshot['phase'] = 'idle',
  overrides: Partial<WebSessionSnapshot> = {},
): WebSessionSnapshot => ({
  recordId: 'session',
  wsId: 'workspace',
  resumeId: 'resume',
  agent: 'cursor',
  wire: 'acp',
  nativeSessionId: 'native',
  pid: 1,
  startedAt: 1,
  phase,
  messages: [],
  historyHiddenCount: 0,
  streamingMessage: null,
  requests: [],
  error: null,
  stderrTail: '',
  revision,
  ...overrides,
}) as WebSessionSnapshot

describe('transcriptHasTrailingUser', () => {
  it('matches the latest user text', () => {
    expect(transcriptHasTrailingUser([
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: '能否推送到inbox' },
    ], '能否推送到inbox')).toBe(true)
    expect(transcriptHasTrailingUser([
      { role: 'user', content: 'old' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ], '能否推送到inbox')).toBe(false)
  })
})

describe('Web Session restart', () => {
  it('bridges the launch prompt until the first authoritative snapshot without duplicating it', async () => {
    let resolve!: (value: WebSessionSnapshot) => void
    api.getWebSession.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    setLaunchPreview('workspace', 'session', 'Hello')
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    expect(result.current.items).toEqual([{ kind: 'user', key: 'launch-preview', content: [{ kind: 'markdown', text: 'Hello' }] }])
    expect(getLaunchPreview('workspace', 'other')).toBeNull()
    await act(async () => resolve(snapshot(1)))
    expect(result.current.items).toEqual([])
    expect(getLaunchPreview('workspace', 'session')).toBeNull()
  })
  it('accepts a new process revision and ignores an old in-flight poll', async () => {
    api.getWebSession.mockResolvedValue(snapshot(50))
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    await waitFor(() => expect(result.current.snapshot?.revision).toBe(50))
    let resolveOld!: (value: WebSessionSnapshot) => void
    api.getWebSession.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    let poll!: Promise<void>
    act(() => { poll = result.current.refresh() })
    api.openWebSession.mockResolvedValue(snapshot(1))
    await act(async () => { await result.current.reconfigure({ credentialSource: 'native', model: 'model', reasoningEffort: 'high' }) })
    expect(api.openWebSession).toHaveBeenCalledWith('workspace', 'session', { credentialSource: 'native', model: 'model', reasoningEffort: 'high' })
    await act(async () => { resolveOld(snapshot(51)); await poll })
    expect(result.current.snapshot?.revision).toBe(1)
    expect(result.current.reconfiguring).toBe(false)
  })
  it('keeps the last transcript when restart fails and refuses changes during a turn', async () => {
    api.getWebSession.mockResolvedValue(snapshot(8))
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    await waitFor(() => expect(result.current.snapshot?.revision).toBe(8))
    api.openWebSession.mockRejectedValue(new Error('invalid credential'))
    await act(async () => { await expect(result.current.reconfigure({ credentialSource: 'native' })).rejects.toThrow('invalid credential') })
    expect(result.current.snapshot?.revision).toBe(8)
    expect(result.current.reconfiguring).toBe(false)
    api.getWebSession.mockResolvedValue(snapshot(9, 'working'))
    await act(async () => { await result.current.refresh() })
    await expect(result.current.reconfigure({ credentialSource: 'native' })).rejects.toThrow('Wait for the current response')
    expect(api.openWebSession).toHaveBeenCalledTimes(1)
  })
  it('hydrates immediately from the in-memory snapshot cache on remount', async () => {
    writeWebSessionCache('workspace', 'session', snapshot(12))
    api.getWebSession.mockResolvedValue(null)
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    expect(result.current.snapshot?.revision).toBe(12)
    await waitFor(() => expect(api.getWebSession).toHaveBeenCalled())
  })
})

describe('Web Session prompt delivery', () => {
  it('shows an optimistic user bubble while prompt is in flight', async () => {
    api.getWebSession.mockResolvedValue(snapshot(3, 'idle', {
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
    }))
    let resolvePrompt!: (value: WebSessionSnapshot) => void
    api.promptWebSession.mockImplementationOnce(() => new Promise(done => { resolvePrompt = done }))
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    await waitFor(() => expect(result.current.snapshot?.revision).toBe(3))

    let send!: Promise<void>
    act(() => { send = result.current.send('能否推送到inbox') })
    await waitFor(() => {
      expect(result.current.items.some((item) => item.kind === 'user' && item.key === 'optimistic-user')).toBe(true)
      expect(result.current.busy).toBe(true)
    })

    await act(async () => {
      resolvePrompt(snapshot(4, 'working', {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          { role: 'user', content: '能否推送到inbox' },
        ],
      }))
      await send
    })
    expect(result.current.snapshot?.revision).toBe(4)
    expect(result.current.items.some((item) => item.key === 'optimistic-user')).toBe(false)
    expect(result.current.items.some((item) => item.kind === 'user')).toBe(true)
    expect(result.current.busy).toBe(true)
  })

  it('still applies a prompt snapshot even when a poll raced to a higher revision', async () => {
    api.getWebSession.mockResolvedValue(snapshot(10, 'idle'))
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    await waitFor(() => expect(result.current.snapshot?.revision).toBe(10))

    // Simulate a poll that landed a higher revision without the new user turn.
    act(() => {
      result.current.refresh()
    })
    api.getWebSession.mockResolvedValueOnce(snapshot(12, 'idle', {
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'stale' }] }],
    }))
    await act(async () => { await result.current.refresh() })
    expect(result.current.snapshot?.revision).toBe(12)

    api.promptWebSession.mockResolvedValueOnce(snapshot(11, 'working', {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'stale' }] },
        { role: 'user', content: '能否推送到inbox' },
      ],
    }))
    await act(async () => { await result.current.send('能否推送到inbox') })
    expect(result.current.snapshot?.revision).toBe(11)
    expect(result.current.snapshot?.messages.at(-1)).toEqual({ role: 'user', content: '能否推送到inbox' })
  })

  it('refuses reconfigure while a prompt is in flight', async () => {
    api.getWebSession.mockResolvedValue(snapshot(2, 'idle'))
    let resolvePrompt!: (value: WebSessionSnapshot) => void
    api.promptWebSession.mockImplementationOnce(() => new Promise(done => { resolvePrompt = done }))
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    await waitFor(() => expect(result.current.snapshot?.revision).toBe(2))

    let send!: Promise<void>
    act(() => { send = result.current.send('hello') })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await expect(result.current.reconfigure({ credentialSource: 'native' })).rejects.toThrow('Wait for the current response')
    await act(async () => {
      resolvePrompt(snapshot(3, 'working', { messages: [{ role: 'user', content: 'hello' }] }))
      await send
    })
  })
})
