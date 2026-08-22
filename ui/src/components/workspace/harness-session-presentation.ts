import type { SessionCreatedBy, SessionRecord, WorkspaceSessionDirectoryEntry } from './api'

const PREVIEW_TITLE_LIMIT = 48
const ISSUE_ID_SPLIT = /[-_]+/u

export type HarnessSessionSourceKind = Extract<SessionCreatedBy['kind'], 'issue' | 'headless' | 'conversation'>

export type HarnessSessionSourceMessageKey =
  | 'workspace.sessionSource.issue'
  | 'workspace.sessionSource.headless'
  | 'workspace.sessionSource.conversation'

export interface HarnessSessionPresentation {
  readonly title: string
  readonly sourceKind?: HarnessSessionSourceKind
  /** Raw Issue id for tooltips, search, and busy-state copy. */
  readonly issueId?: string
}

export function shortResumeId(resumeId: string): string {
  const trimmed = resumeId.replace(/^resume-/, '')
  return trimmed.length <= 12 ? trimmed : trimmed.slice(0, 12)
}

/** Turn a stable kebab/snake Issue id into a scannable roster title. */
export function readableIssueIdentity(issueId: string): string {
  const trimmed = issueId.trim()
  if (!trimmed) return trimmed
  const parts = trimmed.split(ISSUE_ID_SPLIT).filter(Boolean)
  if (parts.length === 0) return trimmed
  return parts.map(titleCaseIssuePart).join(' ')
}

export function projectHarnessSessionPresentation(
  session: SessionRecord | null,
  entry: WorkspaceSessionDirectoryEntry | null,
): HarnessSessionPresentation {
  const createdBy = entry?.createdBy
  const sourceKind = sourceKindFrom(createdBy)
  const birthIssueId = createdBy?.kind === 'issue' ? createdBy.issueId.trim() : ''
  const conversationIssueId = createdBy?.kind === 'conversation'
    && isIssueSubject(createdBy.subject)
    ? createdBy.subject.issueId.trim()
    : ''
  const executionIssueId = entry?.latestExecution?.issueId?.trim() ?? ''
  const legacyHeadlessIssueId = !createdBy
    && executionIssueId
    && (session === null || session.surface === 'headless')
    ? executionIssueId
    : ''
  const issueId = birthIssueId || conversationIssueId || legacyHeadlessIssueId || executionIssueId || undefined

  const labeled = (
    title: string,
    extras: Pick<HarnessSessionPresentation, 'sourceKind' | 'issueId'> = {},
  ): HarnessSessionPresentation => ({
    title,
    ...(extras.sourceKind ? { sourceKind: extras.sourceKind } : {}),
    ...(extras.issueId ? { issueId: extras.issueId } : {}),
  })
  const withProvenance = (title: string): HarnessSessionPresentation => labeled(title, {
    ...(sourceKind ? { sourceKind } : {}),
    ...(issueId ? { issueId } : {}),
  })

  const coworkerName = session?.displayName?.trim() || entry?.displayName?.trim()
  if (coworkerName) return withProvenance(coworkerName)

  // Issue birth is roster identity. Do not surface the launch prompt, native
  // title seeded from that prompt, or a later assistant preview as the name.
  if (birthIssueId) {
    return labeled(readableIssueIdentity(birthIssueId), {
      sourceKind: 'issue',
      issueId: birthIssueId,
    })
  }

  // A follow-up reconstructed from an Issue is a conversation, but its stable
  // subject is still more useful roster identity than the reconstruction
  // prompt used to launch the worker.
  if (conversationIssueId) {
    return labeled(readableIssueIdentity(conversationIssueId), {
      sourceKind: 'conversation',
      issueId: conversationIssueId,
    })
  }

  // Session records created before immutable birth provenance shipped still
  // retain execution provenance in the Directory. Limit this fallback to
  // headless rows so a later Issue run cannot rename a normal interactive chat.
  if (legacyHeadlessIssueId) {
    return labeled(readableIssueIdentity(legacyHeadlessIssueId), {
      sourceKind: 'issue',
      issueId: legacyHeadlessIssueId,
    })
  }

  const interactiveTitle = session?.title?.trim() || entry?.interactive?.title?.trim()
  if (interactiveTitle) return withProvenance(interactiveTitle)

  const preview = entry?.latestExecution?.assistantPreview?.replace(/\s+/g, ' ').trim()
  if (preview) {
    const title = preview.length > PREVIEW_TITLE_LIMIT
      ? `${preview.slice(0, PREVIEW_TITLE_LIMIT - 1)}…`
      : preview
    return withProvenance(title)
  }

  if (executionIssueId) {
    return labeled(readableIssueIdentity(executionIssueId), {
      ...(sourceKind ? { sourceKind } : {}),
      issueId: executionIssueId,
    })
  }

  if (session?.name.trim()) return withProvenance(session.name.trim())
  return withProvenance(shortResumeId(session?.resumeId ?? entry?.resumeId ?? 'session'))
}

export function harnessSessionSourceLabel(
  sourceKind: HarnessSessionSourceKind | undefined,
  t: (key: HarnessSessionSourceMessageKey) => string,
): string | undefined {
  if (sourceKind === 'issue') return t('workspace.sessionSource.issue')
  if (sourceKind === 'headless') return t('workspace.sessionSource.headless')
  if (sourceKind === 'conversation') return t('workspace.sessionSource.conversation')
  return undefined
}

/** One quiet subtitle line: source context, then Workspace when the surface needs it. */
export function composeHarnessSessionSubtitle(
  ...parts: Array<string | undefined>
): string | undefined {
  const unique: string[] = []
  for (const part of parts) {
    const trimmed = part?.replace(/\s+/g, ' ').trim()
    if (!trimmed || unique.includes(trimmed)) continue
    unique.push(trimmed)
  }
  return unique.length > 0 ? unique.join(' · ') : undefined
}

export function harnessSessionRosterSubtitle(
  sourceKind: HarnessSessionSourceKind | undefined,
  t: (key: HarnessSessionSourceMessageKey) => string,
  workspaceLabel?: string,
): string | undefined {
  return composeHarnessSessionSubtitle(harnessSessionSourceLabel(sourceKind, t), workspaceLabel)
}

function sourceKindFrom(createdBy: SessionCreatedBy | undefined): HarnessSessionSourceKind | undefined {
  if (createdBy?.kind === 'issue' || createdBy?.kind === 'headless' || createdBy?.kind === 'conversation') {
    return createdBy.kind
  }
  return undefined
}

function isIssueSubject(value: unknown): value is { readonly kind: 'issue'; readonly issueId: string } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { readonly kind?: unknown; readonly issueId?: unknown }
  return candidate.kind === 'issue' && typeof candidate.issueId === 'string'
}

function titleCaseIssuePart(part: string): string {
  if (part.length === 0) return part
  if (part === part.toUpperCase() && /[A-Za-z]/.test(part)) return part
  if (!/[A-Za-z]/.test(part)) return part
  return part.charAt(0).toUpperCase() + part.slice(1)
}
