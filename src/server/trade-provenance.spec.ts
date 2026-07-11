import { describe, expect, it } from 'vitest'

import { extractTradeDecisionRefs } from './trade-provenance.js'

const content = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }]

describe('extractTradeDecisionRefs', () => {
  it('extracts one or many explicit trading commits', () => {
    expect(extractTradeDecisionRefs('tradingCommit', content({ source: 'alpaca', hash: 'h1' })))
      .toEqual([{ accountId: 'alpaca', decisionId: 'h1' }])
    expect(extractTradeDecisionRefs('tradingCommit', content([
      { source: 'alpaca', hash: 'h1' },
      { source: 'ibkr', hash: 'h2' },
    ]))).toEqual([
      { accountId: 'alpaca', decisionId: 'h1' },
      { accountId: 'ibkr', decisionId: 'h2' },
    ])
  })

  it('extracts commits created inline while staging an operation', () => {
    expect(extractTradeDecisionRefs('placeOrder', content({
      source: 'alpaca-paper', staged: [{ action: 'placeOrder' }], committed: { hash: 'h3' },
    }))).toEqual([{ accountId: 'alpaca-paper', decisionId: 'h3' }])
  })

  it('does not confuse staged operations, pushes, or broker order ids with decisions', () => {
    expect(extractTradeDecisionRefs('placeOrder', content({
      source: 'alpaca-paper', staged: [{ action: 'placeOrder', orderId: 'broker-1' }],
    }))).toEqual([])
    expect(extractTradeDecisionRefs('tradingPush', content({
      results: [{ source: 'alpaca-paper', orderId: 'broker-1' }],
    }))).toEqual([])
  })

  it('ignores malformed or non-JSON tool content', () => {
    expect(extractTradeDecisionRefs('tradingCommit', [{ type: 'text', text: 'done' }])).toEqual([])
    expect(extractTradeDecisionRefs('tradingCommit', [{ type: 'image', data: 'x' }])).toEqual([])
  })
})

