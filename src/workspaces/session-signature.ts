/**
 * OpenAlice Session signatures are human-readable, product-owned identities.
 *
 * A signature is written as `@<resumeId>` in self-contained artifacts. The
 * leading `@` is presentation/authoring syntax; ResumeRegistry continues to
 * store the bare resumeId. The `@me` convenience alias is never persisted as
 * an exact Session identity: callers resolve it at write time.
 */

/** Recruit a fresh Session for every scheduled fire. */
export const NEW_EACH_RUN_ASSIGNEE = '@new-each-run' as const
/** Recruit one fresh Session, then persist that Session as the exact owner. */
export const NEW_THEN_RESUME_ASSIGNEE = '@new-then-resume' as const
export const HUMAN_ASSIGNEE = '@human' as const
export const UNASSIGNED_ASSIGNEE = '@unassigned' as const

/** @deprecated Read/migration compatibility only. Never write this value. */
export const DEPRECATED_WORKSPACE_ASSIGNEE = '@workspace' as const
/** @deprecated Read/migration compatibility only. Never write this value. */
export const DEPRECATED_NEW_ASSIGNEE = '@new' as const

export function sessionSignature(resumeId: string): string {
  return `@${resumeId}`
}

export function resumeIdFromSignature(value: string): string | null {
  if (!value.startsWith('@resume-')) return null
  const resumeId = value.slice(1)
  return resumeId && !/\s/.test(resumeId) ? resumeId : null
}

export function normalizeIssueAssigneeAlias(value: string): string {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (lower === '@new-each-run' || lower === 'new-each-run') return NEW_EACH_RUN_ASSIGNEE
  if (lower === '@new-then-resume' || lower === 'new-then-resume') return NEW_THEN_RESUME_ASSIGNEE
  if (lower === '@human' || lower === 'human') return HUMAN_ASSIGNEE
  if (lower === '@unassigned' || lower === 'unassigned') return UNASSIGNED_ASSIGNEE
  return trimmed
}

/** Replacement hint for retired assignee spellings. Writers reject these. */
export function deprecatedIssueAssigneeReplacement(value: string): string | null {
  const lower = value.trim().toLowerCase()
  if (lower === '@workspace' || lower === 'workspace') return NEW_EACH_RUN_ASSIGNEE
  if (lower === '@new' || lower === 'new') return NEW_THEN_RESUME_ASSIGNEE
  return null
}
