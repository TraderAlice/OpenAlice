import { Api } from 'grammy'
import { describe, expect, it } from 'vitest'

describe('grammy Bot API 10.1 rich-message surface', () => {
  it('exposes sendRichMessage and sendRichMessageDraft on Api', () => {
    expect(typeof Api.prototype.sendRichMessage).toBe('function')
    expect(typeof Api.prototype.sendRichMessageDraft).toBe('function')
  })

  it('types html and markdown payloads as sendRichMessage input', () => {
    const html: Parameters<Api['sendRichMessage']>[1] = { html: '<b>hello</b>' }
    const markdown: Parameters<Api['sendRichMessage']>[1] = { markdown: '*hello*' }
    expect(html).toEqual({ html: '<b>hello</b>' })
    expect(markdown).toEqual({ markdown: '*hello*' })
  })
})
