import { describe, expect, it } from 'vitest'

import { BrokerError } from './broker.js'

describe('BrokerError.from', () => {
  it('preserves a structured error from a separately loaded broker pack', () => {
    const packError = Object.assign(new Error('credentials were rejected'), {
      name: 'BrokerError',
      code: 'AUTH',
      permanent: true,
    })

    const wrapped = BrokerError.from(packError)

    expect(wrapped).toBeInstanceOf(BrokerError)
    expect(wrapped.code).toBe('AUTH')
    expect(wrapped.permanent).toBe(true)
    expect(wrapped.cause).toBe(packError)
  })

  it('does not trust an unknown structured code', () => {
    const invalid = Object.assign(new Error('opaque failure'), {
      name: 'BrokerError',
      code: 'NOT_A_REAL_CODE',
    })

    expect(BrokerError.from(invalid).code).toBe('UNKNOWN')
  })

  it('classifies Bun network errors and timeouts as NETWORK', () => {
    expect(BrokerError.from(new Error('Unable to connect. Is the computer able to access the url?')).code).toBe('NETWORK')
    expect(BrokerError.from(Object.assign(new Error('socket failed'), { code: 'ConnectionRefused' })).code).toBe('NETWORK')
    expect(BrokerError.from(Object.assign(new Error('socket failed'), { code: 'FailedToOpenSocket' })).code).toBe('NETWORK')
    expect(BrokerError.from(new Error('UTA GET http://127.0.0.1:47333/api/accounts timed out after 15000ms')).code).toBe('NETWORK')
  })
})
