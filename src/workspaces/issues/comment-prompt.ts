/**
 * How a comment becomes the reply Input Prompt.
 *
 * Omitted frontmatter keeps the historical wrapper. An override replaces that
 * whole structure. Chat-style Issues set `{comment}` and nothing else.
 */
export const ISSUE_COMMENT_PROMPT_TOKENS = [
  'comment',
  'title',
  'id',
  'workspaceId',
  'author',
  'what',
] as const

export type IssueCommentPromptToken = typeof ISSUE_COMMENT_PROMPT_TOKENS[number]

export const ISSUE_COMMENT_PROMPT_MAX = 8_000

export const DEFAULT_ISSUE_COMMENT_PROMPT = [
  'A new comment was left on Issue {workspaceId}/{id} ({title}) by {author}.',
  '',
  '{comment}',
  '',
  'Reply directly to this comment. Your final assistant response will be recorded automatically in the Issue Activity timeline.',
  'Do not call `alice-workspace issue comment` for this reply; that would create a second notification loop.',
].join('\n')

const TOKEN_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g
const KNOWN = new Set<string>(ISSUE_COMMENT_PROMPT_TOKENS)

export type IssueCommentPromptVars = Record<IssueCommentPromptToken, string>

export function parseIssueCommentPrompt(
  value: string,
): { ok: true; template: string } | { ok: false; error: string } {
  const template = value.trim()
  if (!template) return { ok: false, error: 'commentPrompt must be a non-empty template or omitted' }
  if (template.length > ISSUE_COMMENT_PROMPT_MAX) {
    return { ok: false, error: `commentPrompt must be at most ${ISSUE_COMMENT_PROMPT_MAX} characters` }
  }
  const unknown = new Set<string>()
  let sawComment = false
  for (const match of template.matchAll(TOKEN_RE)) {
    const token = match[1]
    if (!token) continue
    if (!KNOWN.has(token)) unknown.add(token)
    if (token === 'comment') sawComment = true
  }
  if (unknown.size > 0) {
    return {
      ok: false,
      error: `commentPrompt has unknown tokens: ${[...unknown].sort().map((token) => `{${token}}`).join(', ')}`,
    }
  }
  if (!sawComment) return { ok: false, error: 'commentPrompt must include {comment}' }
  return { ok: true, template }
}

export function renderIssueCommentPrompt(
  template: string | undefined,
  vars: IssueCommentPromptVars,
): string {
  const source = template ?? DEFAULT_ISSUE_COMMENT_PROMPT
  return source.replace(TOKEN_RE, (raw, token: string) => (
    Object.prototype.hasOwnProperty.call(vars, token)
      ? vars[token as IssueCommentPromptToken]
      : raw
  ))
}
