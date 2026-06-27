import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrateWorkspaceIssues } from './0010_workspace_issues_to_markdown/index.js'
// Round-trip through the REAL reader — the strongest guarantee that what the
// migration writes is exactly what the running launcher will read back.
import { readWorkspaceIssues } from '@/workspaces/issues/declaration.js'

let root: string
const wsDir: Record<string, string> = {}

async function makeLauncher(ids: string[]): Promise<void> {
  await mkdir(root, { recursive: true })
  const workspaces = ids.map((id) => {
    const dir = join(root, 'workspaces', id)
    wsDir[id] = dir
    return { id, tag: id, dir, createdAt: '2026-01-01T00:00:00Z', agents: [] }
  })
  await writeFile(join(root, 'workspaces.json'), JSON.stringify({ version: 1, workspaces }), 'utf-8')
  for (const w of workspaces) await mkdir(join(w.dir, '.alice'), { recursive: true })
}

function writeLegacy(id: string, base: string, data: unknown): Promise<void> {
  return writeFile(join(wsDir[id], '.alice', base), JSON.stringify(data), 'utf-8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mig0010-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('0010 workspace issues → markdown', () => {
  it('converts .alice/issue.json {issues:[…]} to per-issue markdown, removes the legacy file, and is reader-readable', async () => {
    await makeLauncher(['ws1'])
    await writeLegacy('ws1', 'issue.json', {
      issues: [
        { id: 'morning-scan', issue: 'Morning scan', when: { kind: 'every', every: '30m' }, what: 'go', agent: 'codex' },
        { id: 'paused-one', issue: 'Paused', when: { kind: 'cron', cron: '0 9 * * 1' }, enabled: false },
      ],
    })

    const res = await migrateWorkspaceIssues(root)
    expect(res).toEqual({ converted: 2, workspaces: 1 })

    // legacy file removed
    await expect(stat(join(wsDir['ws1'], '.alice', 'issue.json'))).rejects.toThrow()

    // round-trip through the real reader
    const read = await readWorkspaceIssues(wsDir['ws1'])
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const byId = Object.fromEntries(read.issues.map((i) => [i.id, i]))

    expect(byId['morning-scan'].title).toBe('Morning scan')
    expect(byId['morning-scan'].when).toEqual({ kind: 'every', every: '30m' })
    expect(byId['morning-scan'].what).toBe('go')
    expect(byId['morning-scan'].agent).toBe('codex')
    expect(byId['morning-scan'].status).toBe('todo') // board default
    expect(byId['morning-scan'].priority).toBe('none')
    expect(byId['morning-scan'].assignee).toBe('unassigned')

    // enabled:false → terminal status so the schedule stops firing
    expect(byId['paused-one'].status).toBe('canceled')
    expect(byId['paused-one'].when).toEqual({ kind: 'cron', cron: '0 9 * * 1' })
  })

  it('converts the original .alice/schedule.json {tasks:[…]} (no title) using the id as title', async () => {
    await makeLauncher(['ws2'])
    await writeLegacy('ws2', 'schedule.json', {
      tasks: [{ id: 'thesis-watch', when: { kind: 'every', every: '1h' }, what: 'check' }],
    })

    const res = await migrateWorkspaceIssues(root)
    expect(res.converted).toBe(1)

    const read = await readWorkspaceIssues(wsDir['ws2'])
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.issues[0].title).toBe('thesis-watch')
    expect(read.issues[0].when).toEqual({ kind: 'every', every: '1h' })
  })

  it('is idempotent — a workspace already on .alice/issues/ is skipped (legacy left inert)', async () => {
    await makeLauncher(['ws3'])
    await mkdir(join(wsDir['ws3'], '.alice', 'issues'), { recursive: true })
    await writeFile(join(wsDir['ws3'], '.alice', 'issues', 'x.md'), '---\ntitle: X\n---\n', 'utf-8')
    await writeLegacy('ws3', 'issue.json', { issues: [{ id: 'y', issue: 'Y' }] })

    const res = await migrateWorkspaceIssues(root)
    expect(res.converted).toBe(0)
    expect(await readdir(join(wsDir['ws3'], '.alice', 'issues'))).toEqual(['x.md'])
  })

  it('no-ops when there is no launcher / workspaces.json', async () => {
    const res = await migrateWorkspaceIssues(join(root, 'nope'))
    expect(res).toEqual({ converted: 0, workspaces: 0 })
  })

  it('leaves an unparseable legacy file in place (never destroys unreadable data)', async () => {
    await makeLauncher(['ws4'])
    await writeFile(join(wsDir['ws4'], '.alice', 'issue.json'), '{ not json', 'utf-8')

    const res = await migrateWorkspaceIssues(root)
    expect(res.converted).toBe(0)
    await expect(stat(join(wsDir['ws4'], '.alice', 'issue.json'))).resolves.toBeDefined()
  })

  it('de-duplicates colliding ids so no file is overwritten', async () => {
    await makeLauncher(['ws5'])
    await writeLegacy('ws5', 'issue.json', {
      issues: [
        { id: 'dup', issue: 'First', when: { kind: 'every', every: '5m' } },
        { id: 'dup', issue: 'Second', when: { kind: 'every', every: '5m' } },
      ],
    })

    const res = await migrateWorkspaceIssues(root)
    expect(res.converted).toBe(2)
    const read = await readWorkspaceIssues(wsDir['ws5'])
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.issues.length).toBe(2)
    expect(new Set(read.issues.map((i) => i.title))).toEqual(new Set(['First', 'Second']))
  })
})
