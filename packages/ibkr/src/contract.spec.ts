import { describe, it, expect } from 'vitest'
import { Contract } from './contract.js'

describe('Contract', () => {
  it('toString includes symbol', () => {
    const c = new Contract()
    c.symbol = 'AAPL'
    c.secType = 'STK'
    expect(c.toString()).toContain('AAPL')
  })
})
