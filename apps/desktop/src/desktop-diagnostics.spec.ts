import { describe, expect, it } from 'vitest'
import { BoundedTextTail, conciseDiagnosticTail } from './desktop-diagnostics.js'

describe('desktop diagnostics', () => {
  it('keeps only the bounded end of child output', () => {
    const tail = new BoundedTextTail(8)
    tail.append('12345')
    tail.append(Buffer.from('67890'))
    expect(tail.text()).toBe('34567890')
  })

  it('formats the last meaningful lines for a native error dialog', () => {
    expect(conciseDiagnosticTail('\nfirst\nsecond\nthird\n', 2)).toBe('second\nthird')
  })
})
