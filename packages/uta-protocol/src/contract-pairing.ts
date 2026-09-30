/**
 * Contract pairing + cross-venue spread math.
 *
 * Two pure, read-only concerns shared by every layer of the cross-venue
 * spread read (protocol → UTA fan-out → HTTP route → AI tool):
 *
 *   - `pairingKeyOf` answers "is this the same instrument?" across venues.
 *     A spread is only meaningful between legs that name the same product:
 *     BTC **spot** on venue A and BTC **perp** on venue B differ by basis,
 *     funding and settlement — the difference is real on the wire and
 *     meaningless as a trade. Unknown secTypes therefore never collapse
 *     into a shared bucket: they land in `OTHER:<secType>`, so two
 *     unclassified products only pair with their own kind.
 *
 *   - `computeVenueSpread` turns per-venue quotes into the two spreads the
 *     caller asked for. All money math is Decimal; the wire carries
 *     decimal strings, exactly like every other trading field.
 */

import Decimal from 'decimal.js'

// ==================== Pairing key ====================

/** Product classes that are comparable across venues. */
export type PairingKind = 'SPOT' | 'PERP' | 'FUTURE' | 'OPTION' | `OTHER:${string}`

/**
 * Map a contract's `secType` to the product class a spread may pair on.
 *
 * Anything unrecognised (including an absent secType) returns
 * `OTHER:<secType>` rather than a shared default — an unclassified product
 * must never silently pair with a different one.
 */
export function pairingKindOf(secType: string | null | undefined): PairingKind {
  switch ((secType ?? '').toUpperCase()) {
    case 'CRYPTO': return 'SPOT'
    case 'CRYPTO_PERP': return 'PERP'
    case 'FUT': return 'FUTURE'
    case 'OPT':
    case 'FOP': return 'OPTION'
    default: return `OTHER:${(secType ?? '').toUpperCase()}`
  }
}

/** The fields that decide cross-venue identity. */
export interface PairingKeyInput {
  symbol?: string | null
  currency?: string | null
  secType?: string | null
}

/**
 * Cross-venue pairing key: `SYMBOL|CURRENCY|KIND`, all upper-cased.
 *
 * Built from the same three fields a `Contract` uses for its tradeable
 * identity — for CCXT-backed venues `symbol` is the market base, `currency`
 * the market quote, and `secType` is derived from the market type.
 */
export function pairingKeyOf(contract: PairingKeyInput): string {
  return [
    (contract.symbol ?? '').toUpperCase(),
    (contract.currency ?? '').toUpperCase(),
    pairingKindOf(contract.secType),
  ].join('|')
}

// ==================== Spread math ====================

/**
 * A leg's quote state, as the spread math needs to see it. Structurally a
 * subset of the wire `VenueQuoteLeg`, so legs travel straight in.
 */
export interface SpreadLeg {
  /** Venue identity. A venue can never trade with itself. */
  source: string
  bid: string | null
  ask: string | null
}

export interface ExecutableSpread {
  /** Venue to buy on — the best ask across venues. */
  buyOn: string
  /** Venue to sell on — the best bid across venues. */
  sellOn: string
  buyAt: string
  sellAt: string
  /** sellAt − buyAt, as a decimal string (signed). */
  abs: string
  /** `abs` in basis points of the pair's mid price, 4dp. */
  bps: string
}

export interface MidSpread {
  /** Venue with the lower mid. */
  lowAt: string
  /** Venue with the higher mid. */
  highAt: string
  abs: string
  bps: string
}

export interface VenueSpreadComputation {
  executableSpread: ExecutableSpread | null
  midSpread: MidSpread | null
}

/**
 * Is this quote side a price a venue would actually trade at?
 *
 * Returns the venue's own string when the side is usable, else `null`.
 *
 * A side is usable only when it parses as a finite Decimal **greater than
 * zero**. That matters because "no quote" does not always arrive as null:
 * CCXT-backed venues write `String(ticker.bid ?? 0)`, so a market with no
 * two-sided quote reports the *string* `"0"`. Treating that as a price
 * would elect the silent venue the cheapest place to buy and manufacture an
 * enormous phantom spread. Unknown, non-finite, zero and negative sides are
 * all "no quote".
 */
export function usablePrice(value: string | null | undefined): string | null {
  if (value == null) return null
  let price: Decimal
  try {
    price = new Decimal(value)
  } catch {
    return null
  }
  return price.isFinite() && price.gt(0) ? value : null
}

/** One venue with both quote sides usable. */
interface TwoSidedLeg {
  source: string
  bid: Decimal
  ask: Decimal
  bidText: string
  askText: string
  mid: Decimal
}

/** A picked price: the Decimal to compare, the venue's own text to report. */
interface Picked {
  price: Decimal
  at: string
}

interface Cross {
  buyOn: string
  sellOn: string
  buyAt: string
  sellAt: string
  buyPrice: Decimal
  sellPrice: Decimal
  abs: Decimal
}

/**
 * Best price difference obtainable by selling on one venue and buying on
 * another: `max over (sellOn ≠ buyOn) of sellPrice(sellOn) − buyPrice(buyOn)`.
 *
 * `sellPrice`/`buyPrice` read different sides of the same leg, because an
 * executable cross sells at a **bid** and buys at an **ask** while a mid
 * cross compares mids.
 *
 * Returns null when no leg has both sides usable, or when every two-sided
 * leg is the same venue. Both crossing directions are considered, so a venue
 * that is simultaneously the best bid AND the best ask (the tightest book)
 * does not veto the read — the best *remaining* cross-venue pair is
 * reported instead of "no spread".
 */
function bestCross(
  legs: readonly TwoSidedLeg[],
  sellPrice: (leg: TwoSidedLeg) => Picked,
  buyPrice: (leg: TwoSidedLeg) => Picked,
): Cross | null {
  let best: Cross | null = null
  for (const sellLeg of legs) {
    for (const buyLeg of legs) {
      if (sellLeg.source === buyLeg.source) continue
      const sell = sellPrice(sellLeg)
      const buy = buyPrice(buyLeg)
      const abs = sell.price.minus(buy.price)
      // Strictly greater: the first pair encountered wins a tie, so the
      // result is deterministic for a given leg order.
      if (best !== null && !abs.gt(best.abs)) continue
      best = {
        buyOn: buyLeg.source,
        sellOn: sellLeg.source,
        buyAt: buy.at,
        sellAt: sell.at,
        buyPrice: buy.price,
        sellPrice: sell.price,
        abs,
      }
    }
  }
  return best
}

/** `abs` in bps of the two compared prices' midpoint. Both prices are > 0
 *  (guaranteed by `usablePrice`), so the reference is never zero. */
function bpsOf(abs: Decimal, a: Decimal, b: Decimal): string {
  return abs.div(a.plus(b).div(2)).mul(10000).toDecimalPlaces(4).toString()
}

/**
 * Cross-venue spread over per-venue quotes.
 *
 * A leg participates only when **both** its bid and ask are usable
 * (`usablePrice`); one-sided and quote-less legs are excluded from both
 * spreads and never contribute a 0 price. Fewer than two participating
 * venues — or participants that are all the same venue — yield null, which
 * the caller reports as "no executable spread" rather than a number.
 */
export function computeVenueSpread(legs: readonly SpreadLeg[]): VenueSpreadComputation {
  const twoSided: TwoSidedLeg[] = []
  for (const leg of legs) {
    const bidText = usablePrice(leg.bid)
    const askText = usablePrice(leg.ask)
    if (bidText === null || askText === null) continue
    const bid = new Decimal(bidText)
    const ask = new Decimal(askText)
    twoSided.push({ source: leg.source, bid, ask, bidText, askText, mid: bid.plus(ask).div(2) })
  }

  const executable = bestCross(
    twoSided,
    (leg) => ({ price: leg.bid, at: leg.bidText }),
    (leg) => ({ price: leg.ask, at: leg.askText }),
  )
  // The mid cross reports venue names (`lowAt` / `highAt`), never prices, so
  // its `at` is inert — the source name keeps `Cross` shape-honest.
  const mid = bestCross(
    twoSided,
    (leg) => ({ price: leg.mid, at: leg.source }),
    (leg) => ({ price: leg.mid, at: leg.source }),
  )

  return {
    executableSpread: executable === null ? null : {
      buyOn: executable.buyOn,
      sellOn: executable.sellOn,
      buyAt: executable.buyAt,
      sellAt: executable.sellAt,
      abs: executable.abs.toString(),
      bps: bpsOf(executable.abs, executable.sellPrice, executable.buyPrice),
    },
    midSpread: mid === null ? null : {
      lowAt: mid.buyOn,
      highAt: mid.sellOn,
      abs: mid.abs.toString(),
      bps: bpsOf(mid.abs, mid.sellPrice, mid.buyPrice),
    },
  }
}
