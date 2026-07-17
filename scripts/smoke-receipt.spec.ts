import { describe, expect, it } from 'vitest'

import { failedReceiptChecks } from './smoke-receipt.mjs'

describe('failedReceiptChecks', () => {
  it('accepts only explicit true receipt checks', () => {
    expect(failedReceiptChecks({ checks: { persisted: true, firstFrame: false, canonical: 'yes' } }))
      .toEqual(['firstFrame', 'canonical'])
  })

  it('treats a missing check map as empty', () => {
    expect(failedReceiptChecks({})).toEqual([])
  })
})
