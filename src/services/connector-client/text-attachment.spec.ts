import { describe, expect, it } from 'vitest'
import iconv from 'iconv-lite'
import { normalizeConnectorTextAttachment } from './text-attachment.js'

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

describe('normalizeConnectorTextAttachment', () => {
  it('adds one language-neutral UTF-8 marker without changing Unicode text', () => {
    const markdown = '# 市场 / 市場 / 市場\n\n日本語 · 한국어 · العربية · Русский · Français\n'
    const result = normalizeConnectorTextAttachment(Buffer.from(markdown, 'utf8'), 'text/markdown')

    expect(result).toMatchObject({
      mediaType: 'text/markdown; charset=utf-8',
      detectedEncoding: 'UTF-8',
      detectionConfidence: 100,
    })
    expect(result.content.subarray(0, 3)).toEqual(UTF8_BOM)
    expect(result.content.subarray(3).toString('utf8')).toBe(markdown)
  })

  it('keeps an existing UTF-8 BOM singular', () => {
    const source = Buffer.concat([UTF8_BOM, Buffer.from('# Report\n')])
    const result = normalizeConnectorTextAttachment(source, 'text/markdown')
    expect(result.content).toEqual(source)
  })

  it('does not trust a UTF-8 BOM when the following bytes are invalid UTF-8', () => {
    const source = Buffer.concat([UTF8_BOM, Buffer.from([0xc3, 0x28])])
    const result = normalizeConnectorTextAttachment(source, 'text/markdown')

    expect(result.content).toEqual(source)
    expect(result.warning).toContain('could not be decoded safely')
  })

  it.each([
    ['UTF-16LE', 'utf16le'],
    ['UTF-16BE', 'utf16-be'],
    ['UTF-32LE', 'utf32-le'],
    ['UTF-32BE', 'utf32-be'],
  ] as const)('normalizes BOM-marked %s', (detectedEncoding, sourceEncoding) => {
    const markdown = '# Encoding report\n\nZażółć · 測試 · テスト\n'
    const source = iconv.encode(markdown, sourceEncoding, { addBOM: true })
    const result = normalizeConnectorTextAttachment(source, 'text/markdown')

    expect(result.detectedEncoding).toBe(detectedEncoding)
    expect(result.content.subarray(3).toString('utf8')).toBe(markdown)
  })

  it.each([
    ['GB18030', '# 测试报告\n\n今天市场整体偏观望，连接器应当正确识别中文。\n'],
    ['Big5', '# 測試報告\n\n今天市場整體偏觀望，連接器應當正確識別中文。\n'],
    ['Shift_JIS', '# テストレポート\n\n今日は市場全体が様子見で、コネクタは日本語を正しく認識する必要があります。\n'],
    ['windows-1252', '# “Café” costs €5\n\nA naïve façade should remain déjà vu.\n'],
    ['KOI8-R', '# Отчёт рынка\n\nСегодня рынок спокоен, кодировка определяется корректно.\n'],
  ] as const)('normalizes detected legacy %s without locale assumptions', (encoding, markdown) => {
    const source = iconv.encode(markdown, encoding)
    const result = normalizeConnectorTextAttachment(source, 'text/markdown')

    expect(result.warning).toBeUndefined()
    expect(result.detectedEncoding).toBe(encoding)
    expect(result.content.subarray(0, 3)).toEqual(UTF8_BOM)
    expect(result.content.subarray(3).toString('utf8')).toBe(markdown)
  })

  it('keeps unrecognizable binary-like bytes intact and reports the ambiguity', () => {
    const source = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x80, 0x81, 0x82, 0x83])
    const result = normalizeConnectorTextAttachment(source, 'text/markdown')

    expect(result.content).toEqual(source)
    expect(result.mediaType).toBe('text/markdown')
    expect(result.warning).toContain('could not be determined safely')
  })

  it('uses the HTML media type without changing the report body', () => {
    const html = '<!doctype html><html><body><h1>市場</h1></body></html>\n'
    const result = normalizeConnectorTextAttachment(Buffer.from(html, 'utf8'), 'text/html')

    expect(result.mediaType).toBe('text/html; charset=utf-8')
    expect(result.content.subarray(0, 3)).toEqual(UTF8_BOM)
    expect(result.content.subarray(3).toString('utf8')).toBe(html)
  })
})
