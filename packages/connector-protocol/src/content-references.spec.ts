import { describe, expect, it } from 'vitest'
import { inboxFiles, parseContentReferences } from './content-references.js'

describe('shared content references', () => {
  it('retains source offsets/order while deriving a unique file index', () => {
    const body = 'Before [[reports/Case.PDF]] middle [[images/photo.png]] after [[reports/Case.PDF]]'
    const { references } = parseContentReferences(body)
    expect(references.map(ref => body.slice(ref.start, ref.end))).toEqual(['[[reports/Case.PDF]]', '[[images/photo.png]]', '[[reports/Case.PDF]]'])
    expect(inboxFiles({ body, fileRevisions: { 'reports/Case.PDF': 'sha256:abc' } })).toEqual([{ path: 'reports/Case.PDF', revision: 'sha256:abc' }, { path: 'images/photo.png' }])
  })
  it('ignores literal code, escapes, entity links and paths escaping the Workspace', () => {
    const body = '`[[inline.md]]`\n```md\n[[fenced.md]]\n```\n\\[[escaped.md]] [[NVDA]] [[../private.md]] [[/absolute.pdf]] [[https://example.com/a.pdf]] [[./README]]'
    expect(inboxFiles({ body })).toEqual([{ path: './README' }])
  })
  it('does not turn Inbox no-reply into content removal', () => {
    expect(inboxFiles({ body: '[[no-reply]] text [[a.pdf]]' })).toEqual([{ path: 'a.pdf' }])
  })
})
