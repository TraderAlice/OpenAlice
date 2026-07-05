import { describe, it, expect } from 'vitest'
import {
  stripImageData,
  buildChatHistoryPrompt,
  DEFAULT_MAX_HISTORY,
} from './utils.js'

// ==================== stripImageData ====================

describe('stripImageData', () => {
  it('should return non-JSON strings as-is', () => {
    expect(stripImageData('hello world')).toBe('hello world')
  })

  it('should return non-array JSON as-is', () => {
    const obj = JSON.stringify({ type: 'text', text: 'hi' })
    expect(stripImageData(obj)).toBe(obj)
  })

  it('should return array with no image blocks as-is', () => {
    const arr = JSON.stringify([{ type: 'text', text: 'hi' }])
    expect(stripImageData(arr)).toBe(arr)
  })

  it('should strip image blocks with source.data', () => {
    const input = JSON.stringify([
      { type: 'text', text: 'before' },
      { type: 'image', source: { data: 'base64...' } },
      { type: 'text', text: 'after' },
    ])
    const result = JSON.parse(stripImageData(input))
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ type: 'text', text: 'before' })
    expect(result[1]).toEqual({ type: 'text', text: '[Image saved to disk — use Read tool to view the file]' })
    expect(result[2]).toEqual({ type: 'text', text: 'after' })
  })

  it('should not strip image blocks without source.data', () => {
    const input = JSON.stringify([
      { type: 'image', source: { url: 'https://example.com/img.png' } },
    ])
    expect(stripImageData(input)).toBe(input)
  })

  it('should handle multiple image blocks', () => {
    const input = JSON.stringify([
      { type: 'image', source: { data: 'aaa' } },
      { type: 'image', source: { data: 'bbb' } },
    ])
    const result = JSON.parse(stripImageData(input))
    expect(result).toHaveLength(2)
    expect(result.every((b: { type: string }) => b.type === 'text')).toBe(true)
  })
})

// ==================== buildChatHistoryPrompt ====================

describe('buildChatHistoryPrompt', () => {
  it('should return prompt as-is when history is empty', () => {
    expect(buildChatHistoryPrompt('hello', [])).toBe('hello')
  })

  it('should wrap history in chat_history tags', () => {
    const result = buildChatHistoryPrompt('hello', [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hey' },
    ])
    expect(result).toContain('<chat_history>')
    expect(result).toContain('</chat_history>')
    expect(result).toContain('[User] hi')
    expect(result).toContain('[Bot] hey')
    expect(result).toMatch(/hello$/)
  })

  it('should use custom preamble', () => {
    const result = buildChatHistoryPrompt('q', [{ role: 'user', text: 'x' }], 'CUSTOM PREAMBLE')
    expect(result).toContain('CUSTOM PREAMBLE')
    expect(result).not.toContain('recent conversation history')
  })

  it('should use default preamble when none provided', () => {
    const result = buildChatHistoryPrompt('q', [{ role: 'user', text: 'x' }])
    expect(result).toContain('recent conversation history')
  })
})

// ==================== Constants ====================

describe('constants', () => {
  it('should have a positive DEFAULT_MAX_HISTORY', () => {
    expect(DEFAULT_MAX_HISTORY).toBeGreaterThan(0)
  })
})
