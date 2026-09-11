// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor, act } from '@testing-library/react'
import {
  compareWorkspaceTrees,
  snapshotWorkspaceTree,
  useWorkspaceMirror,
} from './useWorkspaceMirrors'
const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }))
vi.mock('../components/workspace/api', () => ({
  listFiles: mocks.list,
  readWorkspaceFile: mocks.read,
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
it('finds supporting-file drift even when SKILL.md is identical', async () => {
  mocks.list.mockImplementation(async (_id, path) => ({
    entries: path.endsWith('scripts')
      ? [{ name: 'run.py', kind: 'file' }]
      : [
          { name: 'SKILL.md', kind: 'file' },
          { name: 'scripts', kind: 'dir' },
          { name: 'empty', kind: 'dir' },
        ].filter((e) => !path.endsWith('empty')),
  }))
  mocks.read.mockImplementation(async (_id, path) => ({
    kind: 'ok',
    content: path.endsWith('SKILL.md') ? 'same' : path,
  }))
  const a = await snapshotWorkspaceTree('ws', '.agents/skills/test')
  const b = await snapshotWorkspaceTree('ws', '.claude/skills/test')
  expect(compareWorkspaceTrees(a, b).map((d) => d.path)).toEqual([
    'scripts/run.py',
  ])
  expect(a.empty).toEqual({ kind: 'directory' })
})
it('distinguishes missing, extra and unreadable entries without treating unverified data as equal', () => {
  expect(
    compareWorkspaceTrees(
      { missing: { kind: 'text', content: 'x' }, bad: { kind: 'unchecked' } },
      { extra: { kind: 'text', content: 'y' }, bad: { kind: 'unchecked' } },
    ).map((d) => [d.path, d.status]),
  ).toEqual([
    ['bad', 'unchecked'],
    ['extra', 'mirrorOnly'],
    ['missing', 'sourceOnly'],
  ])
})
it('does not follow links or claim undecodable and oversized files match', async () => {
  mocks.list.mockResolvedValue({
    entries: [
      { name: 'loop', kind: 'symlink' },
      { name: 'binary', kind: 'file' },
      { name: 'large', kind: 'file' },
    ],
  })
  mocks.read.mockImplementation(async (_id, path) =>
    path.endsWith('large')
      ? { kind: 'too_large', sizeBytes: 999999 }
      : { kind: 'ok', content: '\ufffd' },
  )
  const tree = await snapshotWorkspaceTree('ws', 'root')
  expect(mocks.list).toHaveBeenCalledTimes(1)
  expect(Object.values(tree).every((e) => e.kind === 'unchecked')).toBe(true)
})
it('drops an old Workspace comparison after navigation', async () => {
  let finish!: (value: unknown) => void
  mocks.read.mockImplementation((id) =>
    id === 'old'
      ? new Promise((r) => {
          finish = r
        })
      : Promise.resolve({ kind: 'ok', content: 'new' }),
  )
  const { result, rerender } = renderHook(
    ({ id }) => useWorkspaceMirror(id, 'AGENTS.md', 'CLAUDE.md', true),
    { initialProps: { id: 'old' } },
  )
  rerender({ id: 'new' })
  await waitFor(() => expect(result.current?.differences).toEqual([]))
  await act(async () => {
    finish({ kind: 'ok', content: 'old' })
  })
  expect(result.current?.id).toContain('new')
})
