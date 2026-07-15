/**
 * Structured Issue comments.
 *
 * The Issue markdown is intentionally agent-editable and has no enforceable
 * internal structure, so comments must not depend on a heading or HTML marker
 * surviving an arbitrary rewrite. Each Issue therefore owns one adjacent JSON
 * sidecar: `.alice/issues/<id>.comments.json`. Per-Issue files also prevent two
 * concurrent workers commenting on different Issues from contending on one
 * workspace-wide blob. If comments later become prompt context, callers can
 * project this stable structure into markdown deliberately.
 */
import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js'
import { ISSUES_DIR_REL, parseIssueContent, type IssueRecord } from './declaration.js'

export interface IssueComment {
  id: string
  author: string
  at: string
  markdown: string
  /** A reply remains a first-class timeline entry while retaining the thread edge. */
  replyTo?: string
  /** Delivery is optional because comments on unowned Issues are durable notes only. */
  delivery?: IssueCommentDelivery
}

export type IssueCommentDelivery =
  | {
      state: 'pending'
      targetResumeId: string
      taskId: string
    }
  | {
      state: 'replied'
      targetResumeId: string
      taskId: string
      replyCommentId: string
    }
  | {
      state: 'failed'
      targetResumeId: string
      taskId?: string
      error: string
    }

const issueCommentDeliverySchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('pending'),
    targetResumeId: z.string().min(1),
    taskId: z.string().min(1),
  }),
  z.object({
    state: z.literal('replied'),
    targetResumeId: z.string().min(1),
    taskId: z.string().min(1),
    replyCommentId: z.string().min(1),
  }),
  z.object({
    state: z.literal('failed'),
    targetResumeId: z.string().min(1),
    taskId: z.string().min(1).optional(),
    error: z.string().min(1),
  }),
])

const issueCommentSchema = z.object({
  id: z.string().min(1),
  author: z.string().min(1),
  at: z.string().min(1),
  markdown: z.string().min(1),
  replyTo: z.string().min(1).optional(),
  delivery: issueCommentDeliverySchema.optional(),
})

const issueCommentsFileSchema = z.object({
  version: z.literal(1),
  issueId: z.string().min(1),
  comments: z.array(issueCommentSchema),
})

function issueRel(id: string): string {
  return `${ISSUES_DIR_REL}/${id}.md`
}

export function issueCommentsRel(id: string): string {
  return `${ISSUES_DIR_REL}/${id}.comments.json`
}

export async function readIssueComments(
  wsDir: string,
  id: string,
): Promise<{ ok: true; comments: IssueComment[] } | { ok: false; error: string }> {
  const raw = await readWorkspaceFile(wsDir, issueCommentsRel(id))
  if (raw === null) return { ok: true, comments: [] }
  try {
    const parsed = issueCommentsFileSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return { ok: false, error: `invalid comments sidecar: ${parsed.error.message}` }
    if (parsed.data.issueId !== id) return { ok: false, error: `comments sidecar belongs to ${parsed.data.issueId}` }
    return { ok: true, comments: parsed.data.comments }
  } catch (err) {
    return { ok: false, error: `invalid comments JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export type AppendIssueCommentResult =
  | { ok: true; issue: IssueRecord; comment: IssueComment }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; error: string }

export interface AppendIssueCommentOptions {
  /** Deterministic ids make asynchronously recorded agent replies idempotent. */
  id?: string
  at?: string
  replyTo?: string
  delivery?: IssueCommentDelivery
}

async function writeIssueComments(wsDir: string, id: string, comments: IssueComment[]): Promise<void> {
  const content = JSON.stringify({ version: 1, issueId: id, comments }, null, 2) + '\n'
  await writeWorkspaceFile(wsDir, issueCommentsRel(id), content)
}

export async function appendIssueComment(
  wsDir: string,
  id: string,
  author: string,
  text: string,
  options: AppendIssueCommentOptions = {},
): Promise<AppendIssueCommentResult> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) return { ok: false, reason: 'not_found' }
  const issueRaw = await readWorkspaceFile(wsDir, issueRel(id))
  if (issueRaw === null) return { ok: false, reason: 'not_found' }
  const issue = parseIssueContent(id, issueRaw)
  if (!issue.ok) return { ok: false, reason: 'invalid', error: issue.error }

  const markdown = text.trim()
  if (!author.trim() || !markdown) {
    return { ok: false, reason: 'invalid', error: 'author and comment markdown must be non-empty' }
  }
  const existing = await readIssueComments(wsDir, id)
  if (!existing.ok) return { ok: false, reason: 'invalid', error: existing.error }

  if (options.id) {
    const duplicate = existing.comments.find((comment) => comment.id === options.id)
    if (duplicate) return { ok: true, issue: issue.issue, comment: duplicate }
  }

  const comment: IssueComment = {
    id: options.id ?? `comment-${randomUUID()}`,
    author: author.trim(),
    at: options.at ?? new Date().toISOString(),
    markdown,
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    ...(options.delivery ? { delivery: options.delivery } : {}),
  }
  await writeIssueComments(wsDir, id, [...existing.comments, comment])
  return { ok: true, issue: issue.issue, comment }
}

export async function updateIssueCommentDelivery(
  wsDir: string,
  id: string,
  commentId: string,
  delivery: IssueCommentDelivery,
): Promise<{ ok: true; comment: IssueComment } | { ok: false; error: string }> {
  const existing = await readIssueComments(wsDir, id)
  if (!existing.ok) return existing
  const index = existing.comments.findIndex((comment) => comment.id === commentId)
  if (index < 0) return { ok: false, error: `comment not found: ${commentId}` }
  const comment = { ...existing.comments[index], delivery }
  const comments = [...existing.comments]
  comments[index] = comment
  await writeIssueComments(wsDir, id, comments)
  return { ok: true, comment }
}
