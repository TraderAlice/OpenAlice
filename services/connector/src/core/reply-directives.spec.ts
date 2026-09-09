import { expect, it } from 'vitest'
import { parseReplyDirectives as parse, renderReplyReferences, replyMedia } from './reply-directives.js'
it('resolves only successful references, retaining unknown and missing paths', () => {
  const text = 'Report [[report/日报.pdf]] [[report/日报.pdf]] [[missing.png]] [[daily]]'
  const parsed = parse(text)
  expect(parsed.references.map(r => r.path)).toEqual(['report/日报.pdf', 'report/日报.pdf', 'missing.png'])
  expect(renderReplyReferences(text, parsed.references, new Set(['report/日报.pdf']))).toBe('Report   [[missing.png]] [[daily]]')
})
it('keeps code, escaped brackets and incomplete references literal', () => {
  for (const text of ['`[[a.png]]`', '`example\n[[a.png]]`', '```text\n[[a.png]]\n```', '~~~\n[[no-reply]]\n~~~', '\\[[a.png]]', '[[unfinished.png']) {
    expect(parse(text)).toEqual({ references: [], silent: false })
  }
})
it('rejects absolute paths, traversal, URLs and unknown extensions', () => {
  expect(parse('[[/tmp/a.png]] [[../a.png]] [[https://a/a.png]] [[file:a.png]] [[note|a.pdf]]').references).toEqual([])
})
it('recognizes silence without interpreting its source', () => {
  expect(parse('[[no-reply]] quiet').silent).toBe(true)
  expect(parse('`[[no-reply]]`').silent).toBe(false)
})
it('selects presentation by directory convention and file type', () => {
  expect(replyMedia('sticker/hello.webp')).toBe('sticker')
  expect(replyMedia('sticker/hello.png')).toBe('sticker')
  expect(replyMedia('report/chart.PNG')).toBe('image')
  expect(replyMedia('report/weekly.pdf')).toBe('file')
  expect(replyMedia('sticker/notes.txt')).toBe('file')
})
