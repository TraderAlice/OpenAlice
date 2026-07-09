import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { matchWorkspaceArtifact, verifyIssueArtifacts } from './require-artifacts.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'require-art-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeIssue(id: string, front: string): Promise<void> {
  await mkdir(join(dir, '.alice', 'issues'), { recursive: true })
  await writeFile(join(dir, '.alice', 'issues', `${id}.md`), `---\n${front}\n---\nbody\n`, 'utf8')
}

async function touch(rel: string, mtimeMs: number): Promise<void> {
  const abs = join(dir, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, 'x', 'utf8')
  const at = new Date(mtimeMs)
  await utimes(abs, at, at)
}

describe('matchWorkspaceArtifact', () => {
  it('matches an exact fresh file', async () => {
    const since = Date.now() - 5_000
    await touch('outputs/report.md', since + 1_000)
    expect(await matchWorkspaceArtifact(dir, 'outputs/report.md', since)).toEqual([
      'outputs/report.md',
    ])
  })

  it('rejects a stale exact file', async () => {
    const since = Date.now()
    await touch('outputs/report.md', since - 120_000)
    expect(await matchWorkspaceArtifact(dir, 'outputs/report.md', since)).toEqual([])
  })

  it('matches basename globs with one *', async () => {
    const since = Date.now() - 5_000
    await touch('outputs/real-us-screeners-cross-2026-07-08.md', since + 1_000)
    await touch('outputs/other.md', since + 1_000)
    expect(
      await matchWorkspaceArtifact(dir, 'outputs/real-us-screeners-cross-*.md', since),
    ).toEqual(['outputs/real-us-screeners-cross-2026-07-08.md'])
  })

  it('rejects path traversal and multi-star patterns', async () => {
    expect(await matchWorkspaceArtifact(dir, '../etc/passwd', Date.now())).toEqual([])
    expect(await matchWorkspaceArtifact(dir, 'a/*/b*.md', Date.now())).toEqual([])
  })
})

describe('verifyIssueArtifacts', () => {
  it('skips when the issue has no requireArtifacts', async () => {
    await writeIssue('plain', 'title: Plain\nwhen: { kind: cron, cron: "0 18 * * 1-5" }')
    const r = await verifyIssueArtifacts({
      wsDir: dir,
      issueId: 'plain',
      sinceMs: Date.now(),
    })
    expect(r).toEqual({ ok: true, skipped: true, reason: 'no_requirements' })
  })

  it('passes when every required pattern has a fresh hit', async () => {
    const since = Date.now() - 5_000
    await writeIssue(
      'daily',
      [
        'title: Daily',
        'when: { kind: cron, cron: "0 18 * * 1-5" }',
        'requireArtifacts:',
        '  - outputs/real-us-screeners-cross-*.md',
        '  - outputs/real-us-relative-strength-pool.json',
      ].join('\n'),
    )
    await touch('outputs/real-us-screeners-cross-2026-07-08.md', since + 1_000)
    await touch('outputs/real-us-relative-strength-pool.json', since + 1_000)
    const r = await verifyIssueArtifacts({ wsDir: dir, issueId: 'daily', sinceMs: since })
    expect(r.ok).toBe(true)
    if (r.ok && !('skipped' in r)) {
      expect(r.checked).toContain('outputs/real-us-screeners-cross-2026-07-08.md')
      expect(r.checked).toContain('outputs/real-us-relative-strength-pool.json')
    }
  })

  it('fails when a required artifact is missing or stale', async () => {
    const since = Date.now()
    await writeIssue(
      'daily',
      [
        'title: Daily',
        'when: { kind: cron, cron: "0 18 * * 1-5" }',
        'requireArtifacts:',
        '  - outputs/real-us-screeners-cross-*.md',
        '  - outputs/real-us-factor-rank.json',
      ].join('\n'),
    )
    // Stale cross report + missing factor rank
    await touch('outputs/real-us-screeners-cross-2026-07-07.md', since - 120_000)
    const r = await verifyIssueArtifacts({ wsDir: dir, issueId: 'daily', sinceMs: since })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.missing).toEqual([
        'outputs/real-us-screeners-cross-*.md',
        'outputs/real-us-factor-rank.json',
      ])
      expect(r.error).toMatch(/required artifacts missing or stale/)
    }
  })
})
