/**
 * Behaviour of the wallet-operation failure classifier: which failures let the
 * log claim "the order did not take effect" and which force "unknown, reconcile".
 *
 * The dangerous direction is the interesting one: a transport failure that is
 * recorded as a definite 'rejected' lets a caller retry an order that may be
 * live. The safe direction is the boring one (an unnecessarily reconciled
 * operation costs one check).
 */
import { describe, it, expect } from 'vitest'
import { classifyOperationFailure, LocalOperationRefusalError } from './operation-failure-classification.js'
import { ReportedOperationFailureError } from '../git/TradingGit.js'

/** The git layer shapes a resolved `{ success: false, error }` failure this way. */
function reported(message: string): Error {
  return new ReportedOperationFailureError(message)
}
function brokerError(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'BrokerError', code })
}

function named(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { name, ...extra })
}

describe('classifyOperationFailure', () => {
  it('treats a transport failure as unconfirmed — the request may have reached the venue', () => {
    // Raw CCXT errors are rethrown unwrapped by CcxtBroker.placeOrder.
    expect(classifyOperationFailure(named('RequestTimeout', 'okx POST /order request timed out (10000 ms)'))).toBe('unconfirmed')
    expect(classifyOperationFailure(named('NetworkError', 'binance connection reset by peer'))).toBe('unconfirmed')
    expect(classifyOperationFailure(named('ExchangeNotAvailable', 'exchange is down for maintenance'))).toBe('unconfirmed')
    expect(classifyOperationFailure(named('DDoSProtection', '503 Service Unavailable'))).toBe('unconfirmed')
    // Node/undici transport codes.
    expect(classifyOperationFailure(named('Error', 'socket hang up', { code: 'ECONNRESET' }))).toBe('unconfirmed')
    expect(classifyOperationFailure(named('Error', 'connect timeout', { code: 'ETIMEDOUT' }))).toBe('unconfirmed')
    expect(classifyOperationFailure(named('Error', 'undici headers timeout', { code: 'UND_ERR_HEADERS_TIMEOUT' }))).toBe('unconfirmed')
    // Our own abort, surfaced by a client that honours the signal.
    expect(classifyOperationFailure(named('AbortError', 'The operation was aborted'))).toBe('unconfirmed')
    // The normalized broker error for the same class of fault.
    expect(classifyOperationFailure(brokerError('NETWORK', 'Order 42 timed out after 15000ms'))).toBe('unconfirmed')
  })

  it('treats a venue refusal as rejected — the order definitely did not take effect', () => {
    expect(classifyOperationFailure(named('InvalidOrder', 'order size below the minimum'))).toBe('rejected')
    expect(classifyOperationFailure(named('InsufficientFunds', 'insufficient funds'))).toBe('rejected')
    expect(classifyOperationFailure(named('AuthenticationError', 'invalid signature'))).toBe('rejected')
    expect(classifyOperationFailure(named('PermissionDenied', 'permission denied'))).toBe('rejected')
    expect(classifyOperationFailure(named('BadSymbol', 'unknown symbol AAPL-XX'))).toBe('rejected')
    expect(classifyOperationFailure(brokerError('EXCHANGE', 'insufficient margin'))).toBe('rejected')
    expect(classifyOperationFailure(brokerError('AUTH', 'invalid key'))).toBe('rejected')
    expect(classifyOperationFailure(brokerError('CONFIG', 'Account is read-only — placeOrder would mutate the external account'))).toBe('rejected')
    expect(classifyOperationFailure(brokerError('MARKET_CLOSED', 'market closed'))).toBe('rejected')
    expect(classifyOperationFailure(brokerError('CONNECTING', 'account is offline and reconnecting'))).toBe('rejected')
  })

  it('reads the HTTP answer it can find', () => {
    expect(classifyOperationFailure(named('ExchangeError', 'bad request', { status: 400 }))).toBe('rejected')
    expect(classifyOperationFailure(named('ExchangeError', 'teapot', { statusCode: '422' }))).toBe('rejected')
    expect(classifyOperationFailure(named('Error', 'gateway timeout', { status: 504 }))).toBe('unconfirmed')
    expect(classifyOperationFailure(named('Error', 'service unavailable', { httpStatus: 503 }))).toBe('unconfirmed')
    expect(classifyOperationFailure(named('Error', 'too many requests', { status: 429 }))).toBe('unconfirmed')
  })

  it('treats a local pre-dispatch refusal as rejected — nothing was sent', () => {
    // Without this marker the fail-closed default would log a precondition
    // failure ("quantity exceeds the open position") as an order of unknown fate,
    // and the caller would be told to reconcile a request that never left us.
    expect(classifyOperationFailure(
      new LocalOperationRefusalError('closePosition: no open position found for AAPL. Refresh positions before retrying.'),
    )).toBe('rejected')
    expect(classifyOperationFailure(
      new LocalOperationRefusalError('closePosition: quantity 500 exceeds the open AAPL position size 10.'),
    )).toBe('rejected')
  })

  it('fails closed for a failure it cannot read, including wrapped causes', () => {
    // Nothing recognizable: recording 'rejected' would be a claim we cannot back.
    expect(classifyOperationFailure(new Error('something odd happened'))).toBe('unconfirmed')
    expect(classifyOperationFailure(named('TypeError', 'fetch failed', {
      cause: named('Error', 'other side closed', { code: 'UND_ERR_SOCKET' }),
    }))).toBe('unconfirmed')
    // A wrapper whose cause IS a definite refusal still classifies as rejected.
    expect(classifyOperationFailure(named('Error', 'wrapped', {
      cause: named('InsufficientFunds', 'insufficient funds'),
    }))).toBe('rejected')
    expect(classifyOperationFailure(undefined)).toBe('unconfirmed')
    expect(classifyOperationFailure('boom')).toBe('unconfirmed')
  })

  it('classifies a REPORTED failure from its message — resolved, not thrown', () => {
    // CcxtBroker.placeOrder catches every venue error and RESOLVES it, so on a
    // hung venue the write never throws and this message is the only evidence.
    // The wording asymmetry is the trap that bit us: ccxt emits "request timed
    // out (10000 ms)" while BrokerError.classifyMessage only matches the single
    // word /timeout/ — hence the transport-wording patterns on top of it.
    expect(classifyOperationFailure(reported('okx POST /order request timed out (10000 ms)'))).toBe('unconfirmed')
    expect(classifyOperationFailure(reported('binance request timed out'))).toBe('unconfirmed')
    expect(classifyOperationFailure(reported('ECONNRESET'))).toBe('unconfirmed')
    expect(classifyOperationFailure(reported('socket hang up'))).toBe('unconfirmed')
    expect(classifyOperationFailure(reported('okx 503 Service Unavailable'))).toBe('unconfirmed')
    expect(classifyOperationFailure(reported('too many requests'))).toBe('unconfirmed')
    // The same resolved shape carries real refusals; those stay definite, or the
    // log would call every refused order uncertain.
    expect(classifyOperationFailure(reported('insufficient funds'))).toBe('rejected')
    expect(classifyOperationFailure(reported('[guard:max-position-size] would exceed 25% of equity'))).toBe('rejected')
    expect(classifyOperationFailure(reported('Invalid order: size below the minimum'))).toBe('rejected')
  })
})
