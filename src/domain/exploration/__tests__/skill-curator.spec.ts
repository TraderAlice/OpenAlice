import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillCurator, __internal } from '../skill-curator.js'

describe('SkillCurator', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'alice-skills-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('persist + list', () => {
    it('writes a skill with frontmatter and loads it back', async () => {
      const curator = createSkillCurator({ skillsDir: dir })
      const skill = await curator.persist({
        triggers: ['tsmc', '法說'],
        body: '# TSMC 法說前部位\n\n## When to load\ntest',
        confidence: 0.8,
        summary: 'test summary',
      })
      expect(skill.frontmatter.id).toMatch(/^\d{4}-\d{2}-\d{2}-/)
      expect(skill.frontmatter.triggers).toEqual(['tsmc', '法說'])
      expect(skill.frontmatter.confidence).toBe(0.8)
      expect(skill.frontmatter.usageCount).toBe(0)

      const all = await curator.list()
      expect(all).toHaveLength(1)
      expect(all[0].frontmatter.id).toBe(skill.frontmatter.id)
      expect(all[0].body).toContain('TSMC 法說前部位')
    })

    it('persists frontmatter in a readable yaml-ish form', async () => {
      const curator = createSkillCurator({ skillsDir: dir })
      const skill = await curator.persist({
        triggers: ['alpha', 'beta'],
        body: '# heading\n\ncontent',
        confidence: 0.33,
      })
      const raw = await readFile(skill.filePath, 'utf-8')
      expect(raw).toMatch(/^---\n/)
      expect(raw).toContain('triggers: ["alpha", "beta"]')
      expect(raw).toContain('confidence: 0.33')
      expect(raw).toContain('# heading')
    })
  })

  describe('recall', () => {
    it('returns skills whose triggers match the context', async () => {
      const curator = createSkillCurator({ skillsDir: dir })
      await curator.persist({
        triggers: ['tsmc', '半導體'],
        body: '# tsmc skill',
        confidence: 0.7,
      })
      await curator.persist({
        triggers: ['btc', 'crypto'],
        body: '# btc skill',
        confidence: 0.9,
      })

      const hits = await curator.recall({ context: '今天 TSMC 法說會漲停' })
      expect(hits).toHaveLength(1)
      expect(hits[0].body).toContain('tsmc skill')
    })

    it('returns empty list when no triggers match', async () => {
      const curator = createSkillCurator({ skillsDir: dir })
      await curator.persist({ triggers: ['nvda'], body: '# nvda', confidence: 0.5 })
      const hits = await curator.recall({ context: '完全無關的文字' })
      expect(hits).toEqual([])
    })

    it('sorts by trigger hit count, then confidence', async () => {
      const curator = createSkillCurator({ skillsDir: dir })
      await curator.persist({ triggers: ['vix'], body: '# a', confidence: 0.2 })
      await curator.persist({ triggers: ['vix', 'fear'], body: '# b', confidence: 0.3 })
      await curator.persist({ triggers: ['vix'], body: '# c', confidence: 0.9 })

      const hits = await curator.recall({ context: 'vix fear 指標' })
      expect(hits).toHaveLength(3)
      // b has 2 trigger hits, ranks first
      expect(hits[0].body).toContain('# b')
      // c has 1 hit but higher confidence than a
      expect(hits[1].body).toContain('# c')
      expect(hits[2].body).toContain('# a')
    })
  })

  describe('markUsed', () => {
    it('bumps usageCount and sets lastUsedAt', async () => {
      const curator = createSkillCurator({ skillsDir: dir })
      const skill = await curator.persist({
        triggers: ['foo'],
        body: '# foo',
      })
      expect(skill.frontmatter.usageCount).toBe(0)

      await curator.markUsed([skill.frontmatter.id])
      const reloaded = await curator.load(skill.frontmatter.id)
      expect(reloaded?.frontmatter.usageCount).toBe(1)
      expect(reloaded?.frontmatter.lastUsedAt).toBeTruthy()
    })
  })

  describe('prune', () => {
    it('removes lowest-scoring skills when over capacity', async () => {
      const curator = createSkillCurator({ skillsDir: dir })
      const a = await curator.persist({ triggers: ['a'], body: '# a', confidence: 0.1 })
      const b = await curator.persist({ triggers: ['b'], body: '# b', confidence: 0.9 })
      const c = await curator.persist({ triggers: ['c'], body: '# c', confidence: 0.9 })
      await curator.markUsed([b.frontmatter.id, c.frontmatter.id])

      const pruned = await curator.prune(2)
      expect(pruned).toEqual([a.frontmatter.id])

      const remaining = await curator.list()
      expect(remaining.map((s) => s.frontmatter.id).sort()).toEqual(
        [b.frontmatter.id, c.frontmatter.id].sort(),
      )
    })

    it('returns empty array when under capacity', async () => {
      const curator = createSkillCurator({ skillsDir: dir })
      await curator.persist({ triggers: ['a'], body: '# a' })
      const pruned = await curator.prune(10)
      expect(pruned).toEqual([])
    })
  })

  describe('frontmatter parsing round-trip', () => {
    it('survives a parse → serialize cycle', () => {
      const fm = {
        id: '2026-04-11-foo-1234',
        triggers: ['a', 'b with space'],
        created: '2026-04-11T10:00:00.000Z',
        usageCount: 5,
        confidence: 0.7,
        lastUsedAt: '2026-04-11T11:00:00.000Z',
        summary: 'one liner',
      }
      const serialized = __internal.serializeFrontmatter(fm)
      const roundTripped = __internal.parseFrontmatter(
        `${serialized}\n\n# body\n\ncontent`,
      )
      expect(roundTripped.frontmatter).toEqual(fm)
      expect(roundTripped.body).toBe('# body\n\ncontent')
    })
  })
})
