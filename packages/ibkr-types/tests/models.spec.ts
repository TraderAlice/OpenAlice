/**
 * Tests for data model construction and defaults.
 */

import { describe, it, expect } from 'vitest'
import { Contract, ContractDetails, ComboLeg } from '../src/contract.js'
import { Order } from '../src/order.js'
import { OrderState } from '../src/order-state.js'
import { Execution, ExecutionFilter } from '../src/execution.js'
import { TagValue } from '../src/tag-value.js'
import { SoftDollarTier } from '../src/softdollartier.js'
import { UNSET_DOUBLE, UNSET_INTEGER, UNSET_DECIMAL } from '../src/const.js'

describe('Contract', () => {
  it('has sensible defaults', () => {
    const c = new Contract()
    expect(c.conId).toBe(0)
    expect(c.symbol).toBe('')
    expect(c.secType).toBe('')
    expect(c.strike).toBe(UNSET_DOUBLE)
    expect(c.comboLegs).toEqual([])
    expect(c.deltaNeutralContract).toBeNull()
  })

  it('toString includes symbol', () => {
    const c = new Contract()
    c.symbol = 'AAPL'
    c.secType = 'STK'
    expect(c.toString()).toContain('AAPL')
  })
})

describe('Order', () => {
  it('has sensible defaults', () => {
    const o = new Order()
    expect(o.orderId).toBe(0)
    expect(o.action).toBe('')
    expect(o.orderType).toBe('')
    expect(o.lmtPrice.equals(UNSET_DECIMAL)).toBe(true)
    expect(o.auxPrice.equals(UNSET_DECIMAL)).toBe(true)
    expect(o.transmit).toBe(true)
  })
})

describe('TagValue', () => {
  it('toString produces wire format', () => {
    const tv = new TagValue('key', 'value')
    expect(tv.toString()).toBe('key=value;')
  })

  it('defaults to empty strings', () => {
    const tv = new TagValue()
    expect(tv.tag).toBe('')
    expect(tv.value).toBe('')
  })
})

describe('SoftDollarTier', () => {
  it('constructs with defaults', () => {
    const sdt = new SoftDollarTier()
    expect(sdt.name).toBe('')
    expect(sdt.val).toBe('')
    expect(sdt.displayName).toBe('')
  })
})

describe('ComboLeg', () => {
  it('constructs with defaults', () => {
    const cl = new ComboLeg()
    expect(cl.conId).toBe(0)
    expect(cl.ratio).toBe(0)
    expect(cl.action).toBe('')
  })
})

describe('ExecutionFilter', () => {
  it('constructs with defaults', () => {
    const ef = new ExecutionFilter()
    expect(ef.clientId).toBe(0)
    expect(ef.acctCode).toBe('')
    expect(ef.symbol).toBe('')
  })
})
