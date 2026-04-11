/**
 * SkillCurator — manages the lifecycle of skill markdown files.
 *
 * Each skill lives at {skillsDir}/{id}.md with YAML frontmatter + markdown body.
 * The curator handles loading, recall (keyword match), persistence, and LRU pruning.
 *
 * This is intentionally simple: no FTS5, no embeddings. Keyword triggers and
 * recency + confidence ordering are enough at this scale (hundreds of skills).
 */

import { readFile, writeFile, readdir, mkdir, unlink, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Skill, SkillFrontmatter } from './types.js'

// ==================== Parsing ====================

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/

/** Parse YAML-ish frontmatter. Only handles the keys we emit ourselves. */
function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) {
    throw new Error('Skill file missing frontmatter delimiters')
  }
  const fmBlock = match[1]
  const body = raw.slice(match[0].length).trim()

  const fm: Partial<SkillFrontmatter> = {}
  for (const line of fmBlock.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const rawValue = line.slice(idx + 1).trim()
    if (rawValue === '') continue

    switch (key) {
      case 'id':
      case 'created':
      case 'lastUsedAt':
      case 'summary':
        fm[key] = stripQuotes(rawValue)
        break
      case 'usageCount': {
        const n = Number(rawValue)
        if (!Number.isNaN(n)) fm.usageCount = n
        break
      }
      case 'confidence': {
        const n = Number(rawValue)
        if (!Number.isNaN(n)) fm.confidence = n
        break
      }
      case 'triggers':
        fm.triggers = parseYamlList(rawValue)
        break
      default:
        break
    }
  }

  if (!fm.id || !fm.created || !fm.triggers) {
    throw new Error(`Skill frontmatter missing required keys: ${JSON.stringify(fm)}`)
  }
  return {
    frontmatter: {
      id: fm.id,
      created: fm.created,
      triggers: fm.triggers,
      usageCount: fm.usageCount ?? 0,
      confidence: fm.confidence ?? 0.5,
      lastUsedAt: fm.lastUsedAt,
      summary: fm.summary,
    },
    body,
  }
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function parseYamlList(raw: string): string[] {
  // Accepts either "[a, b, c]" or "- a\n- b" (inline form only for simplicity)
  const trimmed = raw.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean)
  }
  // Fallback: comma-separated
  return trimmed.split(',').map((s) => stripQuotes(s.trim())).filter(Boolean)
}

function serializeFrontmatter(fm: SkillFrontmatter): string {
  const lines: string[] = ['---']
  lines.push(`id: ${fm.id}`)
  lines.push(`triggers: [${fm.triggers.map((t) => JSON.stringify(t)).join(', ')}]`)
  lines.push(`created: ${fm.created}`)
  lines.push(`usageCount: ${fm.usageCount}`)
  lines.push(`confidence: ${fm.confidence}`)
  if (fm.lastUsedAt) lines.push(`lastUsedAt: ${fm.lastUsedAt}`)
  if (fm.summary) lines.push(`summary: ${JSON.stringify(fm.summary)}`)
  lines.push('---')
  return lines.join('\n')
}

/** Extract the first markdown body for a skill file (frontmatter + body). */
export function serializeSkill(skill: Pick<Skill, 'frontmatter' | 'body'>): string {
  return `${serializeFrontmatter(skill.frontmatter)}\n\n${skill.body.trim()}\n`
}

// ==================== Curator ====================

export interface SkillCurator {
  list(): Promise<Skill[]>
  load(id: string): Promise<Skill | null>
  recall(opts: RecallOptions): Promise<Skill[]>
  persist(input: PersistSkillInput): Promise<Skill>
  markUsed(ids: string[]): Promise<void>
  prune(maxSkills: number): Promise<string[]>
  remove(id: string): Promise<boolean>
}

export interface RecallOptions {
  /** Free-form context text. Triggers matching any substring in here are considered hits. */
  context: string
  /** Explicit keyword triggers (in addition to context scan). */
  keywords?: string[]
  /** How many skills to return at most. */
  limit?: number
}

export interface PersistSkillInput {
  triggers: string[]
  body: string
  confidence?: number
  summary?: string
  /** Optional explicit id. If missing, generated from date + slugified first heading. */
  id?: string
}

export interface CuratorConfig {
  skillsDir: string
}

// ==================== Implementation ====================

export function createSkillCurator(config: CuratorConfig): SkillCurator {
  const dir = resolve(config.skillsDir)

  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true })
  }

  async function list(): Promise<Skill[]> {
    await ensureDir()
    const entries = await readdir(dir)
    const files = entries.filter((f) => f.endsWith('.md'))
    const skills: Skill[] = []
    for (const file of files) {
      const filePath = join(dir, file)
      try {
        const raw = await readFile(filePath, 'utf-8')
        const parsed = parseFrontmatter(raw)
        skills.push({ ...parsed, filePath })
      } catch (err) {
        console.warn('Skipping malformed skill file %s: %s', filePath, err)
      }
    }
    return skills
  }

  async function load(id: string): Promise<Skill | null> {
    const all = await list()
    return all.find((s) => s.frontmatter.id === id) ?? null
  }

  async function recall(opts: RecallOptions): Promise<Skill[]> {
    const all = await list()
    const limit = opts.limit ?? 5
    const haystack = [opts.context, ...(opts.keywords ?? [])].join(' ').toLowerCase()
    if (!haystack.trim()) return []

    const scored = all
      .map((skill) => {
        const triggerHits = skill.frontmatter.triggers.filter((t) =>
          haystack.includes(t.toLowerCase()),
        ).length
        // Base score: trigger match weighted most, confidence + recency break ties.
        const recency = skill.frontmatter.lastUsedAt
          ? Math.max(0, 30 - daysSince(skill.frontmatter.lastUsedAt)) / 30
          : 0
        const score =
          triggerHits * 10 + skill.frontmatter.confidence * 2 + recency
        return { skill, score, triggerHits }
      })
      .filter(({ triggerHits }) => triggerHits > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ skill }) => skill)

    return scored
  }

  async function persist(input: PersistSkillInput): Promise<Skill> {
    await ensureDir()
    const id = input.id ?? generateSkillId(input.body)
    const now = new Date().toISOString()
    const frontmatter: SkillFrontmatter = {
      id,
      triggers: input.triggers,
      created: now,
      usageCount: 0,
      confidence: input.confidence ?? 0.5,
      summary: input.summary,
    }
    const filePath = join(dir, `${id}.md`)
    const skill: Skill = { frontmatter, body: input.body.trim(), filePath }
    await writeFile(filePath, serializeSkill(skill), 'utf-8')
    return skill
  }

  async function markUsed(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const all = await list()
    const now = new Date().toISOString()
    for (const skill of all) {
      if (!ids.includes(skill.frontmatter.id)) continue
      skill.frontmatter.usageCount += 1
      skill.frontmatter.lastUsedAt = now
      await writeFile(skill.filePath, serializeSkill(skill), 'utf-8')
    }
  }

  async function prune(maxSkills: number): Promise<string[]> {
    const all = await list()
    if (all.length <= maxSkills) return []

    // Higher score = more worth keeping.
    // Prune the lowest scores first. Score combines usage, confidence, and recency.
    const scored = all.map((skill) => {
      const lastSeen = skill.frontmatter.lastUsedAt ?? skill.frontmatter.created
      const ageDays = daysSince(lastSeen)
      const score =
        ((skill.frontmatter.usageCount + 1) *
          (skill.frontmatter.confidence + 0.1)) /
        (ageDays + 1)
      return { skill, score }
    })
    scored.sort((a, b) => a.score - b.score)

    const toPrune = scored.slice(0, all.length - maxSkills)
    const pruned: string[] = []
    for (const { skill } of toPrune) {
      await unlink(skill.filePath)
      pruned.push(skill.frontmatter.id)
    }
    return pruned
  }

  async function remove(id: string): Promise<boolean> {
    const skill = await load(id)
    if (!skill) return false
    await unlink(skill.filePath)
    return true
  }

  return { list, load, recall, persist, markUsed, prune, remove }
}

// ==================== Helpers ====================

function daysSince(iso: string): number {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return Number.MAX_SAFE_INTEGER
  return (Date.now() - then) / (1000 * 60 * 60 * 24)
}

export function generateSkillId(body: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const firstHeading = body
    .split('\n')
    .find((line) => line.startsWith('#'))
    ?.replace(/^#+\s*/, '')
    .trim()
  const slug = (firstHeading ?? 'exploration')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${date}-${slug || 'exploration'}-${rand}`
}

/** Exposed for tests. */
export const __internal = { parseFrontmatter, serializeFrontmatter, daysSince }
