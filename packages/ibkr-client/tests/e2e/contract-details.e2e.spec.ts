/**
 * E2E: reqContractDetails for AAPL.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { Contract } from '../../src/index.js'
import { client, available, results, waitFor } from './setup.js'

const REQ_ID = 1001

describe.runIf(available)('TWS reqContractDetails', () => {
  beforeAll(async () => {
    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.secType = 'STK'
    contract.exchange = 'SMART'
    contract.currency = 'USD'
    client.reqContractDetails(REQ_ID, contract)

    await waitFor(() => results.contractDetailsEnded.has(REQ_ID))
  })

  it('receives contract details', () => {
    const details = results.contractDetails.get(REQ_ID)
    expect(details).toBeDefined()
    expect(details!.length).toBeGreaterThan(0)
  })

  it('receives contractDetailsEnd', () => {
    expect(results.contractDetailsEnded.has(REQ_ID)).toBe(true)
  })

  it('has correct symbol and conId', () => {
    const aapl = results.contractDetails.get(REQ_ID)![0]
    expect(aapl.contract.symbol).toBe('AAPL')
    expect(aapl.contract.conId).toBe(265598)
  })

  it('has APPLE INC as longName', () => {
    expect(results.contractDetails.get(REQ_ID)![0].longName).toBe('APPLE INC')
  })

  it('has NASDAQ as primaryExchange', () => {
    expect(results.contractDetails.get(REQ_ID)![0].contract.primaryExchange).toBe('NASDAQ')
  })
})
