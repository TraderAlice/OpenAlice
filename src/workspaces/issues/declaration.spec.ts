import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { issueFirePrompt, isFireable, readWorkspaceIssues } from './declaration.js'

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
        assignee: 'unassigned',
      })
      expect(i.when).toBeUndefined()
      expect(isFireable(i)).toBe(false)
    }
  })

  it('parses a SCHEDULED issue (with when) including its body', async () => {
    await writeIssue(
      'morning-research',
      fm(
        [
          'title: Morning research sweep',
          'status: in_progress',
          'priority: high',
          'assignee: "ws:auto-quant"',
          'when: { kind: every, every: 30m }',
          'what: run the research routine',
          'agent: codex',
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
        assignee: 'ws:auto-quant',
        what: 'run the research routine',
        agent: 'codex',
      })
      expect(i.when).toEqual({ kind: 'every', every: '30m' })
      expect(i.body).toBe('Scan overnight movers and summarize.')
      expect(isFireable(i)).toBe(true)
    }
  })

  it('parses block-style and cron/at `when` shapes', async () => {
    await writeIssue('eod', fm('title: EOD summary\nwhen:\n  kind: cron\n  cron: "0 16 * * 1-5"'))
    await writeIssue('oneshot', fm('title: One-shot\nwhen: { kind: at, at: "2030-01-01T09:00:00Z" }'))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const byId = Object.fromEntries(r.issues.map((i) => [i.id, i]))
      expect(byId['eod'].when).toEqual({ kind: 'cron', cron: '0 16 * * 1-5' })
      expect(byId['oneshot'].when).toEqual({ kind: 'at', at: '2030-01-01T09:00:00Z' })
    }
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

  it('fire prompt prefers `what`, else falls back to title+body, else title', async () => {
    await writeIssue('with-what', fm('title: T\nwhat: explicit prompt', 'ignored body'))
    await writeIssue('no-what', fm('title: Do the thing', 'with detail'))
    await writeIssue('bare', fm('title: Just a title'))
    const r = await readWorkspaceIssues(dir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const byId = Object.fromEntries(r.issues.map((i) => [i.id, i]))
      expect(issueFirePrompt(byId['with-what'])).toBe('explicit prompt')
      expect(issueFirePrompt(byId['no-what'])).toBe('Do the thing\n\nwith detail')
      expect(issueFirePrompt(byId['bare'])).toBe('Just a title')
    }
  })
})
