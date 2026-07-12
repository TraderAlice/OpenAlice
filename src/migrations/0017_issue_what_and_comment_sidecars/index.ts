/**
 * 0017_issue_what_and_comment_sidecars
 *
 * Unify the human-visible Issue document and the scheduled prompt: YAML
 * frontmatter `what` is moved into the markdown below frontmatter. Historical
 * `## Comments` blocks leave the agent-editable markdown entirely and become a
 * structured per-Issue JSON sidecar. The migration is deliberately
 * self-contained rather than importing the evolving Issue parser.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { Migration } from '../types.js'

interface WorkspaceMeta { dir?: unknown }
interface CommentRecord { id: string; author: string; at: string; markdown: string }

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return null
  return { frontmatter: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n').trim() }
}

function splitLegacyComments(body: string): { what: string; comments: string } {
  const lines = body.split(/\r?\n/)
  const index = lines.findIndex((line) => /^##\s+Comments\s*$/.test(line.trim()))
  if (index < 0) return { what: body.trim(), comments: '' }
  return { what: lines.slice(0, index).join('\n').trim(), comments: lines.slice(index + 1).join('\n').trim() }
}

function mergeWhat(legacyWhat: unknown, markdownWhat: string, title: unknown): string {
  const explicit = typeof legacyWhat === 'string' ? legacyWhat.trim() : ''
  const markdown = markdownWhat.trim()
  const fallback = typeof title === 'string' ? title.trim() : ''
  if (explicit && markdown && explicit !== markdown) return `${explicit}\n\n## Context\n\n${markdown}`
  return explicit || markdown || fallback
}

function commentId(author: string, at: string, markdown: string): string {
  return `comment-${createHash('sha256').update(`${author}\0${at}\0${markdown}`).digest('hex').slice(0, 24)}`
}

/** Parse the exact legacy format written by appendIssueComment. If an agent
 * rewrote that supposedly-structured section, preserve the entire remainder as
 * one legacy markdown comment rather than guessing and losing content. */
function parseLegacyComments(markdown: string): CommentRecord[] {
  const text = markdown.trim()
  if (!text) return []
  const marker = /^\*\*(.+?)\*\*\s+·\s+(\d{4}-\d{2}-\d{2}T[^\n]+)\s*$/gm
  const matches = Array.from(text.matchAll(marker))
  if (matches.length === 0) {
    const at = '1970-01-01T00:00:00.000Z'
    return [{ id: commentId('legacy', at, text), author: 'legacy', at, markdown: text }]
  }
  const comments: CommentRecord[] = []
  for (let index = 0; index < matches.length; index++) {
    const current = matches[index]
    const start = (current.index ?? 0) + current[0].length
    const end = matches[index + 1]?.index ?? text.length
    const body = text.slice(start, end).trim()
    const author = current[1].trim()
    const at = current[2].trim()
    if (!body) continue
    comments.push({ id: commentId(author, at, body), author, at, markdown: body })
  }
  if (comments.length > 0) return comments
  const at = '1970-01-01T00:00:00.000Z'
  return [{ id: commentId('legacy', at, text), author: 'legacy', at, markdown: text }]
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

async function normalizeIssue(path: string, id: string): Promise<{ updated: boolean; commentsMoved: number }> {
  const raw = await readFile(path, 'utf8')
  const split = splitFrontmatter(raw)
  if (!split) return { updated: false, commentsMoved: 0 }
  let parsed: unknown
  try { parsed = parseYaml(split.frontmatter) } catch { return { updated: false, commentsMoved: 0 } }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { updated: false, commentsMoved: 0 }
  }
  const frontmatter = parsed as Record<string, unknown>
  const document = splitLegacyComments(split.body)
  const comments = parseLegacyComments(document.comments)
  const commentsPath = join(dirname(path), `${id}.comments.json`)

  if (comments.length > 0) {
    let existing: CommentRecord[] = []
    if (await exists(commentsPath)) {
      try {
        const sidecar = JSON.parse(await readFile(commentsPath, 'utf8')) as { version?: unknown; issueId?: unknown; comments?: unknown }
        if (sidecar.version !== 1 || sidecar.issueId !== id || !Array.isArray(sidecar.comments)) {
          return { updated: false, commentsMoved: 0 }
        }
        existing = sidecar.comments as CommentRecord[]
      } catch {
        return { updated: false, commentsMoved: 0 }
      }
    }
    const ids = new Set(existing.map((comment) => comment.id))
    const merged = [...existing, ...comments.filter((comment) => !ids.has(comment.id))]
    await writeAtomic(commentsPath, JSON.stringify({ version: 1, issueId: id, comments: merged }, null, 2) + '\n')
  }

  const what = mergeWhat(frontmatter.what, document.what, frontmatter.title)
  delete frontmatter.what
  const fm = stringifyYaml(frontmatter).trimEnd()
  const content = what ? `---\n${fm}\n---\n\n${what}\n` : `---\n${fm}\n---\n`
  const updated = content !== raw
  if (updated) await writeAtomic(path, content)
  return { updated, commentsMoved: comments.length }
}

export async function migrateIssueWhatAndCommentSidecars(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ updated: number; commentsMoved: number; workspaces: number }> {
  let registry: { workspaces?: WorkspaceMeta[] }
  try { registry = JSON.parse(await readFile(join(launcherRoot, 'workspaces.json'), 'utf8')) as typeof registry }
  catch { return { updated: 0, commentsMoved: 0, workspaces: 0 } }
  const dirs = Array.isArray(registry.workspaces)
    ? registry.workspaces.map((workspace) => typeof workspace.dir === 'string' ? workspace.dir : '').filter(Boolean)
    : []
  let updated = 0
  let commentsMoved = 0
  let workspaces = 0
  for (const dir of dirs) {
    const issuesDir = join(dir, '.alice', 'issues')
    let files: string[]
    try { files = (await readdir(issuesDir)).filter((name) => name.toLowerCase().endsWith('.md')) }
    catch { continue }
    let touched = false
    for (const file of files) {
      try {
        const result = await normalizeIssue(join(issuesDir, file), file.slice(0, -3))
        if (result.updated) { updated++; touched = true }
        commentsMoved += result.commentsMoved
      } catch (err) {
        console.log(`[migration 0017] skipped ${join(issuesDir, file)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (touched) workspaces++
  }
  return { updated, commentsMoved, workspaces }
}

export const migration: Migration = {
  id: '0017_issue_what_and_comment_sidecars',
  appVersion: '0.80.0-beta',
  introducedAt: '2026-07-12',
  affects: ['workspaces/<id>/.alice/issues/*.md', 'workspaces/<id>/.alice/issues/*.comments.json'],
  summary: 'Make markdown What the sole Issue work definition and move comments into structured per-Issue JSON sidecars.',
  rationale: 'Agents may freely rewrite Issue markdown, so comment structure cannot safely share that document; a visible work definition must also be the exact scheduled prompt.',
  up: async () => { await migrateIssueWhatAndCommentSidecars() },
}
