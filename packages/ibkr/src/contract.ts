/**
 * Mirrors: ibapi/contract.py
 */

import Decimal from 'decimal.js'
import { UNSET_DECIMAL, UNSET_DOUBLE, UNSET_INTEGER } from './const.js'
import type { IneligibilityReason } from './ineligibility-reason.js'

function floatMaxString(val: number): string { return val === UNSET_DOUBLE ? '' : String(val) }
function intMaxString(val: number): string { return val === UNSET_INTEGER ? '' : String(val) }
function decimalMaxString(val: Decimal): string { return val.equals(UNSET_DECIMAL) ? '' : val.toString() }

export const SAME_POS = 0
export const OPEN_POS = 1
export const CLOSE_POS = 2
export const UNKNOWN_POS = 3

export class ComboLeg {
  conId: number = 0
  ratio: number = 0
  action: string = ''
  exchange: string = ''
  openClose: number = 0
  shortSaleSlot: number = 0
  designatedLocation: string = ''
  exemptCode: number = -1

  toString(): string {
    return [
      intMaxString(this.conId),
      intMaxString(this.ratio),
      String(this.action),
      String(this.exchange),
      intMaxString(this.openClose),
      intMaxString(this.shortSaleSlot),
      String(this.designatedLocation),
      intMaxString(this.exemptCode),
    ].join(',')
  }
}

export class DeltaNeutralContract {
  conId: number = 0
  delta: number = 0.0
  price: number = 0.0

  toString(): string {
    return [
      String(this.conId),
      floatMaxString(this.delta),
      floatMaxString(this.price),
    ].join(',')
  }
}

/**
 * Canonical security types — mirrors IBKR TWS API's full secType taxonomy.
 *
 * **NO new secTypes may be added without explicit project-lead sign-off.**
 * IBKR's catalog is the source of truth; if IBKR can't represent an asset,
 * OpenAlice doesn't represent it either. Brokers that work in non-IBKR
 * universes are expected to map their native instruments INTO this set
 * (e.g. Longbridge HK warrants → 'WAR'; LeverUp synthetic-perps → 'CRYPTO_PERP').
 *
 * The single intentional deviation from IBKR's exact list is the pair
 * `'CRYPTO' | 'CRYPTO_PERP'`. IBKR has weak crypto-perp coverage (they
 * shoehorn perps into futures/swaps), and crypto's wire format is simple
 * enough that splitting spot vs. perp at the type level pays off
 * immediately downstream (PnL formulas, contract identity, fingerprint
 * fields). No other "subtype" extensions of this kind are allowed —
 * if you find yourself wanting `STK_PRE`, `OPT_LEAP`, etc., the answer
 * is "no, encode it via existing fields (lastTradeDateOrContractMonth,
 * tradingClass, etc.)".
 */
const SEC_TYPE_VALUES = new Set<string>([
  'STK', 'OPT', 'FUT', 'FOP', 'IND', 'CASH', 'BOND', 'CMDTY',
  'WAR', 'IOPT', 'FUND', 'BAG', 'NEWS', 'CFD', 'CRYPTO',
  'CRYPTO_PERP',
])

/**
 * Wire-side coercion: turns whatever raw secType string TWS sent into
 * either a typed `SecType` or `''`. Use at the bytes-to-objects boundary
 * (decoders) so downstream code can trust `Contract.secType: SecType | ''`
 * without runtime guards. If TWS adds a new secType we don't model yet,
 * decoder logs a warning and stamps `''` rather than corrupt the type.
 */
export function coerceSecType(raw: string | undefined | null): SecType | '' {
  if (!raw) return ''
  if (SEC_TYPE_VALUES.has(raw)) return raw as SecType
  // Unknown — TWS sent something not in our SecType union. Don't propagate
  // an arbitrary string into the type system; downstream validation will
  // surface the missing instrument as "no secType set".
  console.warn(`@traderalice/ibkr: unknown secType "${raw}" — dropped (extend SecType in contract.ts if you need to model it).`)
  return ''
}

export type SecType =
  // ─── IBKR canonical (mirrors TWS API's documented values) ───
  | 'STK'      // Stock / ETF
  | 'OPT'      // Equity option
  | 'FUT'      // Future
  | 'FOP'      // Future option
  | 'IND'      // Index
  | 'CASH'     // Forex pair
  | 'BOND'     // Bond
  | 'CMDTY'    // Commodity
  | 'WAR'      // Warrant
  | 'IOPT'     // Dutch warrant / structured product
  | 'FUND'     // Mutual fund
  | 'BAG'      // Combo (multi-leg)
  | 'NEWS'     // News
  | 'CFD'      // Contract for difference
  | 'CRYPTO'   // Crypto spot
  // ─── OpenAlice extension — the ONLY allowed deviation from IBKR ───
  | 'CRYPTO_PERP'

export class Contract {
  conId: number = 0
  symbol: string = ''
  /**
   * Strict union — see `SecType` above for the no-extensions policy.
   * Empty `''` is the un-set state on a freshly-constructed Contract;
   * assertContract (in domain/trading/contract-discipline.ts) rejects
   * `''` at broker output boundaries.
   */
  secType: SecType | '' = ''
  lastTradeDateOrContractMonth: string = ''
  lastTradeDate: string = ''
  strike: number = UNSET_DOUBLE
  right: string = ''
  multiplier: string = ''
  exchange: string = ''
  primaryExchange: string = ''
  currency: string = ''
  localSymbol: string = ''
  tradingClass: string = ''
  includeExpired: boolean = false
  secIdType: string = ''
  secId: string = ''
  description: string = ''
  issuerId: string = ''
  comboLegsDescrip: string = ''
  comboLegs: ComboLeg[] = []
  deltaNeutralContract: DeltaNeutralContract | null = null

  toString(): string {
    let s =
      `ConId: ${intMaxString(this.conId)}, ` +
      `Symbol: ${this.symbol}, ` +
      `SecType: ${this.secType}, ` +
      `LastTradeDateOrContractMonth: ${this.lastTradeDateOrContractMonth}, ` +
      `Strike: ${floatMaxString(this.strike)}, ` +
      `Right: ${this.right}, ` +
      `Multiplier: ${this.multiplier}, ` +
      `Exchange: ${this.exchange}, ` +
      `PrimaryExchange: ${this.primaryExchange}, ` +
      `Currency: ${this.currency}, ` +
      `LocalSymbol: ${this.localSymbol}, ` +
      `TradingClass: ${this.tradingClass}, ` +
      `IncludeExpired: ${this.includeExpired}, ` +
      `SecIdType: ${this.secIdType}, ` +
      `SecId: ${this.secId}, ` +
      `Description: ${this.description}, ` +
      `IssuerId: ${this.issuerId}`

    s += 'Combo:' + this.comboLegsDescrip

    if (this.comboLegs.length > 0) {
      for (const leg of this.comboLegs) {
        s += ';' + leg.toString()
      }
    }

    if (this.deltaNeutralContract) {
      s += ';' + this.deltaNeutralContract.toString()
    }

    return s
  }
}

export const FundAssetType = {
  NoneItem: ['None', 'None'],
  Others: ['000', 'Others'],
  MoneyMarket: ['001', 'Money Market'],
  FixedIncome: ['002', 'Fixed Income'],
  MultiAsset: ['003', 'Multi-asset'],
  Equity: ['004', 'Equity'],
  Sector: ['005', 'Sector'],
  Guaranteed: ['006', 'Guaranteed'],
  Alternative: ['007', 'Alternative'],
} as const

export const FundDistributionPolicyIndicator = {
  NoneItem: ['None', 'None'],
  AccumulationFund: ['N', 'Accumulation Fund'],
  IncomeFund: ['Y', 'Income Fund'],
} as const

export type FundAssetTypeValue = (typeof FundAssetType)[keyof typeof FundAssetType]
export type FundDistributionPolicyIndicatorValue = (typeof FundDistributionPolicyIndicator)[keyof typeof FundDistributionPolicyIndicator]

export class ContractDetails {
  contract: Contract = new Contract()
  marketName: string = ''
  minTick: number = 0.0
  orderTypes: string = ''
  validExchanges: string = ''
  priceMagnifier: number = 0
  underConId: number = 0
  longName: string = ''
  contractMonth: string = ''
  industry: string = ''
  category: string = ''
  subcategory: string = ''
  timeZoneId: string = ''
  tradingHours: string = ''
  liquidHours: string = ''
  evRule: string = ''
  evMultiplier: number = 0
  aggGroup: number = 0
  underSymbol: string = ''
  underSecType: string = ''
  marketRuleIds: string = ''
  secIdList: Array<{ tag: string; value: string }> | null = null
  realExpirationDate: string = ''
  lastTradeTime: string = ''
  stockType: string = ''
  minSize: Decimal = UNSET_DECIMAL
  sizeIncrement: Decimal = UNSET_DECIMAL
  suggestedSizeIncrement: Decimal = UNSET_DECIMAL
  minAlgoSize: Decimal = UNSET_DECIMAL
  lastPricePrecision: Decimal = UNSET_DECIMAL
  lastSizePrecision: Decimal = UNSET_DECIMAL
  // BOND values
  cusip: string = ''
  ratings: string = ''
  descAppend: string = ''
  bondType: string = ''
  couponType: string = ''
  callable: boolean = false
  putable: boolean = false
  coupon: number = 0
  convertible: boolean = false
  maturity: string = ''
  issueDate: string = ''
  nextOptionDate: string = ''
  nextOptionType: string = ''
  nextOptionPartial: boolean = false
  notes: string = ''
  // FUND values
  fundName: string = ''
  fundFamily: string = ''
  fundType: string = ''
  fundFrontLoad: string = ''
  fundBackLoad: string = ''
  fundBackLoadTimeInterval: string = ''
  fundManagementFee: string = ''
  fundClosed: boolean = false
  fundClosedForNewInvestors: boolean = false
  fundClosedForNewMoney: boolean = false
  fundNotifyAmount: string = ''
  fundMinimumInitialPurchase: string = ''
  fundSubsequentMinimumPurchase: string = ''
  fundBlueSkyStates: string = ''
  fundBlueSkyTerritories: string = ''
  fundDistributionPolicyIndicator: FundDistributionPolicyIndicatorValue = FundDistributionPolicyIndicator.NoneItem
  fundAssetType: FundAssetTypeValue = FundAssetType.NoneItem
  ineligibilityReasonList: IneligibilityReason[] | null = null
  eventContract1: string = ''
  eventContractDescription1: string = ''
  eventContractDescription2: string = ''

  toString(): string {
    return [
      String(this.contract),
      String(this.marketName),
      floatMaxString(this.minTick),
      String(this.orderTypes),
      String(this.validExchanges),
      intMaxString(this.priceMagnifier),
      intMaxString(this.underConId),
      String(this.longName),
      String(this.contractMonth),
      String(this.industry),
      String(this.category),
      String(this.subcategory),
      String(this.timeZoneId),
      String(this.tradingHours),
      String(this.liquidHours),
      String(this.evRule),
      intMaxString(this.evMultiplier),
      String(this.underSymbol),
      String(this.underSecType),
      String(this.marketRuleIds),
      intMaxString(this.aggGroup),
      String(this.secIdList),
      String(this.realExpirationDate),
      String(this.stockType),
      String(this.cusip),
      String(this.ratings),
      String(this.descAppend),
      String(this.bondType),
      String(this.couponType),
      String(this.callable),
      String(this.putable),
      String(this.coupon),
      String(this.convertible),
      String(this.maturity),
      String(this.issueDate),
      String(this.nextOptionDate),
      String(this.nextOptionType),
      String(this.nextOptionPartial),
      String(this.notes),
      decimalMaxString(this.minSize),
      decimalMaxString(this.sizeIncrement),
      decimalMaxString(this.suggestedSizeIncrement),
      decimalMaxString(this.minAlgoSize),
      decimalMaxString(this.lastPricePrecision),
      decimalMaxString(this.lastSizePrecision),
      String(this.ineligibilityReasonList),
      String(this.eventContract1),
      String(this.eventContractDescription1),
      String(this.eventContractDescription2),
    ].join(',')
  }
}

export class ContractDescription {
  contract: Contract = new Contract()
  derivativeSecTypes: string[] = []
}
