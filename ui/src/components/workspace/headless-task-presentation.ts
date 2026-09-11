import type { HeadlessTaskRecord } from '../../api/headless'
import { readableIssueIdentity } from './harness-session-presentation'

const SUMMARY_LENGTH = 96

export interface HeadlessTaskPresentation {
  readonly title: string
  readonly summary?: string
}

export function summarizeHeadlessTaskText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Untitled task'
  const characters = Array.from(normalized)
  if (characters.length <= SUMMARY_LENGTH) return normalized
  return `${characters.slice(0, SUMMARY_LENGTH - 1).join('').trimEnd()}…`
}

/**
 * Public run identity comes from business provenance. The delivered prompt may
 * contain reconstruction policy and raw target JSON, so it is diagnostic-only
 * whenever Issue or inquiry metadata is available.
 */
export function projectHeadlessTaskPresentation(
  task: Pick<HeadlessTaskRecord, 'inquiry' | 'prompt' | 'trigger'>,
): HeadlessTaskPresentation {
  const issueId = task.trigger?.issueId
    ?? (task.inquiry?.subject.kind === 'issue' ? task.inquiry.subject.issueId : undefined)
  const question = task.inquiry?.question.trim()

  if (issueId) {
    return {
      title: readableIssueIdentity(issueId),
      ...(question ? { summary: summarizeHeadlessTaskText(question) } : {}),
    }
  }
  if (question) return { title: summarizeHeadlessTaskText(question) }
  return { title: summarizeHeadlessTaskText(task.prompt) }
}
