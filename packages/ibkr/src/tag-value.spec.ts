import { describe, it, expect } from 'vitest'
import { TagValue } from './tag-value.js'

describe('TagValue', () => {
  it('toString produces wire format', () => {
    const tv = new TagValue('key', 'value')
    expect(tv.toString()).toBe('key=value;')
  })
})
