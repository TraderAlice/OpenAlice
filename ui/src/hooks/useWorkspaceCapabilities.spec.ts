// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadWorkspaceCapabilities,
  useWorkspaceCapabilities,
  useWorkspaceCli,
} from './useWorkspaceCapabilities'
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  json: vi.fn(),
}))
vi.mock('../components/workspace/api', () => ({
  listFiles: mocks.list,
  readWorkspaceFile: mocks.read,
}))
vi.mock('../api/client', () => ({ fetchJson: mocks.json }))
beforeEach(() => { mocks.json.mockResolvedValue({ managedSkillNames: ['same', 'alice-workspace'] }) })
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const listing = (...names: string[]) => ({
  entries: names.map((name) => ({ name, kind: 'dir' })),
})
describe('Workspace capability inventory', () => {
  it('groups by skill identity with the agents source even when mirrors diverge', async () => {
    mocks.list.mockImplementation(async (_id, path) =>
      path === ''
        ? listing('.agents', '.claude', '.pi')
        : path === '.pi'
          ? Promise.reject(new Error('unreachable'))
          : path.endsWith('/skills')
            ? listing('same', 'changed')
            : listing('skills'),
    )
    mocks.read.mockImplementation(async (_id, path: string) => ({
      kind: 'ok',
      content: path.includes('/same/')
        ? '---\ndescription: >\n  A folded\n  skill description\n---\nBody'
        : path,
    }))
    const data = await loadWorkspaceCapabilities('one')
    expect(data.skills).toHaveLength(2)
    expect(data.skills.find((s) => s.name === 'same')?.owner).toBe('alice-harness')
    expect(data.skills.find((s) => s.name === 'changed')?.owner).toBe('workspace')
    expect(data.instructions[0]?.owner).toBe('workspace')
    expect(data.skills.find((s) => s.name === 'same')?.locations).toHaveLength(
      2,
    )
    expect(data.skills.find((s) => s.name === 'same')?.description).toContain(
      'A folded skill description',
    )
    expect(data.errors[0]).toContain('unreachable')
    expect(data.instructions.map((i) => i.path)).toEqual(['AGENTS.md'])
    expect(
      data.skills.every(
        (s) => s.source === 'canonical' && s.path.startsWith('.agents/'),
      ),
    ).toBe(true)
    expect(
      data.skills.find((s) => s.name === 'changed')?.mirrors?.[0].present,
    ).toBe(true)
  })
  it('never exposes a late inventory from the previous Workspace', async () => {
    let resolve!: (v: unknown) => void
    mocks.list.mockImplementation((id) =>
      id === 'old'
        ? new Promise((r) => {
            resolve = r
          })
        : Promise.resolve(listing()),
    )
    mocks.read.mockResolvedValue({ kind: 'file_missing' })
    const { result, rerender } = renderHook(
      ({ id }) => useWorkspaceCapabilities(id, 0),
      { initialProps: { id: 'old' } },
    )
    rerender({ id: 'new' })
    await waitFor(() => expect(result.current?.id).toBe('new'))
    await act(async () => {
      resolve(listing())
      await Promise.resolve()
    })
    expect(result.current?.id).toBe('new')
  })
  it('keeps manifest failure distinct from an empty command registry and allows retry', async () => {
    mocks.json
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ groups: {} })
    const { result, rerender } = renderHook(
      ({ attempt }) => useWorkspaceCli('one', 'data', attempt),
      { initialProps: { attempt: 0 } },
    )
    await waitFor(() => expect(result.current?.error).toBe('offline'))
    rerender({ attempt: 1 })
    await waitFor(() => expect(result.current?.data?.groups).toEqual({}))
  })
})

it('keeps an orphan Claude skill inspectable under one identity', async () => {
  mocks.list.mockImplementation(async (_id, path) =>
    path === ''
      ? listing('.claude')
      : path === '.claude'
        ? listing('skills')
        : listing('orphan'),
  )
  mocks.read.mockImplementation(async (_id, path) =>
    path === 'AGENTS.md'
      ? { kind: 'file_missing' }
      : { kind: 'ok', content: 'local edit' },
  )
  const data = await loadWorkspaceCapabilities('orphan')
  expect(data.skills).toHaveLength(1)
  expect(data.skills[0]).toMatchObject({
    source: 'mirror-only',
    path: '.claude/skills/orphan/SKILL.md',
  })
  expect(data.instructions[0]).toMatchObject({
    source: 'mirror-only',
    path: 'CLAUDE.md',
  })
})

it('keeps files readable with unknown ownership when the Project inventory fails', async () => {
  mocks.json.mockRejectedValue(new Error('offline'))
  mocks.list.mockImplementation(async (_id, path) => path === '' ? listing('.agents') : path === '.agents' ? listing('skills') : listing('same'))
  mocks.read.mockResolvedValue({ kind: 'ok', content: 'local text' })
  const data = await loadWorkspaceCapabilities('one')
  expect(data.skills[0]).toMatchObject({ owner: 'unknown', content: { kind: 'ok' } })
  expect(data.errors).toContain('Alice Harness: offline')
})
