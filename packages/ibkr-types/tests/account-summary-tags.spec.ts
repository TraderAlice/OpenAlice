/**
 * Mirrors: tests/test_account_summary_tags.py
 */

import { describe, it, expect } from 'vitest'
import { AccountSummaryTags, AllTags } from '../src/account-summary-tags.js'

describe('AccountSummaryTags', () => {
  it('AllTags is a comma-separated list of all tag values', () => {
    const tags = AllTags.split(',')
    expect(tags.length).toBe(29)
    expect(tags).toContain('NetLiquidation')
    expect(tags).toContain('BuyingPower')
    expect(tags).toContain('Leverage')
  })

  it('individual tags match their key names', () => {
    expect(AccountSummaryTags.NetLiquidation).toBe('NetLiquidation')
    expect(AccountSummaryTags.AccountType).toBe('AccountType')
  })
})
