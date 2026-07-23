import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { issueAssigneeResumeId, issueFirePrompt, isFireable, readWorkspaceIssues } from './declaration.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'issues-decl-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Write `.alice/issues/<id>.md`. */
async function writeIssue(id: string, content: string): Promise<void> {
  await mkdir(join(dir, '.alice', 'issues'), { recursive: true })
  await writeFile(join(dir, '.alice', 'issues', `${id}.md`), content, 'utf8')
}

/** Write the retired single-file declaration (no issues/ dir). */
async function writeLegacyDecl(content: string): Promise<void> {
  await mkdir(join(dir, '.alice'), { recursive: true })
  await writeFile(join(dir, '.alice', 'issue.json'), content, 'utf8')
}

const fm = (front: string, body = ''): string => `---\n${front}\n---\n${body}`

describe('readWorkspaceIssues', () => {
  it('reports absent when there is no issues dir and no legacy file', async () => {
    expect(await readWorkspaceIssues(dir)).toEqual({ ok: false, reason: 'absent' })
  })

  it('reports invalid with a loud rename hint when only the legacy issue.json exists', async () => {
    await writeLegacyDecl(JSON.stringify({ issues: [{ id: 't1', issue: 'legacy', what: 'go' }] }))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('invalid')
      if (r.reason === 'invalid') {
        expect(r.error).toMatch(/retired|split|<id>\.md/)
        expect(r.error).toContain('.alice/issue.json')
        expect(r.error).toContain('.alice/issues/')
      }
    }
  })

  it('reads an empty issues dir as ok with no issues', async () => {
    await mkdir(join(dir, '.alice', 'issues'), { recursive: true })
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.issues).toHaveLength(0)
      expect(r.invalid).toHaveLength(0)
    }
  })

  it('parses an UNSCHEDULED issue (no when) with defaults applied', async () => {
    await writeIssue('fix-login', fm('title: Fix the login bug'), )
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.issues).toHaveLength(1)
      const i = r.issues[0]
      expect(i).toMatchObject({
        id: 'fix-login',
        title: 'Fix the login bug',
        status: 'todo',
        priority: 'none',
        assignee: '@workspace',
      })
      expect(i.when).toBeUndefined()
      expect(isFireable(i)).toBe(false)
    }
  })

  it('preserves an explicit unassigned owner for an unscheduled issue', async () => {
    await writeIssue('explicit', fm('title: Explicit\nassignee: "@unassigned"'))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.issues[0].assignee).toBe('@unassigned')
    }
  })

  it('merges a legacy frontmatter prompt and body into canonical What', async () => {
    await writeIssue(
      'morning-research',
      fm(
        [
          'title: Morning research sweep',
          'status: in_progress',
          'priority: high',
          'assignee: "@workspace"',
          'when: { kind: every, every: 30m }',
          'what: run the research routine',
          'agent: codex',
          'model: gpt-5.6',
          'effort: high',
        ].join('\n'),
        'Scan overnight movers and summarize.\n',
      ),
    )
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.issues).toHaveLength(1)
      const i = r.issues[0]
      expect(i).toMatchObject({
        id: 'morning-research',
        title: 'Morning research sweep',
        status: 'in_progress',
        priority: 'high',
        assignee: '@workspace',
        what: 'run the research routine\n\n## Context\n\nScan overnight movers and summarize.',
        agent: 'codex',
        model: 'gpt-5.6',
        effort: 'high',
      })
      expect(i.when).toEqual({ kind: 'every', every: '30m' })
      expect(i.what).toBe('run the research routine\n\n## Context\n\nScan overnight movers and summarize.')
      expect(isFireable(i)).toBe(true)
    }
  })

  it('parses Session ownership and defaults scheduled work to the Workspace', async () => {
    await writeIssue('owned', fm([
      'title: Owned work',
      'when: { kind: every, every: 30m }',
      'assignee: "@resume-kind-owl-abc123"',
    ].join('\n')))
    await writeIssue('legacy', fm('title: Legacy\nwhen: { kind: every, every: 30m }'))
    const result = await readWorkspaceIssues(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const byId = Object.fromEntries(result.issues.map((issue) => [issue.id, issue]))
    expect(issueAssigneeResumeId(byId['owned'].assignee)).toBe('resume-kind-owl-abc123')
    expect(byId['legacy'].assignee).toBe('@workspace')
  })

  it('rejects every runtime override on an exact Session owner', async () => {
    await writeIssue('owned-runtime', fm([
      'title: Owned runtime',
      'when: { kind: every, every: 30m }',
      'assignee: "@resume-kind-owl-abc123"',
      'agent: codex',
      'model: gpt-5.6',
      'effort: high',
    ].join('\n')))
    const result = await readWorkspaceIssues(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.invalid[0]?.error).toMatch(/agent.*model.*effort/)
  })

  it('rejects retired execution declarations instead of silently keeping two owner models', async () => {
    await writeIssue('retired', fm([
      'title: Retired owner field',
      'when: { kind: every, every: 30m }',
      'execution: { mode: fresh }',
    ].join('\n')))
    const result = await readWorkspaceIssues(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues).toEqual([])
    expect(result.invalid[0]?.error).toMatch(/execution/)
  })

  it('parses block-style and cron/at `when` shapes', async () => {
    await writeIssue('eod', fm('title: EOD summary\nwhen:\n  kind: cron\n  cron: "0 16 * * 1-5"\n  timezone: America/New_York'))
    await writeIssue('oneshot', fm('title: One-shot\nwhen: { kind: at, at: "2030-01-01T09:00:00Z" }'))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const byId = Object.fromEntries(r.issues.map((i) => [i.id, i]))
      expect(byId['eod'].when).toEqual({ kind: 'cron', cron: '0 16 * * 1-5', timezone: 'America/New_York' })
      expect(byId['oneshot'].when).toEqual({ kind: 'at', at: '2030-01-01T09:00:00Z' })
    }
  })

  it('rejects a cron timezone that is neither local nor an IANA zone', async () => {
    await writeIssue('bad-zone', fm('title: Bad zone\nwhen: { kind: cron, cron: "0 9 * * *", timezone: "New York-ish" }'))
    const result = await readWorkspaceIssues(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues).toEqual([])
    expect(result.invalid[0]?.error).toMatch(/timezone.*IANA/)
  })

  it('keys the id off the filename stem (not any frontmatter id)', async () => {
    await writeIssue('the-real-id', fm('title: T'))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.issues[0].id).toBe('the-real-id')
  })

  it('isolates a single invalid file: good issues still load, bad one is reported', async () => {
    await writeIssue('good', fm('title: A good issue'))
    await writeIssue('no-title', fm('status: todo')) // missing required title
    await writeIssue('bad-yaml', '---\ntitle: : :\n  - broken\n---\n') // unparseable YAML
    await writeIssue('no-frontmatter', 'just a body, no fence') // no frontmatter
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.issues.map((i) => i.id)).toEqual(['good'])
      expect(r.invalid.map((i) => i.id).sort()).toEqual(['bad-yaml', 'no-frontmatter', 'no-title'])
      const noTitle = r.invalid.find((i) => i.id === 'no-title')
      expect(noTitle?.error).toMatch(/title/)
    }
  })

  it('size-caps a single huge file as invalid without poisoning the rest', async () => {
    await writeIssue('good', fm('title: fine'))
    await writeIssue('huge', fm(`title: huge\nwhat: ${'x'.repeat(70 * 1024)}`))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.issues.map((i) => i.id)).toEqual(['good'])
      expect(r.invalid.find((i) => i.id === 'huge')?.error).toMatch(/too large/)
    }
  })

  it('ignores non-markdown files in the issues dir', async () => {
    await writeIssue('real', fm('title: real'))
    await mkdir(join(dir, '.alice', 'issues'), { recursive: true })
    await writeFile(join(dir, '.alice', 'issues', 'README.txt'), 'not an issue', 'utf8')
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.issues.map((i) => i.id)).toEqual(['real'])
      expect(r.invalid).toHaveLength(0)
    }
  })
})

describe('isFireable / issueFirePrompt', () => {
  it('a terminal-status scheduled issue is not fireable', async () => {
    await writeIssue('done-sched', fm('title: T\nstatus: done\nwhen: { kind: every, every: 5m }'))
    await writeIssue('canceled-sched', fm('title: T\nstatus: canceled\nwhen: { kind: every, every: 5m }'))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) for (const i of r.issues) expect(isFireable(i)).toBe(false)
  })

  it('fire prompt is exactly the canonical visible What', async () => {
    await writeIssue('with-what', fm('title: T\nwhat: explicit prompt', 'ignored body'))
    await writeIssue('no-what', fm('title: Do the thing', 'with detail'))
    await writeIssue('bare', fm('title: Just a title'))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const byId = Object.fromEntries(r.issues.map((i) => [i.id, i]))
      expect(issueFirePrompt(byId['with-what'])).toBe('explicit prompt\n\n## Context\n\nignored body')
      expect(issueFirePrompt(byId['no-what'])).toBe('with detail')
      expect(issueFirePrompt(byId['bare'])).toBe('Just a title')
    }
  })

  it('keeps legacy inline comments out of canonical What', async () => {
    await writeIssue('commented', fm('title: Commented', 'Do the work.\n\n## Comments\n\n**human** · 2026-07-12T00:00:00.000Z\n\nLooks good.'))
    const result = await readWorkspaceIssues(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues[0].what).toBe('Do the work.')
    expect(issueFirePrompt(result.issues[0])).toBe('Do the work.')
  })
})
