import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ConnectorClient, OWNER_CHAT_TEXT_MAX } from '@traderalice/connector-protocol'

import { resolveConnectorUrl } from '../../services/connector-client/index.js'
import type { HeadlessTaskTrigger, HeadlessTaskInquiry } from '../headless-task-registry.js'
import type { HeadlessTurnProgress } from '../headless-progress.js'
import type { IssueComment } from './comments.js'
import {
  ISSUES_DIR_REL,
  isTelegramConnectorIssue,
  parseIssueContent,
  type IssueRecord,
} from './declaration.js'

export const TELEGRAM_NO_REPLY_TAG = '[[no-reply]]'

const MAX_PROGRESS_SCOPES = 64
const sentByScope = new Map<string, Set<string>>()

export function containsTelegramNoReply(text: string): boolean {
  return text.includes(TELEGRAM_NO_REPLY_TAG)
}

export function normalizeDeskText(text: string): string {
  return text.trim().slice(0, OWNER_CHAT_TEXT_MAX)
}

/**
 * Texts that are safe to ship before the turn finishes.
 *
 * A text block is sealed only when a tool or error follows it. Consecutive
 * text blocks are treated as one growing narration: only the last one before
 * the non-text block is sent, so streamed chunks do not each become a DM.
 * The trailing text stays with today's final comment / `assistantText`.
 */
export function sealedProgressTexts(progress: HeadlessTurnProgress): string[] {
  const sealed: string[] = []
  const { blocks } = progress
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block?.type !== 'text') continue
    const next = blocks[i + 1]
    if (!next || next.type === 'text') continue
    const text = normalizeDeskText(block.text)
    if (!text || containsTelegramNoReply(text)) continue
    sealed.push(text)
  }
  return sealed
}

export function deskProgressMessageId(scopeId: string, text: string): string {
  const digest = createHash('sha256').update(text).digest('base64url').slice(0, 12)
  return `desk-progress-${scopeId}-${digest}`
}

export function deskProgressScope(task: {
  readonly taskId: string
  readonly inquiry?: Pick<HeadlessTaskInquiry, 'subject'>
  readonly trigger?: HeadlessTaskTrigger
}): { workspaceId: string; issueId: string; scopeId: string } | null {
  const subject = task.inquiry?.subject
  if (subject?.kind === 'issue') {
    return {
      workspaceId: subject.workspaceId,
      issueId: subject.issueId,
      scopeId: subject.commentId ?? task.taskId,
    }
  }
  const trigger = task.trigger
  if (trigger?.kind === 'issue') {
    return {
      workspaceId: trigger.workspaceId,
      issueId: trigger.issueId,
      scopeId: task.taskId,
    }
  }
  return null
}

export function alreadyProjectedDeskText(scopeId: string, text: string): boolean {
  return sentByScope.get(scopeId)?.has(normalizeDeskText(text)) === true
}

export function forgetProjectedDeskTexts(scopeId: string): void {
  sentByScope.delete(scopeId)
}

/** Test-only: drop in-memory desk-progress dedup. */
export function resetProjectedDeskTexts(): void {
  sentByScope.clear()
}

function markProjectedDeskText(scopeId: string, text: string): void {
  let seen = sentByScope.get(scopeId)
  if (!seen) {
    if (sentByScope.size >= MAX_PROGRESS_SCOPES) {
      const oldest = sentByScope.keys().next().value
      if (oldest !== undefined) sentByScope.delete(oldest)
    }
    seen = new Set()
    sentByScope.set(scopeId, seen)
  }
  seen.add(text)
}

export function shouldProjectDeskComment(
  issue: { telegramConnector?: true },
  comment: IssueComment,
  opts?: { progressScopeId?: string },
): boolean {
  if (!isTelegramConnectorIssue(issue) || comment.via === 'telegram') return false
  if (containsTelegramNoReply(comment.markdown)) return false
  const scope = opts?.progressScopeId ?? comment.replyTo
  if (scope && alreadyProjectedDeskText(scope, comment.markdown)) return false
  return true
}

export async function projectDeskComment(
  issue: { telegramConnector?: true },
  comment: IssueComment,
  client: ConnectorClient = new ConnectorClient(resolveConnectorUrl()),
  opts?: { progressScopeId?: string },
): Promise<void> {
  const scope = opts?.progressScopeId ?? comment.replyTo
  try {
    if (!shouldProjectDeskComment(issue, comment, { progressScopeId: scope })) return
    await client.sendOwnerMessage({
      id: `desk-${comment.id}`,
      adapterId: 'telegram',
      text: normalizeDeskText(comment.markdown),
    }, AbortSignal.timeout(5_000))
  } finally {
    if (scope) forgetProjectedDeskTexts(scope)
  }
}

export async function projectDeskTurnProgress(input: {
  issue: Pick<IssueRecord, 'telegramConnector' | 'status'>
  scopeId: string
  progress: HeadlessTurnProgress
  client?: ConnectorClient
}): Promise<string[]> {
  if (!isTelegramConnectorIssue(input.issue) || input.issue.status === 'canceled') return []
  const client = input.client ?? new ConnectorClient(resolveConnectorUrl())
  const sent: string[] = []
  for (const text of sealedProgressTexts(input.progress)) {
    if (alreadyProjectedDeskText(input.scopeId, text)) continue
    await client.sendOwnerMessage({
      id: deskProgressMessageId(input.scopeId, text),
      adapterId: 'telegram',
      text,
    }, AbortSignal.timeout(5_000))
    markProjectedDeskText(input.scopeId, text)
    sent.push(text)
  }
  return sent
}

export async function projectWorkspaceDeskTurnProgress(input: {
  wsDir: string
  issueId: string
  scopeId: string
  progress: HeadlessTurnProgress
  client?: ConnectorClient
}): Promise<string[]> {
  const issue = await readDeskIssue(input.wsDir, input.issueId)
  if (!issue) return []
  return projectDeskTurnProgress({ ...input, issue })
}

async function readDeskIssue(wsDir: string, issueId: string): Promise<IssueRecord | null> {
  try {
    const raw = await readFile(join(wsDir, ISSUES_DIR_REL, `${issueId}.md`), 'utf8')
    const parsed = parseIssueContent(issueId, raw)
    return parsed.ok ? parsed.issue : null
  } catch {
    return null
  }
}
