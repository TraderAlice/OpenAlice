/**
 * Mirrors: tests/test_order_conditions.py
 */

import { describe, it, expect } from 'vitest'
import {
  VolumeCondition,
  PercentChangeCondition,
  PriceCondition,
  TimeCondition,
  MarginCondition,
  ExecutionCondition,
  TriggerMethodEnum,
  Create,
  OrderCondition,
} from '../src/order-condition.js'

describe('OrderCondition', () => {
  it('can construct all condition types', () => {
    const vol = new VolumeCondition(8314, 'SMART', true, 1000000)
    expect(vol.conId).toBe(8314)
    expect(vol.exchange).toBe('SMART')
    expect(vol.isMore).toBe(true)
    expect(vol.volume).toBe(1000000)

    const pct = new PercentChangeCondition(1111, 'AMEX', true, 0.25)
    expect(pct.conId).toBe(1111)
    expect(pct.changePercent).toBe(0.25)

    const price = new PriceCondition(
      TriggerMethodEnum.DoubleLast, 2222, 'NASDAQ', false, 4.75,
    )
    expect(price.triggerMethod).toBe(TriggerMethodEnum.DoubleLast)
    expect(price.price).toBe(4.75)

    const time = new TimeCondition(true, '20170101 09:30:00')
    expect(time.time).toBe('20170101 09:30:00')

    const margin = new MarginCondition(false, 200000)
    expect(margin.percent).toBe(200000)
    expect(margin.isMore).toBe(false)

    const exec = new ExecutionCondition('STK', 'SMART', 'AMD')
    expect(exec.secType).toBe('STK')
    expect(exec.exchange).toBe('SMART')
    expect(exec.symbol).toBe('AMD')
  })

  it('And/Or set conjunction correctly', () => {
    const vol = new VolumeCondition(8314, 'SMART', true, 1000000)
    vol.And()
    expect(vol.isConjunctionConnection).toBe(true)
    vol.Or()
    expect(vol.isConjunctionConnection).toBe(false)
  })

  it('Create factory returns correct subclass', () => {
    expect(Create(OrderCondition.Price)).toBeInstanceOf(PriceCondition)
    expect(Create(OrderCondition.Time)).toBeInstanceOf(TimeCondition)
    expect(Create(OrderCondition.Margin)).toBeInstanceOf(MarginCondition)
    expect(Create(OrderCondition.Execution)).toBeInstanceOf(ExecutionCondition)
    expect(Create(OrderCondition.Volume)).toBeInstanceOf(VolumeCondition)
    expect(Create(OrderCondition.PercentChange)).toBeInstanceOf(PercentChangeCondition)
  })

  it('encode/decode round-trip via makeFields/decode', () => {
    const vol = new VolumeCondition(8314, 'SMART', true, 1000000)
    vol.And()
    const fields = vol.makeFields()
    expect(fields.length).toBeGreaterThan(0)

    const vol2 = Create(OrderCondition.Volume) as VolumeCondition
    vol2.decode(fields[Symbol.iterator]())
    expect(vol2.conId).toBe(8314)
    expect(vol2.exchange).toBe('SMART')
    expect(vol2.isMore).toBe(true)
    expect(vol2.volume).toBe(1000000)
    expect(vol2.isConjunctionConnection).toBe(true)
  })
})
