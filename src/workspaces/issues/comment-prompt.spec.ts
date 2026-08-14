import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ISSUE_COMMENT_PROMPT,
  parseIssueCommentPrompt,
  renderIssueCommentPrompt,
} from './comment-prompt.js'

const vars = {
  comment: 'What changed?',
  title: 'Audit the close',
  id: 'audit',
  workspaceId: 'ws-home',
  author: 'human',
  what: 'Inspect the close.',
}

describe('parseIssueCommentPrompt', () => {
  it('accepts a chat pass-through', () => {
    expect(parseIssueCommentPrompt('{comment}')).toEqual({ ok: true, template: '{comment}' })
  })

  it('rejects a template that drops the comment', () => {
    expect(parseIssueCommentPrompt('{title} only')).toMatchObject({
      ok: false,
      error: expect.stringContaining('{comment}'),
    })
  })

  it('rejects unknown tokens', () => {
    expect(parseIssueCommentPrompt('{comment} {slack}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('{slack}'),
    })
  })

  it('rejects a blank override', () => {
    expect(parseIssueCommentPrompt('   ')).toMatchObject({ ok: false })
  })
})

describe('renderIssueCommentPrompt', () => {
  it('keeps the historical wrapper when the field is omitted', () => {
    expect(renderIssueCommentPrompt(undefined, vars)).toBe(
      DEFAULT_ISSUE_COMMENT_PROMPT
        .replace('{workspaceId}', 'ws-home')
        .replace('{id}', 'audit')
        .replace('{title}', 'Audit the close')
        .replace('{author}', 'human')
        .replace('{comment}', 'What changed?'),
    )
  })

  it('passes the comment through when the template is only {comment}', () => {
    expect(renderIssueCommentPrompt('{comment}', vars)).toBe('What changed?')
  })

  it('does not rescan values for tokens', () => {
    expect(renderIssueCommentPrompt('{comment}', {
      ...vars,
      comment: 'see {what}',
    })).toBe('see {what}')
  })
})
