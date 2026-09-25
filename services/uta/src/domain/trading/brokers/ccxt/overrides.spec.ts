/**
 * Alias resolution for the exchange-overrides registry.
 *
 * A venue ships several ccxt ids — one per market subset of the same account —
 * and a broker configured under the narrower id must get the SAME handling as one
 * configured under the canonical id. That is the whole job of the alias map, and
 * both directions of it are invisible when wrong: falling through means an order
 * the venue refuses (binance -4061 on a hedged account), and over-reaching means
 * another venue's order rules composed into a live order. So both are pinned:
 *   - a listed alias resolves to the canonical overrides object ITSELF (identity,
 *     not a copy: a copy would silently stop tracking fixes made to the canonical
 *     entry);
 *   - an id outside the map resolves to no overrides at all, never to a
 *     nearest-match, however similar it looks.
 * The final block drives a real CcxtBroker: a correct lookup the broker does not
 * use would still leave the account unhandled, which is what the alias map exists
 * to prevent.
 */
import { describe, expect, it } from 'vitest'
import ccxt from 'ccxt'
import { CcxtBroker } from './CcxtBroker.js'
import { exchangeIdAliases, exchangeOverrides, resolveExchangeOverrides } from './overrides.js'

/** Binance's wallet decomposition as the broker reports it. Observable proof that
 *  an id reached the canonical overrides rather than the no-override default. */
const BINANCE_SUB_ACCOUNTS = [
  { id: 'spot', label: 'Spot', kind: 'spot' },
  { id: 'derivatives', label: 'Futures', kind: 'derivatives' },
]

/** What a venue without a `subAccounts` override exposes. */
const UNIFIED_SUB_ACCOUNT = [{ id: 'default', label: 'Account', kind: 'unified' }]

/** Real ccxt ids the alias decision examined and REJECTED: separate legal entities
 *  (or separate deployments) whose rules no override here was verified against.
 *  Being a genuine sibling id of a registered venue is not enough to inherit that
 *  venue's order rules. */
const REJECTED_IDS = ['binanceus', 'okxus', 'myokx', 'bybiteu']

function broker(exchange: string): CcxtBroker {
  return new CcxtBroker({ exchange, apiKey: 'k', secret: 's', sandbox: false })
}

describe('resolveExchangeOverrides', () => {
  it('resolves every listed alias to the canonical id’s own overrides object', () => {
    const aliases = Object.entries(exchangeIdAliases)
    expect(aliases.length).toBeGreaterThan(0) // a map that quietly empties must fail here
    for (const [alias, canonical] of aliases) {
      expect(exchangeOverrides[canonical], `${canonical} is not registered`).toBeDefined()
      expect(resolveExchangeOverrides(alias), alias).toBe(exchangeOverrides[canonical])
      expect(resolveExchangeOverrides(alias), alias).not.toEqual({})
    }
  })

  it('lists only ids ccxt actually ships, incl. the ones it refuses to map', () => {
    const venueIds = ccxt as unknown as Record<string, unknown>
    for (const id of [...Object.keys(exchangeIdAliases), ...REJECTED_IDS]) {
      expect(typeof venueIds[id], id).toBe('function')
    }
  })

  it('maps exactly the ids that were vetted, so an unvetted alias cannot ride along', () => {
    // The sibling set of every registered venue in the installed ccxt is closed:
    // binance -> {binanceusdm, binancecoinm} (same account and endpoints) and
    // {binanceus} (a separate entity); okx -> {okxus, myokx} (separate
    // deployments); bybit -> {bybiteu}; bitget and hyperliquid have none. The
    // first two inherit the same account and are mapped; every deployment that is
    // a different entity is rejected in REJECTED_IDS. Asserting the EXACT key set
    // is what makes this a vetted allowlist rather than a rule: without it, adding
    // an unvetted alias leaves the entire surface green.
    expect(Object.keys(exchangeIdAliases).sort()).toEqual(['binancecoinm', 'binanceusdm'])
  })

  it('leaves canonical ids exactly as they were', () => {
    for (const id of Object.keys(exchangeOverrides)) {
      expect(resolveExchangeOverrides(id), id).toBe(exchangeOverrides[id])
    }
  })

  it('gives a deliberately unmapped id no overrides', () => {
    for (const id of REJECTED_IDS) {
      expect(exchangeIdAliases[id], id).toBeUndefined()
      expect(resolveExchangeOverrides(id), id).toEqual({})
    }
  })

  it('gives an unknown id no overrides', () => {
    for (const id of ['notanexchange', 'binanceusd', 'okx-eu', '']) {
      expect(resolveExchangeOverrides(id), id).toEqual({})
    }
  })
})

describe('CcxtBroker — an alias id is handled as the canonical venue', () => {
  it('reports the canonical venue’s sub-accounts', async () => {
    const canonical = await broker('binance').listSubAccounts()
    expect(canonical).toEqual(BINANCE_SUB_ACCOUNTS)
    for (const alias of Object.keys(exchangeIdAliases)) {
      expect(await broker(alias).listSubAccounts(), alias).toEqual(canonical)
    }
  })

  it('a rejected sibling id gets no overrides rather than the canonical venue’s', async () => {
    // The control for the assertion above: anything but an exact hit would come
    // back with Binance's wallets here.
    expect(await broker('binanceus').listSubAccounts()).toEqual(UNIFIED_SUB_ACCOUNT)
  })
})
