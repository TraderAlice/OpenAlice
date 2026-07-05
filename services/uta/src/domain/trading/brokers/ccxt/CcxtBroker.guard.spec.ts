/**
 * Construct-time demo/sandbox guard tests for CcxtBroker.
 *
 * Unlike CcxtBroker.spec.ts (which mocks ccxt), this spec uses the REAL ccxt
 * module — the guards turn on actual per-exchange CCXT behavior (whether an
 * exchange defines urls.demo / urls.test and how it routes enableDemoTrading /
 * setSandboxMode), so a mock would just test the mock. Every case is
 * construct-time only: `new CcxtBroker(...)` runs the guards synchronously with
 * no init() / network call, so these are offline and deterministic. They also
 * lock in the regression a ccxt version bump could reintroduce (e.g. an
 * exchange dropping urls.demo).
 */
import { describe, it, expect } from 'vitest'
import { CcxtBroker } from './CcxtBroker.js'

describe('CcxtBroker construct-time demo/sandbox guards', () => {
  it('throws a clear CONFIG error for an exchange whose demo has no endpoint (okx)', () => {
    // okx demo == the sandbox x-simulated-trading header, NOT a demo domain.
    // CCXT base enableDemoTrading sets urls.api = urls.demo (undefined for okx);
    // without the guard this only crashes later with "reading 'rest'".
    expect(
      () => new CcxtBroker({ id: 't', exchange: 'okx', sandbox: false, demoTrading: true, apiKey: 'k', secret: 's', password: 'p' }),
    ).toThrow(/no CCXT demo-trading endpoint/)
  })

  it('constructs cleanly for an exchange that supports demo trading (binance)', () => {
    // binance overrides enableDemoTrading and has urls.demo → urls.api stays valid.
    expect(
      () => new CcxtBroker({ id: 't', exchange: 'binance', sandbox: false, demoTrading: true, apiKey: 'k', secret: 's' }),
    ).not.toThrow()
  })

  it('throws CONFIG when demo + sandbox are combined (CCXT NotSupported)', () => {
    // setSandboxMode first → isSandboxModeEnabled; enableDemoTrading then throws.
    expect(
      () => new CcxtBroker({ id: 't', exchange: 'binance', sandbox: true, demoTrading: true, apiKey: 'k', secret: 's' }),
    ).toThrow(/cannot enable Demo Trading/)
  })

  it('throws a clear CONFIG error for sandbox on an exchange with no testnet URL', () => {
    // kucoin has no urls.test → setSandboxMode throws NotSupported → wrapped CONFIG.
    expect(
      () => new CcxtBroker({ id: 't', exchange: 'kucoin', sandbox: true, demoTrading: false, apiKey: 'k', secret: 's', password: 'p' }),
    ).toThrow(/cannot enable Sandbox/)
  })
})
