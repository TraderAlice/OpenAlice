import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeBacklinkPath, scanBacklinks } from './entity-backlinks.js'
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js'

function fakeRegistry(workspaces: { id: string; tag: string; dir: string }[]): WorkspaceRegistry {
  return { list: () => workspaces } as unknown as WorkspaceRegistry
}

describe('scanBacklinks', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'oa-backlinks-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('gathers [[name]] links across workspaces — case-insensitive, deduped per file, scaffolding skipped', async () => {
    const ws1 = join(root, 'ws1')
    const ws2 = join(root, 'ws2')
    await mkdir(join(ws1, 'rotation'), { recursive: true })
    await mkdir(join(ws1, '.git'), { recursive: true })
    await mkdir(ws2, { recursive: true })

    await writeFile(join(ws1, 'power.md'), 'buy [[vst]] and [[gev]]; [[VST]] again in the same file')
    await writeFile(join(ws1, 'rotation', 'jun.md'), 'theme [[ai-data-center-power]] holds [[vst]]')
    // Scaffolding / dot-dir / non-md must all be ignored.
    await writeFile(join(ws1, 'CLAUDE.md'), 'persona text mentioning [[vst]] — must not count')
    await writeFile(join(ws1, '.git', 'COMMIT_EDITMSG'), '[[vst]] inside .git')
    await writeFile(join(ws1, 'notes.txt'), '[[vst]] in a .txt')
    await writeFile(join(ws2, 'a.md'), 'only [[gev]] here')

    const map = await scanBacklinks(
      fakeRegistry([
        { id: 'id1', tag: 'ws1', dir: ws1 },
        { id: 'id2', tag: 'ws2', dir: ws2 },
      ]),
    )

    // vst: power.md (deduped from two mentions) + rotation/jun.md — never the
    // CLAUDE.md / .git / .txt files. All in ws1.
    const vst = map.get('vst') ?? []
    expect(vst.map((b) => b.path).sort()).toEqual(['power.md', 'rotation/jun.md'].sort())
    expect(vst.every((b) => b.workspaceId === 'id1')).toBe(true)

    // gev spans both workspaces.
    const gev = map.get('gev') ?? []
    expect(gev.map((b) => `${b.workspaceTag}:${b.path}`).sort()).toEqual(
      ['ws1:power.md', 'ws2:a.md'].sort(),
    )

    // dashed topic name resolves.
    expect((map.get('ai-data-center-power') ?? []).map((b) => b.path)).toEqual([
      'rotation/jun.md',
    ])

    // Nothing leaked from scaffolding: vst has exactly two backlinks.
    expect(vst).toHaveLength(2)
  })

  it('lets .alice/issues/*.md into the corpus while still skipping the rest of .alice and other dot-dirs', async () => {
    const ws = join(root, 'ws')
    await mkdir(join(ws, '.alice', 'issues'), { recursive: true })
    await mkdir(join(ws, '.alice', 'other'), { recursive: true })
    await mkdir(join(ws, '.claude'), { recursive: true })

    // Issue notes DO feed the graph.
    await writeFile(join(ws, '.alice', 'issues', 'morning-scan.md'), 'tracking [[vst]] before the open')
    await writeFile(join(ws, '.alice', 'issues', 'cleanup.md'), 'blocked on [[refactor-fetcher]]')
    // The rest of .alice and other dot-dirs must stay excluded.
    await writeFile(join(ws, '.alice', 'other', 'note.md'), '[[ghost]] must not count')
    await writeFile(join(ws, '.claude', 'persona.md'), '[[ghost]] from persona')

    const map = await scanBacklinks(fakeRegistry([{ id: 'id', tag: 'ws', dir: ws }]))

    // [[vst]] resolves, and its backlink path is the issue-note path (so the UI
    // can detect issue-notes by the `.alice/issues/` prefix).
    const vst = map.get('vst') ?? []
    expect(vst.map((b) => b.path)).toEqual(['.alice/issues/morning-scan.md'])
    expect(map.get('refactor-fetcher')?.[0]?.path).toBe('.alice/issues/cleanup.md')
    // Nothing leaked from .alice/other or .claude.
    expect(map.has('ghost')).toBe(false)
  })

  it('returns an empty map when no notes link anything', async () => {
    const ws = join(root, 'ws')
    await mkdir(ws, { recursive: true })
    await writeFile(join(ws, 'plain.md'), 'no links here, just prose')
    const map = await scanBacklinks(fakeRegistry([{ id: 'id', tag: 'ws', dir: ws }]))
    expect(map.size).toBe(0)
  })

  it('normalizes Windows separators so UI path-prefix checks are portable', () => {
    expect(normalizeBacklinkPath(String.raw`.alice\issues\morning-scan.md`)).toBe('.alice/issues/morning-scan.md')
    expect(normalizeBacklinkPath(String.raw`rotation\jun.md`)).toBe('rotation/jun.md')
  })
})
