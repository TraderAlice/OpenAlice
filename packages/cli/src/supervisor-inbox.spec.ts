import { describe, expect, it, vi } from 'vitest'
import {
  createSupervisorInboxState,
  moveSupervisorInboxSelection,
  readSupervisorInbox,
  renderSupervisorInbox,
  selectedSupervisorInboxEntry,
  setSupervisorInboxRead,
  supervisorInboxUnreadCount,
  updateSupervisorInboxEntryRead,
  type SupervisorInboxSnapshot,
} from './supervisor-inbox.ts'

const snapshot: SupervisorInboxSnapshot = {
  endpoint: 'http://127.0.0.1:2026/',
  refreshedAt: Date.UTC(2026, 8, 2, 8, 0),
  hasMore: false,
  entries: [
    {
      id: 'one',
      ts: Date.now(),
      workspaceId: 'ws-one',
      workspaceLabel: 'Macro desk',
      comments: '# Morning brief\nRisk is concentrated in semiconductors.',
      docs: [{ path: 'reports/morning.md', revision: 'abc' }],
      origin: { kind: 'headless', agent: 'codex', issueId: 'daily-brief' },
    },
    {
      id: 'two',
      ts: Date.now() - 3_600_000,
      readAt: Date.now(),
      workspaceId: 'ws-two',
      docs: [{ path: 'notes/follow-up.md' }],
    },
  ],
}

describe('Supervisor Inbox', () => {
  it('reads bounded history from the active HTTP endpoint and sanitizes terminal input', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      entries: [{
        id: 'entry\u001b[31m',
        ts: 123,
        workspaceId: 'ws',
        comments: 'safe\u001b[2J message',
      }],
      hasMore: true,
    }), { status: 200 }))

    const result = await readSupervisorInbox('http://127.0.0.1:2026/app?old=1', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(new URL('http://127.0.0.1:2026/api/inbox/history?limit=50'))
    expect(result.endpoint).toBe('http://127.0.0.1:2026/')
    expect(result.entries[0]).toMatchObject({ id: 'entry[31m', comments: 'safe[2J message' })
    expect(result.hasMore).toBe(true)
  })

  it('uses server-owned read and unread routes without exposing delete', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => new Response(
      init?.method === 'PUT' ? JSON.stringify({ ok: true, id: 'one', readAt: 456 }) : JSON.stringify({ ok: true }),
      { status: 200 },
    ))

    await expect(setSupervisorInboxRead(snapshot.endpoint, 'one', true, fetchImpl)).resolves.toBe(456)
    await expect(setSupervisorInboxRead(snapshot.endpoint, 'one', false, fetchImpl)).resolves.toBeUndefined()
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'DELETE'])
  })

  it('renders a wide unread stream and message inspector', () => {
    const rendered = renderSupervisorInbox(snapshot, createSupervisorInboxState(), 120, 16)
    const frame = rendered.lines.join('\n')

    expect(frame).toContain('Message stream')
    expect(frame).toContain('1 UNREAD')
    expect(frame).toContain('● Morning brief')
    expect(frame).toContain('Message Inspector')
    expect(frame).toContain('Risk is concentrated in semiconductors.')
    expect(frame).toContain('reports/morning.md')
    expect(rendered.targets[0]).toMatchObject({ index: 0, startColumn: 2 })
    expect(rendered.lines.every((line) => line.length <= 120)).toBe(true)
  })

  it('keeps selection, unread state, and compact details coherent', () => {
    const state = moveSupervisorInboxSelection(createSupervisorInboxState(), 1, snapshot)
    const selected = selectedSupervisorInboxEntry(snapshot, state)
    const updated = updateSupervisorInboxEntryRead(snapshot, 'one', 999)
    const frame = renderSupervisorInbox(snapshot, state, 60).lines.join('\n')

    expect(selected?.id).toBe('two')
    expect(supervisorInboxUnreadCount(snapshot)).toBe(1)
    expect(supervisorInboxUnreadCount(updated)).toBe(0)
    expect(frame).toContain('Selected message')
    expect(frame).toContain('notes/follow-up.md')
  })

  it('makes disconnected and empty states explain the next action', () => {
    expect(renderSupervisorInbox(null, createSupervisorInboxState(), 80).lines.join('\n'))
      .toContain('Choose a connection')
    expect(renderSupervisorInbox({ ...snapshot, entries: [] }, createSupervisorInboxState(), 80).lines.join('\n'))
      .toContain('ALL CLEAR')
  })

  it('reports authentication as a recoverable Web UI action', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }))
    await expect(readSupervisorInbox(snapshot.endpoint, fetchImpl))
      .rejects.toThrow('authenticate this target in the Web UI')
  })
})
