import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import { BrokerError } from '../types.js'
import {
  applyStandaloneOcaType,
  buildIbkrBracket,
  refuseBracketOcaGroup,
  IBKR_OCA_CANCEL_WITH_BLOCK,
} from './ibkr-bracket.js'

function limitBuy(): Order {
  const order = new Order()
  order.action = 'BUY'
  order.orderType = 'LMT'
  order.totalQuantity = new Decimal(3)
  order.lmtPrice = new Decimal('957.32')
  order.tif = 'GTD'
  order.goodTillDate = '20260904 16:00:00'
  order.transmit = true
  return order
}

function sequentialIds(start = 10): () => number {
  let next = start
  return () => next++
}

describe('buildIbkrBracket', () => {
  it('emits parent + TP + SL with the official transmit chain', () => {
    const parentOrder = limitBuy()
    const bracket = buildIbkrBracket(
      parentOrder,
      { takeProfit: { price: '1153.60' }, stopLoss: { price: '887.60' } },
      sequentialIds(10),
    )

    expect(bracket.parentId).toBe(10)
    expect(bracket.parent.orderId).toBe(10)
    expect(bracket.parent.transmit).toBe(false)
    expect(bracket.parent.orderType).toBe('LMT')
    expect(bracket.parent.lmtPrice.equals(new Decimal('957.32'))).toBe(true)
    expect(bracket.parent.tif).toBe('GTD')
    expect(bracket.parent.ocaGroup).toBe('')
    expect(bracket.parent.ocaType).toBe(0)

    expect(bracket.children).toHaveLength(2)
    const [tp, sl] = bracket.children
    expect(tp).toMatchObject({ orderId: 11, kind: 'takeProfit' })
    expect(sl).toMatchObject({ orderId: 12, kind: 'stopLoss' })

    expect(tp!.order.action).toBe('SELL')
    expect(tp!.order.orderType).toBe('LMT')
    expect(tp!.order.lmtPrice.equals(new Decimal('1153.60'))).toBe(true)
    expect(tp!.order.parentId).toBe(10)
    expect(tp!.order.transmit).toBe(false)
    expect(tp!.order.tif).toBe('GTC')
    expect(tp!.order.ocaGroup).toBe('uta-br-10')
    expect(tp!.order.ocaType).toBe(IBKR_OCA_CANCEL_WITH_BLOCK)
    expect(tp!.order.overridePercentageConstraints).toBe(true)
    expect(tp!.order.totalQuantity.equals(new Decimal(3))).toBe(true)
    expect(tp!.order.goodTillDate).toBe('')

    expect(sl!.order.action).toBe('SELL')
    expect(sl!.order.orderType).toBe('STP')
    expect(sl!.order.auxPrice.equals(new Decimal('887.60'))).toBe(true)
    expect(sl!.order.parentId).toBe(10)
    expect(sl!.order.transmit).toBe(true)
    expect(sl!.order.ocaGroup).toBe(tp!.order.ocaGroup)
    expect(sl!.order.ocaType).toBe(IBKR_OCA_CANCEL_WITH_BLOCK)
    expect(sl!.order.overridePercentageConstraints).toBe(true)
  })

  it('does not mutate the caller order', () => {
    const parentOrder = limitBuy()
    buildIbkrBracket(parentOrder, { takeProfit: { price: '120' } }, sequentialIds())
    expect(parentOrder.transmit).toBe(true)
    expect(parentOrder.orderId).toBe(0)
    expect(parentOrder.ocaGroup).toBe('')
  })

  it('flips a SELL parent to BUY children', () => {
    const parent = limitBuy()
    parent.action = 'SELL'
    const bracket = buildIbkrBracket(parent, { stopLoss: { price: '110' } }, sequentialIds())
    expect(bracket.children[0]!.order.action).toBe('BUY')
    expect(bracket.children[0]!.order.transmit).toBe(true)
  })

  it('uses STP LMT when the stop has a limitPrice', () => {
    const bracket = buildIbkrBracket(
      limitBuy(),
      { stopLoss: { price: '887.60', limitPrice: '886.00' } },
      sequentialIds(),
    )
    const sl = bracket.children[0]!.order
    expect(sl.orderType).toBe('STP LMT')
    expect(sl.auxPrice.equals(new Decimal('887.60'))).toBe(true)
    expect(sl.lmtPrice.equals(new Decimal('886.00'))).toBe(true)
  })

  it('transmits the only child when just a take-profit is attached', () => {
    const bracket = buildIbkrBracket(
      limitBuy(),
      { takeProfit: { price: '120' } },
      sequentialIds(5),
    )
    expect(bracket.children).toHaveLength(1)
    expect(bracket.children[0]).toMatchObject({ orderId: 6, kind: 'takeProfit' })
    expect(bracket.parent.transmit).toBe(false)
    expect(bracket.children[0]!.order.transmit).toBe(true)
  })

  it('refuses a caller ocaGroup instead of moving it onto the children', () => {
    const parent = limitBuy()
    parent.ocaGroup = 'swing-mu'
    expect(() =>
      buildIbkrBracket(
        parent,
        { takeProfit: { price: '120' }, stopLoss: { price: '90' } },
        sequentialIds(),
      ),
    ).toThrow(/mints its own OCA group.*"swing-mu"/s)
  })

  it('mints its own group per bracket and keeps the parent out of it', () => {
    const bracket = buildIbkrBracket(
      limitBuy(),
      { takeProfit: { price: '120' }, stopLoss: { price: '90' } },
      sequentialIds(40),
    )
    expect(bracket.parent.ocaGroup).toBe('')
    expect(bracket.children[0]!.order.ocaGroup).toBe('uta-br-40')
    expect(bracket.children[1]!.order.ocaGroup).toBe('uta-br-40')
  })

  it('copies outsideRth and account onto children', () => {
    const parent = limitBuy()
    parent.outsideRth = true
    parent.account = 'DU123'
    const bracket = buildIbkrBracket(parent, { takeProfit: { price: '120' } }, sequentialIds())
    expect(bracket.children[0]!.order.outsideRth).toBe(true)
    expect(bracket.children[0]!.order.account).toBe('DU123')
  })

  it('refuses a monetary-value entry that has no share quantity', () => {
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.cashQty = new Decimal('5000')

    expect(() =>
      buildIbkrBracket(order, { stopLoss: { price: '90' } }, sequentialIds(10)),
    ).toThrow(/monetary-value|totalQuantity/i)
  })

  it('never forwards cashQty to a protective child', () => {
    const order = limitBuy()
    order.cashQty = new Decimal('5000')

    const bracket = buildIbkrBracket(
      order,
      { takeProfit: { price: '1153.60' }, stopLoss: { price: '887.60' } },
      sequentialIds(10),
    )

    for (const child of bracket.children) {
      expect(child.order.cashQty.equals(UNSET_DECIMAL)).toBe(true)
      expect(child.order.totalQuantity.equals(new Decimal(3))).toBe(true)
    }
  })
})

describe('refuseBracketOcaGroup', () => {
  it('leaves a standalone ocaGroup order alone', () => {
    const order = limitBuy()
    order.ocaGroup = 'swing-mu'
    expect(() => refuseBracketOcaGroup(order, undefined)).not.toThrow()
    expect(() => refuseBracketOcaGroup(order, {})).not.toThrow()
    expect(order.ocaGroup).toBe('swing-mu')
  })

  it('refuses as a CONFIG error so the write path does not fold it into a venue rejection', () => {
    const order = limitBuy()
    order.ocaGroup = 'swing-mu'
    let thrown: unknown
    try {
      refuseBracketOcaGroup(order, { stopLoss: { price: '90' } })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(BrokerError)
    expect((thrown as BrokerError).code).toBe('CONFIG')
  })
})

describe('applyStandaloneOcaType', () => {
  it('defaults ocaType to cancel-with-block when a group is set', () => {
    const order = limitBuy()
    order.ocaGroup = 'swing-mu'
    const sent = applyStandaloneOcaType(order)
    expect(sent).not.toBe(order)
    expect(sent.ocaType).toBe(IBKR_OCA_CANCEL_WITH_BLOCK)
    expect(order.ocaType).toBe(0)
  })

  it('leaves orders without an OCA group untouched', () => {
    const order = limitBuy()
    expect(applyStandaloneOcaType(order)).toBe(order)
  })

  it('preserves an explicit non-zero ocaType', () => {
    const order = limitBuy()
    order.ocaGroup = 'swing-mu'
    order.ocaType = 2
    expect(applyStandaloneOcaType(order)).toBe(order)
    expect(order.ocaType).toBe(2)
  })
})
