/**
 * Tests for Decimal precision on Order's price fields.
 *
 * Locks the wire-layer contract: the 5 price fields (lmtPrice, auxPrice,
 * trailStopPrice, trailingPercent, cashQty) are `Decimal`, survive
 * encode/decode round-trip without IEEE 754 artifacts, and respect the
 * UNSET_DECIMAL sentinel via makeFieldHandleEmpty.
 */

import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Order } from '@traderalice/ibkr-types'
import { UNSET_DECIMAL } from '@traderalice/ibkr-types'
import { makeField, makeFieldHandleEmpty } from '../src/comm.js'
import { decodeDecimal } from '../src/utils.js'

function iterOf(strs: string[]): Iterator<string> {
  return strs[Symbol.iterator]()
}

describe('Order — price fields are Decimal', () => {
  it('defaults to UNSET_DECIMAL', () => {
    const o = new Order()
    expect(o.lmtPrice.equals(UNSET_DECIMAL)).toBe(true)
    expect(o.auxPrice.equals(UNSET_DECIMAL)).toBe(true)
    expect(o.trailStopPrice.equals(UNSET_DECIMAL)).toBe(true)
    expect(o.trailingPercent.equals(UNSET_DECIMAL)).toBe(true)
    expect(o.cashQty.equals(UNSET_DECIMAL)).toBe(true)
  })

  it('accepts precise Decimal assignments without loss', () => {
    const o = new Order()
    o.lmtPrice = new Decimal('0.12345678')
    o.auxPrice = new Decimal('0.00000001')
    // Internal representation is exact; toString() may choose scientific
    // notation for small values, but the underlying value is preserved.
    expect(o.lmtPrice.equals(new Decimal('0.12345678'))).toBe(true)
    expect(o.auxPrice.equals(new Decimal('0.00000001'))).toBe(true)
    // The wire formatter (toFixed) must produce plain decimal notation.
    expect(o.auxPrice.toFixed()).toBe('0.00000001')
  })
})

describe('makeFieldHandleEmpty — Decimal branch', () => {
  it('encodes UNSET_DECIMAL as empty wire field', () => {
    expect(makeFieldHandleEmpty(UNSET_DECIMAL)).toBe('\0')
  })

  it('encodes a precise Decimal as exact decimal string', () => {
    expect(makeFieldHandleEmpty(new Decimal('0.12345678'))).toBe('0.12345678\0')
  })

  it('encodes a Decimal with no fractional part as integer string', () => {
    expect(makeFieldHandleEmpty(new Decimal('145'))).toBe('145\0')
  })

  it('preserves precision that JS number cannot represent', () => {
    // 0.1 + 0.2 rendered via JS number is '0.30000000000000004'.
    // Via Decimal it stays '0.3'.
    const d = new Decimal('0.1').plus('0.2')
    expect(makeFieldHandleEmpty(d)).toBe('0.3\0')
  })

  it('retains existing number UNSET sentinel semantics', () => {
    // Non-Decimal call sites in the lib still pass number sentinels;
    // make sure the widened helper didn't regress them.
    expect(makeFieldHandleEmpty(Number.MAX_VALUE)).toBe('\0') // UNSET_DOUBLE
    expect(makeFieldHandleEmpty(2 ** 31 - 1)).toBe('\0')      // UNSET_INTEGER
  })
})

describe('decodeDecimal round-trip with encoder', () => {
  function roundTrip(d: Decimal): Decimal {
    // Encode → strip trailing NULL → wrap as single wire field.
    const wire = makeFieldHandleEmpty(d).replace(/\0$/, '')
    return decodeDecimal(iterOf([wire]))
  }

  it('round-trips satoshi-scale price', () => {
    const original = new Decimal('0.00001234')
    const got = roundTrip(original)
    expect(got.equals(original)).toBe(true)
    expect(got.toString()).toBe('0.00001234')
  })

  it('round-trips IEEE 754 trap value safely', () => {
    const original = new Decimal('0.1').plus('0.2')
    const got = roundTrip(original)
    expect(got.toString()).toBe('0.3')
  })

  it('round-trips UNSET sentinel to UNSET', () => {
    const got = roundTrip(UNSET_DECIMAL)
    expect(got.equals(UNSET_DECIMAL)).toBe(true)
  })

  it('round-trips a typical stock price', () => {
    const got = roundTrip(new Decimal('145.25'))
    expect(got.toString()).toBe('145.25')
  })
})

describe('Order.toString — uses Decimal-aware formatter', () => {
  it('renders lmtPrice as decimal (no IEEE noise)', () => {
    const o = new Order()
    o.totalQuantity = new Decimal('10')
    o.lmtPrice = new Decimal('0.1').plus('0.2')
    o.action = 'BUY'
    o.orderType = 'LMT'
    // Match the toString body: ... `${decimalMaxString(quantity)}@${decimalMaxString(lmtPrice)}`
    expect(o.toString()).toContain('10@0.3')
    expect(o.toString()).not.toContain('0.30000000000000004')
  })
})

describe('makeField — encodes Decimal natively', () => {
  it('uses Decimal.toString() under the hood', () => {
    expect(makeField(new Decimal('1.5'))).toBe('1.5\0')
    expect(makeField(new Decimal('0.00000001'))).toBe('0.00000001\0')
  })
})
