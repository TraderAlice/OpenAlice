/**
 * Contract-related decoder handlers (text + protobuf).
 *
 * Message types:
 *   IN.CONTRACT_DATA (10)
 *   IN.BOND_CONTRACT_DATA (18)
 *   IN.CONTRACT_DATA_END (52)
 *   IN.SYMBOL_SAMPLES (79)
 *   IN.DELTA_NEUTRAL_VALIDATION (56)
 *   IN.MARKET_RULE (93)
 *
 * Mirrors: ibapi/decoder.py  (text handlers)
 *          ibapi/decoder.py + ibapi/decoder_utils.py  (protobuf handlers)
 */

import Decimal from 'decimal.js'
import type { Decoder } from './base.js'
import { IN } from '../message.js'
import {
  Contract,
  ContractDetails,
  ContractDescription,
  DeltaNeutralContract,
  ComboLeg,
  FundDistributionPolicyIndicator,
  FundAssetType,
  coerceSecType,
} from '../contract.js'
import { TagValue } from '../tag-value.js'
import { PriceIncrement } from '../common.js'
import { IneligibilityReason } from '../ineligibility-reason.js'
import {
  decodeStr,
  decodeInt,
  decodeFloat,
  decodeBool,
  decodeDecimal,
} from '../utils.js'
import {
  MIN_SERVER_VER_SIZE_RULES,
  MIN_SERVER_VER_MD_SIZE_MULTIPLIER,
  MIN_SERVER_VER_ENCODE_MSG_ASCII7,
  MIN_SERVER_VER_AGG_GROUP,
  MIN_SERVER_VER_UNDERLYING_INFO,
  MIN_SERVER_VER_MARKET_RULES,
  MIN_SERVER_VER_REAL_EXPIRATION_DATE,
  MIN_SERVER_VER_STOCK_TYPE,
  MIN_SERVER_VER_FRACTIONAL_SIZE_SUPPORT,
  MIN_SERVER_VER_FUND_DATA_FIELDS,
  MIN_SERVER_VER_INELIGIBILITY_REASONS,
  MIN_SERVER_VER_LAST_TRADE_DATE,
  MIN_SERVER_VER_BOND_TRADING_HOURS,
  MIN_SERVER_VER_BOND_ISSUERID,
} from '../server-versions.js'
import { NO_VALID_ID } from '../const.js'

// Protobuf message types
import { ContractData as ContractDataProto } from '../protobuf/ContractData.js'
import { ContractDataEnd as ContractDataEndProto } from '../protobuf/ContractDataEnd.js'
import { SymbolSamples as SymbolSamplesProto } from '../protobuf/SymbolSamples.js'
import { MarketRule as MarketRuleProto } from '../protobuf/MarketRule.js'
import type { Contract as ContractProto } from '../protobuf/Contract.js'
import type { ContractDetails as ContractDetailsProto } from '../protobuf/ContractDetails.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEnumTypeFromString(
  enumObj: Record<string, readonly [string, string]>,
  code: string,
): readonly [string, string] {
  for (const val of Object.values(enumObj)) {
    if (val[0] === code) return val
  }
  return enumObj['NoneItem'] ?? ['None', 'None']
}

function setLastTradeDate(
  lastTradeDateOrContractMonth: string,
  contract: ContractDetails,
  isBond: boolean,
): void {
  if (!lastTradeDateOrContractMonth) return
  const parts = lastTradeDateOrContractMonth.includes('-')
    ? lastTradeDateOrContractMonth.split('-')
    : lastTradeDateOrContractMonth.split(/\s+/)
  if (parts.length > 0) {
    if (isBond) {
      contract.maturity = parts[0]
    } else {
      contract.contract.lastTradeDateOrContractMonth = parts[0]
    }
  }
  if (parts.length > 1) {
    contract.lastTradeTime = parts[1]
  }
  if (isBond && parts.length > 2) {
    contract.timeZoneId = parts[2]
  }
}

function readLastTradeDate(
  fields: Iterator<string>,
  contract: ContractDetails,
  isBond: boolean,
): void {
  const lastTradeDateOrContractMonth = decodeStr(fields)
  setLastTradeDate(lastTradeDateOrContractMonth, contract, isBond)
}

// ---------------------------------------------------------------------------
// Protobuf conversion helpers (mirrors decoder_utils.py)
// ---------------------------------------------------------------------------

function decodeContractFromProto(proto: ContractProto): Contract {
  const c = new Contract()
  if (proto.conId !== undefined) c.conId = proto.conId
  if (proto.symbol !== undefined) c.symbol = proto.symbol
  if (proto.secType !== undefined) c.secType = coerceSecType(proto.secType)
  if (proto.lastTradeDateOrContractMonth !== undefined) c.lastTradeDateOrContractMonth = proto.lastTradeDateOrContractMonth
  if (proto.strike !== undefined) c.strike = proto.strike
  if (proto.right !== undefined) c.right = proto.right
  if (proto.multiplier !== undefined) c.multiplier = String(proto.multiplier)
  if (proto.exchange !== undefined) c.exchange = proto.exchange
  if (proto.currency !== undefined) c.currency = proto.currency
  if (proto.localSymbol !== undefined) c.localSymbol = proto.localSymbol
  if (proto.tradingClass !== undefined) c.tradingClass = proto.tradingClass
  if (proto.comboLegsDescrip !== undefined) c.comboLegsDescrip = proto.comboLegsDescrip

  // combo legs
  if (proto.comboLegs && proto.comboLegs.length > 0) {
    c.comboLegs = proto.comboLegs.map((lp) => {
      const leg = new ComboLeg()
      if (lp.conId !== undefined) leg.conId = lp.conId
      if (lp.ratio !== undefined) leg.ratio = lp.ratio
      if (lp.action !== undefined) leg.action = lp.action
      if (lp.exchange !== undefined) leg.exchange = lp.exchange
      if (lp.openClose !== undefined) leg.openClose = lp.openClose
      if (lp.shortSalesSlot !== undefined) leg.shortSaleSlot = lp.shortSalesSlot
      if (lp.designatedLocation !== undefined) leg.designatedLocation = lp.designatedLocation
      if (lp.exemptCode !== undefined) leg.exemptCode = lp.exemptCode
      return leg
    })
  }

  // delta neutral contract
  if (proto.deltaNeutralContract !== undefined) {
    const dnc = new DeltaNeutralContract()
    if (proto.deltaNeutralContract.conId !== undefined) dnc.conId = proto.deltaNeutralContract.conId
    if (proto.deltaNeutralContract.delta !== undefined) dnc.delta = proto.deltaNeutralContract.delta
    if (proto.deltaNeutralContract.price !== undefined) dnc.price = proto.deltaNeutralContract.price
    c.deltaNeutralContract = dnc
  }

  if (proto.lastTradeDate !== undefined) c.lastTradeDate = proto.lastTradeDate
  if (proto.primaryExch !== undefined) c.primaryExchange = proto.primaryExch
  if (proto.issuerId !== undefined) c.issuerId = proto.issuerId
  if (proto.description !== undefined) c.description = proto.description

  return c
}

function decodeTagValueList(protoMap: { [key: string]: string }): Array<{ tag: string; value: string }> | null {
  const list: Array<{ tag: string; value: string }> = []
  if (protoMap) {
    for (const [tag, value] of Object.entries(protoMap)) {
      const tv = new TagValue()
      tv.tag = tag
      tv.value = value
      list.push(tv)
    }
  }
  return list.length > 0 ? list : null
}

function decodeContractDetailsFromProto(
  contractProto: ContractProto,
  detailsProto: ContractDetailsProto,
  isBond: boolean,
): ContractDetails {
  const cd = new ContractDetails()
  cd.contract = decodeContractFromProto(contractProto)

  if (detailsProto.marketName !== undefined) cd.marketName = detailsProto.marketName
  if (detailsProto.minTick !== undefined) cd.minTick = parseFloat(detailsProto.minTick)
  if (detailsProto.priceMagnifier !== undefined) cd.priceMagnifier = detailsProto.priceMagnifier
  if (detailsProto.orderTypes !== undefined) cd.orderTypes = detailsProto.orderTypes
  if (detailsProto.validExchanges !== undefined) cd.validExchanges = detailsProto.validExchanges
  if (detailsProto.underConId !== undefined) cd.underConId = detailsProto.underConId
  if (detailsProto.longName !== undefined) cd.longName = detailsProto.longName
  if (detailsProto.contractMonth !== undefined) cd.contractMonth = detailsProto.contractMonth
  if (detailsProto.industry !== undefined) cd.industry = detailsProto.industry
  if (detailsProto.category !== undefined) cd.category = detailsProto.category
  if (detailsProto.subcategory !== undefined) cd.subcategory = detailsProto.subcategory
  if (detailsProto.timeZoneId !== undefined) cd.timeZoneId = detailsProto.timeZoneId
  if (detailsProto.tradingHours !== undefined) cd.tradingHours = detailsProto.tradingHours
  if (detailsProto.liquidHours !== undefined) cd.liquidHours = detailsProto.liquidHours
  if (detailsProto.evRule !== undefined) cd.evRule = detailsProto.evRule
  if (detailsProto.evMultiplier !== undefined) cd.evMultiplier = detailsProto.evMultiplier

  const secIdList = decodeTagValueList(detailsProto.secIdList)
  if (secIdList) cd.secIdList = secIdList

  if (detailsProto.aggGroup !== undefined) cd.aggGroup = detailsProto.aggGroup
  if (detailsProto.underSymbol !== undefined) cd.underSymbol = detailsProto.underSymbol
  if (detailsProto.underSecType !== undefined) cd.underSecType = detailsProto.underSecType
  if (detailsProto.marketRuleIds !== undefined) cd.marketRuleIds = detailsProto.marketRuleIds
  if (detailsProto.realExpirationDate !== undefined) cd.realExpirationDate = detailsProto.realExpirationDate
  if (detailsProto.stockType !== undefined) cd.stockType = detailsProto.stockType
  if (detailsProto.minSize !== undefined) cd.minSize = new Decimal(detailsProto.minSize)
  if (detailsProto.sizeIncrement !== undefined) cd.sizeIncrement = new Decimal(detailsProto.sizeIncrement)
  if (detailsProto.suggestedSizeIncrement !== undefined) cd.suggestedSizeIncrement = new Decimal(detailsProto.suggestedSizeIncrement)
  if (detailsProto.minAlgoSize !== undefined) cd.minAlgoSize = new Decimal(detailsProto.minAlgoSize)
  if (detailsProto.lastPricePrecision !== undefined) cd.lastPricePrecision = new Decimal(detailsProto.lastPricePrecision)
  if (detailsProto.lastSizePrecision !== undefined) cd.lastSizePrecision = new Decimal(detailsProto.lastSizePrecision)

  setLastTradeDate(cd.contract.lastTradeDateOrContractMonth, cd, isBond)

  // Bond fields
  if (detailsProto.cusip !== undefined) cd.cusip = detailsProto.cusip
  if (detailsProto.ratings !== undefined) cd.ratings = detailsProto.ratings
  if (detailsProto.descAppend !== undefined) cd.descAppend = detailsProto.descAppend
  if (detailsProto.bondType !== undefined) cd.bondType = detailsProto.bondType
  if (detailsProto.coupon !== undefined) cd.coupon = detailsProto.coupon
  if (detailsProto.couponType !== undefined) cd.couponType = detailsProto.couponType
  if (detailsProto.callable !== undefined) cd.callable = detailsProto.callable
  if (detailsProto.puttable !== undefined) cd.putable = detailsProto.puttable
  if (detailsProto.convertible !== undefined) cd.convertible = detailsProto.convertible
  if (detailsProto.issueDate !== undefined) cd.issueDate = detailsProto.issueDate
  if (detailsProto.nextOptionDate !== undefined) cd.nextOptionDate = detailsProto.nextOptionDate
  if (detailsProto.nextOptionType !== undefined) cd.nextOptionType = detailsProto.nextOptionType
  if (detailsProto.nextOptionPartial !== undefined) cd.nextOptionPartial = detailsProto.nextOptionPartial
  if (detailsProto.bondNotes !== undefined) cd.notes = detailsProto.bondNotes

  // Fund fields
  if (detailsProto.fundName !== undefined) cd.fundName = detailsProto.fundName
  if (detailsProto.fundFamily !== undefined) cd.fundFamily = detailsProto.fundFamily
  if (detailsProto.fundType !== undefined) cd.fundType = detailsProto.fundType
  if (detailsProto.fundFrontLoad !== undefined) cd.fundFrontLoad = detailsProto.fundFrontLoad
  if (detailsProto.fundBackLoad !== undefined) cd.fundBackLoad = detailsProto.fundBackLoad
  if (detailsProto.fundBackLoadTimeInterval !== undefined) cd.fundBackLoadTimeInterval = detailsProto.fundBackLoadTimeInterval
  if (detailsProto.fundManagementFee !== undefined) cd.fundManagementFee = detailsProto.fundManagementFee
  if (detailsProto.fundClosed !== undefined) cd.fundClosed = detailsProto.fundClosed
  if (detailsProto.fundClosedForNewInvestors !== undefined) cd.fundClosedForNewInvestors = detailsProto.fundClosedForNewInvestors
  if (detailsProto.fundClosedForNewMoney !== undefined) cd.fundClosedForNewMoney = detailsProto.fundClosedForNewMoney
  if (detailsProto.fundNotifyAmount !== undefined) cd.fundNotifyAmount = detailsProto.fundNotifyAmount
  if (detailsProto.fundMinimumInitialPurchase !== undefined) cd.fundMinimumInitialPurchase = detailsProto.fundMinimumInitialPurchase
  if (detailsProto.fundMinimumSubsequentPurchase !== undefined) cd.fundSubsequentMinimumPurchase = detailsProto.fundMinimumSubsequentPurchase
  if (detailsProto.fundBlueSkyStates !== undefined) cd.fundBlueSkyStates = detailsProto.fundBlueSkyStates
  if (detailsProto.fundBlueSkyTerritories !== undefined) cd.fundBlueSkyTerritories = detailsProto.fundBlueSkyTerritories

  if (detailsProto.fundDistributionPolicyIndicator !== undefined) {
    cd.fundDistributionPolicyIndicator = getEnumTypeFromString(
      FundDistributionPolicyIndicator, detailsProto.fundDistributionPolicyIndicator,
    ) as typeof cd.fundDistributionPolicyIndicator
  }
  if (detailsProto.fundAssetType !== undefined) {
    cd.fundAssetType = getEnumTypeFromString(
      FundAssetType, detailsProto.fundAssetType,
    ) as typeof cd.fundAssetType
  }

  // Ineligibility reasons
  if (detailsProto.ineligibilityReasonList && detailsProto.ineligibilityReasonList.length > 0) {
    cd.ineligibilityReasonList = detailsProto.ineligibilityReasonList.map((rp) => {
      return new IneligibilityReason(rp.id, rp.description)
    })
  }

  // Event contract fields
  if (detailsProto.eventContract1 !== undefined) cd.eventContract1 = detailsProto.eventContract1
  if (detailsProto.eventContractDescription1 !== undefined) cd.eventContractDescription1 = detailsProto.eventContractDescription1
  if (detailsProto.eventContractDescription2 !== undefined) cd.eventContractDescription2 = detailsProto.eventContractDescription2

  return cd
}

// ---------------------------------------------------------------------------
// Text handlers
// ---------------------------------------------------------------------------

function processContractDataMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  let version = 8
  if (d.serverVersion < MIN_SERVER_VER_SIZE_RULES) {
    version = decodeInt(fields)
  }

  let reqId = -1
  if (version >= 3) {
    reqId = decodeInt(fields)
  }

  const contract = new ContractDetails()
  contract.contract.symbol = decodeStr(fields)
  contract.contract.secType = coerceSecType(decodeStr(fields))
  readLastTradeDate(fields, contract, false)
  if (d.serverVersion >= MIN_SERVER_VER_LAST_TRADE_DATE) {
    contract.contract.lastTradeDate = decodeStr(fields)
  }
  contract.contract.strike = decodeFloat(fields)
  contract.contract.right = decodeStr(fields)
  contract.contract.exchange = decodeStr(fields)
  contract.contract.currency = decodeStr(fields)
  contract.contract.localSymbol = decodeStr(fields)
  contract.marketName = decodeStr(fields)
  contract.contract.tradingClass = decodeStr(fields)
  contract.contract.conId = decodeInt(fields)
  contract.minTick = decodeFloat(fields)
  if (
    d.serverVersion >= MIN_SERVER_VER_MD_SIZE_MULTIPLIER &&
    d.serverVersion < MIN_SERVER_VER_SIZE_RULES
  ) {
    decodeInt(fields) // mdSizeMultiplier - not used anymore
  }
  contract.contract.multiplier = decodeStr(fields)
  contract.orderTypes = decodeStr(fields)
  contract.validExchanges = decodeStr(fields)
  contract.priceMagnifier = decodeInt(fields) // ver 2
  if (version >= 4) {
    contract.underConId = decodeInt(fields)
  }
  if (version >= 5) {
    contract.longName =
      d.serverVersion >= MIN_SERVER_VER_ENCODE_MSG_ASCII7
        ? decodeStr(fields) // Python does unicode-escape; we just read the string
        : decodeStr(fields)
    contract.contract.primaryExchange = decodeStr(fields)
  }
  if (version >= 6) {
    contract.contractMonth = decodeStr(fields)
    contract.industry = decodeStr(fields)
    contract.category = decodeStr(fields)
    contract.subcategory = decodeStr(fields)
    contract.timeZoneId = decodeStr(fields)
    contract.tradingHours = decodeStr(fields)
    contract.liquidHours = decodeStr(fields)
  }
  if (version >= 8) {
    contract.evRule = decodeStr(fields)
    contract.evMultiplier = decodeInt(fields)
  }
  if (version >= 7) {
    const secIdListCount = decodeInt(fields)
    if (secIdListCount > 0) {
      contract.secIdList = []
      for (let i = 0; i < secIdListCount; i++) {
        const tagValue = new TagValue()
        tagValue.tag = decodeStr(fields)
        tagValue.value = decodeStr(fields)
        contract.secIdList.push(tagValue)
      }
    }
  }

  if (d.serverVersion >= MIN_SERVER_VER_AGG_GROUP) {
    contract.aggGroup = decodeInt(fields)
  }

  if (d.serverVersion >= MIN_SERVER_VER_UNDERLYING_INFO) {
    contract.underSymbol = decodeStr(fields)
    contract.underSecType = decodeStr(fields)
  }

  if (d.serverVersion >= MIN_SERVER_VER_MARKET_RULES) {
    contract.marketRuleIds = decodeStr(fields)
  }

  if (d.serverVersion >= MIN_SERVER_VER_REAL_EXPIRATION_DATE) {
    contract.realExpirationDate = decodeStr(fields)
  }

  if (d.serverVersion >= MIN_SERVER_VER_STOCK_TYPE) {
    contract.stockType = decodeStr(fields)
  }

  if (
    d.serverVersion >= MIN_SERVER_VER_FRACTIONAL_SIZE_SUPPORT &&
    d.serverVersion < MIN_SERVER_VER_SIZE_RULES
  ) {
    decodeDecimal(fields) // sizeMinTick - not used anymore
  }

  if (d.serverVersion >= MIN_SERVER_VER_SIZE_RULES) {
    contract.minSize = decodeDecimal(fields)
    contract.sizeIncrement = decodeDecimal(fields)
    contract.suggestedSizeIncrement = decodeDecimal(fields)
  }

  if (
    d.serverVersion >= MIN_SERVER_VER_FUND_DATA_FIELDS &&
    contract.contract.secType === 'FUND'
  ) {
    contract.fundName = decodeStr(fields)
    contract.fundFamily = decodeStr(fields)
    contract.fundType = decodeStr(fields)
    contract.fundFrontLoad = decodeStr(fields)
    contract.fundBackLoad = decodeStr(fields)
    contract.fundBackLoadTimeInterval = decodeStr(fields)
    contract.fundManagementFee = decodeStr(fields)
    contract.fundClosed = decodeBool(fields)
    contract.fundClosedForNewInvestors = decodeBool(fields)
    contract.fundClosedForNewMoney = decodeBool(fields)
    contract.fundNotifyAmount = decodeStr(fields)
    contract.fundMinimumInitialPurchase = decodeStr(fields)
    contract.fundSubsequentMinimumPurchase = decodeStr(fields)
    contract.fundBlueSkyStates = decodeStr(fields)
    contract.fundBlueSkyTerritories = decodeStr(fields)
    contract.fundDistributionPolicyIndicator = getEnumTypeFromString(
      FundDistributionPolicyIndicator, decodeStr(fields),
    ) as typeof contract.fundDistributionPolicyIndicator
    contract.fundAssetType = getEnumTypeFromString(
      FundAssetType, decodeStr(fields),
    ) as typeof contract.fundAssetType
  }

  if (d.serverVersion >= MIN_SERVER_VER_INELIGIBILITY_REASONS) {
    const ineligibilityReasonListCount = decodeInt(fields)
    if (ineligibilityReasonListCount > 0) {
      contract.ineligibilityReasonList = []
      for (let i = 0; i < ineligibilityReasonListCount; i++) {
        const reason = new IneligibilityReason()
        reason.id = decodeStr(fields)
        reason.description = decodeStr(fields)
        contract.ineligibilityReasonList.push(reason)
      }
    }
  }

  d.wrapper.contractDetails(reqId, contract)
}

function processBondContractDataMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  let version = 6
  if (d.serverVersion < MIN_SERVER_VER_SIZE_RULES) {
    version = decodeInt(fields)
  }

  let reqId = -1
  if (version >= 3) {
    reqId = decodeInt(fields)
  }

  const contract = new ContractDetails()
  contract.contract.symbol = decodeStr(fields)
  contract.contract.secType = coerceSecType(decodeStr(fields))
  contract.cusip = decodeStr(fields)
  contract.coupon = decodeFloat(fields)
  readLastTradeDate(fields, contract, true)
  contract.issueDate = decodeStr(fields)
  contract.ratings = decodeStr(fields)
  contract.bondType = decodeStr(fields)
  contract.couponType = decodeStr(fields)
  contract.convertible = decodeBool(fields)
  contract.callable = decodeBool(fields)
  contract.putable = decodeBool(fields)
  contract.descAppend = decodeStr(fields)
  contract.contract.exchange = decodeStr(fields)
  contract.contract.currency = decodeStr(fields)
  contract.marketName = decodeStr(fields)
  contract.contract.tradingClass = decodeStr(fields)
  contract.contract.conId = decodeInt(fields)
  contract.minTick = decodeFloat(fields)
  if (
    d.serverVersion >= MIN_SERVER_VER_MD_SIZE_MULTIPLIER &&
    d.serverVersion < MIN_SERVER_VER_SIZE_RULES
  ) {
    decodeInt(fields) // mdSizeMultiplier - not used anymore
  }
  contract.orderTypes = decodeStr(fields)
  contract.validExchanges = decodeStr(fields)
  contract.nextOptionDate = decodeStr(fields) // ver 2
  contract.nextOptionType = decodeStr(fields) // ver 2
  contract.nextOptionPartial = decodeBool(fields) // ver 2
  contract.notes = decodeStr(fields) // ver 2
  if (version >= 4) {
    contract.longName = decodeStr(fields)
  }
  if (d.serverVersion >= MIN_SERVER_VER_BOND_TRADING_HOURS) {
    contract.timeZoneId = decodeStr(fields)
    contract.tradingHours = decodeStr(fields)
    contract.liquidHours = decodeStr(fields)
  }
  if (version >= 6) {
    contract.evRule = decodeStr(fields)
    contract.evMultiplier = decodeInt(fields)
  }
  if (version >= 5) {
    const secIdListCount = decodeInt(fields)
    if (secIdListCount > 0) {
      contract.secIdList = []
      for (let i = 0; i < secIdListCount; i++) {
        const tagValue = new TagValue()
        tagValue.tag = decodeStr(fields)
        tagValue.value = decodeStr(fields)
        contract.secIdList.push(tagValue)
      }
    }
  }

  if (d.serverVersion >= MIN_SERVER_VER_AGG_GROUP) {
    contract.aggGroup = decodeInt(fields)
  }

  if (d.serverVersion >= MIN_SERVER_VER_MARKET_RULES) {
    contract.marketRuleIds = decodeStr(fields)
  }

  if (d.serverVersion >= MIN_SERVER_VER_SIZE_RULES) {
    contract.minSize = decodeDecimal(fields)
    contract.sizeIncrement = decodeDecimal(fields)
    contract.suggestedSizeIncrement = decodeDecimal(fields)
  }

  d.wrapper.bondContractDetails(reqId, contract)
}

function processContractDataEndMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  decodeInt(fields) // version
  const reqId = decodeInt(fields)
  d.wrapper.contractDetailsEnd(reqId)
}

function processSymbolSamplesMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const reqId = decodeInt(fields)
  const nContractDescriptions = decodeInt(fields)
  const contractDescriptions: ContractDescription[] = []
  for (let i = 0; i < nContractDescriptions; i++) {
    const conDesc = new ContractDescription()
    conDesc.contract.conId = decodeInt(fields)
    conDesc.contract.symbol = decodeStr(fields)
    conDesc.contract.secType = coerceSecType(decodeStr(fields))
    conDesc.contract.primaryExchange = decodeStr(fields)
    conDesc.contract.currency = decodeStr(fields)

    const nDerivativeSecTypes = decodeInt(fields)
    conDesc.derivativeSecTypes = []
    for (let j = 0; j < nDerivativeSecTypes; j++) {
      conDesc.derivativeSecTypes.push(decodeStr(fields))
    }
    contractDescriptions.push(conDesc)

    if (d.serverVersion >= MIN_SERVER_VER_BOND_ISSUERID) {
      conDesc.contract.description = decodeStr(fields)
      conDesc.contract.issuerId = decodeStr(fields)
    }
  }

  d.wrapper.symbolSamples(reqId, contractDescriptions)
}

function processDeltaNeutralValidationMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  decodeInt(fields) // version
  const reqId = decodeInt(fields)

  const deltaNeutralContract = new DeltaNeutralContract()
  deltaNeutralContract.conId = decodeInt(fields)
  deltaNeutralContract.delta = decodeFloat(fields)
  deltaNeutralContract.price = decodeFloat(fields)

  d.wrapper.deltaNeutralValidation(reqId, deltaNeutralContract)
}

function processMarketRuleMsg(d: Decoder, fields: Iterator<string>): void {
  decodeInt(fields) // msgId
  const marketRuleId = decodeInt(fields)

  const nPriceIncrements = decodeInt(fields)
  const priceIncrements: PriceIncrement[] = []

  if (nPriceIncrements > 0) {
    for (let i = 0; i < nPriceIncrements; i++) {
      const prcInc = new PriceIncrement()
      prcInc.lowEdge = decodeFloat(fields)
      prcInc.increment = decodeFloat(fields)
      priceIncrements.push(prcInc)
    }
  }

  d.wrapper.marketRule(marketRuleId, priceIncrements)
}

// ---------------------------------------------------------------------------
// Protobuf handlers
// ---------------------------------------------------------------------------

function processContractDataMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = ContractDataProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID

  if (proto.contract === undefined || proto.contractDetails === undefined) {
    return
  }
  const contractDetails = decodeContractDetailsFromProto(proto.contract, proto.contractDetails, false)

  d.wrapper.contractDetails(reqId, contractDetails)
}

function processBondContractDataMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = ContractDataProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID

  if (proto.contract === undefined || proto.contractDetails === undefined) {
    return
  }
  const contractDetails = decodeContractDetailsFromProto(proto.contract, proto.contractDetails, true)

  d.wrapper.bondContractDetails(reqId, contractDetails)
}

function processContractDataEndMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = ContractDataEndProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID

  d.wrapper.contractDetailsEnd(reqId)
}

function processSymbolSamplesMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = SymbolSamplesProto.decode(buf)

  const reqId = proto.reqId ?? NO_VALID_ID

  const contractDescriptions: ContractDescription[] = []
  if (proto.contractDescriptions) {
    for (const cdProto of proto.contractDescriptions) {
      const conDesc = new ContractDescription()
      if (cdProto.contract !== undefined) {
        conDesc.contract = decodeContractFromProto(cdProto.contract)
      }
      conDesc.derivativeSecTypes = cdProto.derivativeSecTypes ? [...cdProto.derivativeSecTypes] : []
      contractDescriptions.push(conDesc)
    }
  }

  d.wrapper.symbolSamples(reqId, contractDescriptions)
}

function processMarketRuleMsgProtoBuf(d: Decoder, buf: Buffer): void {
  const proto = MarketRuleProto.decode(buf)

  const marketRuleId = proto.marketRuleId ?? 0

  const priceIncrements: PriceIncrement[] = []
  if (proto.priceIncrements) {
    for (const pip of proto.priceIncrements) {
      const pi = new PriceIncrement()
      if (pip.lowEdge !== undefined) pi.lowEdge = pip.lowEdge
      if (pip.increment !== undefined) pi.increment = pip.increment
      priceIncrements.push(pi)
    }
  }

  d.wrapper.marketRule(marketRuleId, priceIncrements)
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function applyContractHandlers(decoder: Decoder): void {
  // Text handlers
  decoder.registerText(IN.CONTRACT_DATA, processContractDataMsg)
  decoder.registerText(IN.BOND_CONTRACT_DATA, processBondContractDataMsg)
  decoder.registerText(IN.CONTRACT_DATA_END, processContractDataEndMsg)
  decoder.registerText(IN.SYMBOL_SAMPLES, processSymbolSamplesMsg)
  decoder.registerText(IN.DELTA_NEUTRAL_VALIDATION, processDeltaNeutralValidationMsg)
  decoder.registerText(IN.MARKET_RULE, processMarketRuleMsg)

  // Protobuf handlers
  decoder.registerProto(IN.CONTRACT_DATA, processContractDataMsgProtoBuf)
  decoder.registerProto(IN.BOND_CONTRACT_DATA, processBondContractDataMsgProtoBuf)
  decoder.registerProto(IN.CONTRACT_DATA_END, processContractDataEndMsgProtoBuf)
  decoder.registerProto(IN.SYMBOL_SAMPLES, processSymbolSamplesMsgProtoBuf)
  decoder.registerProto(IN.MARKET_RULE, processMarketRuleMsgProtoBuf)
}
