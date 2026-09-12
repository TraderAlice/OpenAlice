import { describe, expect, it } from 'vitest'
import { inboxFiles, parseContentReferences, parseMarketReference } from './content-references.js'

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

it('parses market identities at the last slash without indexing them as files', () => {
  const path = 'market/okx|BTC/USDT:USDT/4h'
  expect(parseMarketReference(path)).toEqual({ barId: 'okx|BTC/USDT:USDT', interval: '4h' })
  const body = `Before [[${path}]] after [[report.pdf]]`
  expect(parseContentReferences(body).references.map(ref => body.slice(ref.start, ref.end))).toEqual([`[[${path}]]`, '[[report.pdf]]'])
  expect(inboxFiles({ body })).toEqual([{ path: 'report.pdf' }])
  for (const invalid of ['market/foo/1d', 'market/a|b/2m', 'market/|b/1d', 'market/a|/1d']) {
    expect(parseMarketReference(invalid)).toBeNull()
    expect(parseContentReferences(`[[${invalid}]]`).references).toEqual([])
  }
  expect(parseContentReferences('`[[market/a|b/1d]]`').references).toEqual([])
})
