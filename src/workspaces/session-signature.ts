/**
 * OpenAlice Session signatures are human-readable, product-owned identities.
 *
 * A signature is written as `@<resumeId>` in self-contained artifacts. The
 * leading `@` is presentation/authoring syntax; ResumeRegistry continues to
 * store the bare resumeId. Convenience aliases (`@me`, `@workspace`) are never
 * persisted as an exact Session identity: callers resolve `@me` at write time.
 */

export const WORKSPACE_ASSIGNEE = '@workspace' as const
export const HUMAN_ASSIGNEE = '@human' as const
export const UNASSIGNED_ASSIGNEE = '@unassigned' as const

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
  if (lower === '@workspace' || lower === 'workspace') return WORKSPACE_ASSIGNEE
  if (lower === '@human' || lower === 'human') return HUMAN_ASSIGNEE
  if (lower === '@unassigned' || lower === 'unassigned') return UNASSIGNED_ASSIGNEE
  return trimmed
}

