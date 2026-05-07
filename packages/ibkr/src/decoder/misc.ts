/**
 * Miscellaneous decoder handlers (text + protobuf).
 *
 * Message types:
 *   IN.ERR_MSG                                     (4)
 *   IN.CURRENT_TIME                                (49)
 *   IN.CURRENT_TIME_IN_MILLIS                      (109)
 *   IN.NEWS_BULLETINS                              (14)
 *   IN.RECEIVE_FA                                  (16)
 *   IN.SCANNER_PARAMETERS                          (19)
 *   IN.SCANNER_DATA                                (20)
 *   IN.FUNDAMENTAL_DATA                            (51)
 *   IN.NEWS_PROVIDERS                              (85)
 *   IN.NEWS_ARTICLE                                (83)
 *   IN.TICK_NEWS                                   (84)
 *   IN.HISTORICAL_NEWS                             (86)
 *   IN.HISTORICAL_NEWS_END                         (87)
 *   IN.SECURITY_DEFINITION_OPTION_PARAMETER        (75)
 *   IN.SECURITY_DEFINITION_OPTION_PARAMETER_END    (76)
 *   IN.SOFT_DOLLAR_TIERS                           (77)
 *   IN.FAMILY_CODES                                (78)
 *   IN.SMART_COMPONENTS                            (82)
 *   IN.MKT_DEPTH_EXCHANGES                         (80)
 *   IN.VERIFY_MESSAGE_API                          (65)
 *   IN.VERIFY_COMPLETED                            (66)
 *   IN.VERIFY_AND_AUTH_MESSAGE_API                  (69)
 *   IN.VERIFY_AND_AUTH_COMPLETED                    (70)
 *   IN.DISPLAY_GROUP_LIST                           (67)
 *   IN.DISPLAY_GROUP_UPDATED                        (68)
 *   IN.WSH_META_DATA                                (104)
 *   IN.WSH_EVENT_DATA                               (105)
 *   IN.USER_INFO                                    (107)
 *   IN.REPLACE_FA_END                               (103)
 *   IN.CONFIG_RESPONSE                              (110)
 *   IN.UPDATE_CONFIG_RESPONSE                       (111)
 */

import type { Decoder } from './base.js'
import { IN } from '../message.js'
import { NO_VALID_ID } from '../const.js'
import {
  decodeStr,
  decodeInt,
  decodeFloat,
  decodeBool,
} from '../utils.js'
import {
  MIN_SERVER_VER_ADVANCED_ORDER_REJECT,
  MIN_SERVER_VER_ERROR_TIME,
  MIN_SERVER_VER_SERVICE_DATA_TYPE,
} from '../server-versions.js'
import { SoftDollarTier } from '../softdollartier.js'
import {
  FamilyCode,
  SmartComponent,
  DepthMktDataDescription,
  NewsProvider,
} from '../common.js'
import { ScanData } from '../scanner.js'
import { ContractDetails, Contract, coerceSecType } from '../contract.js'

// Protobuf message types
import { CurrentTime as CurrentTimeProto } from '../protobuf/CurrentTime.js'
import { CurrentTimeInMillis as CurrentTimeInMillisProto } from '../protobuf/CurrentTimeInMillis.js'
import { ErrorMessage as ErrorMessageProto } from '../protobuf/ErrorMessage.js'
import { NewsBulletin as NewsBulletinProto } from '../protobuf/NewsBulletin.js'
import { ReceiveFA as ReceiveFAProto } from '../protobuf/ReceiveFA.js'
import { ScannerParameters as ScannerParametersProto } from '../protobuf/ScannerParameters.js'
import { ScannerData as ScannerDataProto } from '../protobuf/ScannerData.js'
import { FundamentalsData as FundamentalsDataProto } from '../protobuf/FundamentalsData.js'
import { NewsProviders as NewsProvidersProto } from '../protobuf/NewsProviders.js'
import { NewsArticle as NewsArticleProto } from '../protobuf/NewsArticle.js'
import { TickNews as TickNewsProto } from '../protobuf/TickNews.js'
import { HistoricalNews as HistoricalNewsProto } from '../protobuf/HistoricalNews.js'
import { HistoricalNewsEnd as HistoricalNewsEndProto } from '../protobuf/HistoricalNewsEnd.js'
import { SecDefOptParameter as SecDefOptParameterProto } from '../protobuf/SecDefOptParameter.js'
import { SecDefOptParameterEnd as SecDefOptParameterEndProto } from '../protobuf/SecDefOptParameterEnd.js'
import { SoftDollarTiers as SoftDollarTiersProto } from '../protobuf/SoftDollarTiers.js'
import type { SoftDollarTier as SoftDollarTierProto } from '../protobuf/SoftDollarTier.js'
import { FamilyCodes as FamilyCodesProto } from '../protobuf/FamilyCodes.js'
import type { FamilyCode as FamilyCodeProto } from '../protobuf/FamilyCode.js'
import { SmartComponents as SmartComponentsProto } from '../protobuf/SmartComponents.js'
import type { SmartComponent as SmartComponentProto } from '../protobuf/SmartComponent.js'
import { MarketDepthExchanges as MarketDepthExchangesProto } from '../protobuf/MarketDepthExchanges.js'
import type { DepthMarketDataDescription as DepthMarketDataDescriptionProto } from '../protobuf/DepthMarketDataDescription.js'
import { VerifyMessageApi as VerifyMessageApiProto } from '../protobuf/VerifyMessageApi.js'
import { VerifyCompleted as VerifyCompletedProto } from '../protobuf/VerifyCompleted.js'
import { DisplayGroupList as DisplayGroupListProto } from '../protobuf/DisplayGroupList.js'
import { DisplayGroupUpdated as DisplayGroupUpdatedProto } from '../protobuf/DisplayGroupUpdated.js'
import { WshMetaData as WshMetaDataProto } from '../protobuf/WshMetaData.js'
import { WshEventData as WshEventDataProto } from '../protobuf/WshEventData.js'
import { UserInfo as UserInfoProto } from '../protobuf/UserInfo.js'
import { ReplaceFAEnd as ReplaceFAEndProto } from '../protobuf/ReplaceFAEnd.js'
import { ConfigResponse as ConfigResponseProto } from '../protobuf/ConfigResponse.js'
import { UpdateConfigResponse as UpdateConfigResponseProto } from '../protobuf/UpdateConfigResponse.js'
import type { Contract as ContractProto } from '../protobuf/Contract.js'

// ---------------------------------------------------------------------------
// Protobuf → domain helpers
// ---------------------------------------------------------------------------

function decodeContractFromProto(cp: ContractProto): Contract {
  const contract = new Contract()
  if (cp.conId !== undefined) contract.conId = cp.conId
  if (cp.symbol !== undefined) contract.symbol = cp.symbol
  if (cp.secType !== undefined) 
  if (cp.lastTradeDateOrContractMonth !== undefined) contract.lastTradeDateOrContractMonth = cp.lastTradeDateOrContractMonth
  if (cp.strike !== undefined) contract.strike = cp.strike
  if (cp.right !== undefined) contract.right = cp.right
  if (cp.multiplier !== undefined) contract.multiplier = String(cp.multiplier)
  if (cp.exchange !== undefined) contract.exchange = cp.exchange
  if (cp.currency !== undefined) contract.currency = cp.currency
  if (cp.localSymbol !== undefined) contract.localSymbol = cp.localSymbol
  if (cp.tradingClass !== undefined) contract.tradingClass = cp.tradingClass
  return contract
}

function decodeSoftDollarTierFromProto(p: SoftDollarTierProto): SoftDollarTier {
  return new SoftDollarTier(
    p.name ?? '',
    p.value ?? '',
    p.displayName ?? '',
  )
}

function decodeFamilyCodeFromProto(p: FamilyCodeProto): FamilyCode {
  const fc = new FamilyCode()
  fc.accountID = p.accountId ?? ''
  fc.familyCodeStr = p.familyCode ?? ''
  return fc
}

function decodeSmartComponentFromProto(p: SmartComponentProto): SmartComponent {
  const sc = new SmartComponent()
  sc.bitNumber = p.bitNumber ?? 0
  sc.exchange = p.exchange ?? ''
  sc.exchangeLetter = p.exchangeLetter ?? ''
  return sc
}

function decodeDepthMktDataDescFromProto(p: DepthMarketDataDescriptionProto): DepthMktDataDescription {
  const desc = new DepthMktDataDescription()
  desc.exchange = p.exchange ?? ''
  desc.secType = p.secType ?? ''
  desc.listingExch = p.listingExch ?? ''
  desc.serviceDataType = p.serviceDataType ?? ''
  desc.aggGroup = p.aggGroup ?? 0
  return desc
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function applyMiscHandlers(decoder: Decoder): void {

  // ========================================================================
  // Text handlers
  // ========================================================================

  // --- IN.ERR_MSG (4) ---
  decoder.registerText(IN.ERR_MSG, (d, fields) => {
    decodeInt(fields) // msgId
    if (d.serverVersion < MIN_SERVER_VER_ERROR_TIME) {
      decodeInt(fields) // version
    }
    const reqId = decodeInt(fields)
    const errorCode = decodeInt(fields)
    const errorString = decodeStr(fields)
    let advancedOrderRejectJson = ''
    if (d.serverVersion >= MIN_SERVER_VER_ADVANCED_ORDER_REJECT) {
      advancedOrderRejectJson = decodeStr(fields)
    }
    let errorTime = 0
    if (d.serverVersion >= MIN_SERVER_VER_ERROR_TIME) {
      errorTime = decodeInt(fields)
    }
    d.wrapper.error(reqId, errorTime, errorCode, errorString, advancedOrderRejectJson)
  })

  // --- IN.CURRENT_TIME (49) ---
  decoder.registerText(IN.CURRENT_TIME, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const time = decodeInt(fields)
    d.wrapper.currentTime(time)
  })

  // --- IN.CURRENT_TIME_IN_MILLIS (109) ---
  decoder.registerText(IN.CURRENT_TIME_IN_MILLIS, (d, fields) => {
    decodeInt(fields) // msgId
    const timeInMillis = decodeInt(fields)
    d.wrapper.currentTimeInMillis(timeInMillis)
  })

  // --- IN.NEWS_BULLETINS (14) ---
  decoder.registerText(IN.NEWS_BULLETINS, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const msgId = decodeInt(fields)
    const msgType = decodeInt(fields)
    const message = decodeStr(fields)
    const originExch = decodeStr(fields)
    d.wrapper.updateNewsBulletin(msgId, msgType, message, originExch)
  })

  // --- IN.RECEIVE_FA (16) ---
  decoder.registerText(IN.RECEIVE_FA, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const faDataType = decodeInt(fields)
    const xml = decodeStr(fields)
    d.wrapper.receiveFA(faDataType, xml)
  })

  // --- IN.SCANNER_PARAMETERS (19) ---
  decoder.registerText(IN.SCANNER_PARAMETERS, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const xml = decodeStr(fields)
    d.wrapper.scannerParameters(xml)
  })

  // --- IN.SCANNER_DATA (20) ---
  decoder.registerText(IN.SCANNER_DATA, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)

    const numberOfElements = decodeInt(fields)

    for (let i = 0; i < numberOfElements; i++) {
      const data = new ScanData()
      const contractDetails = new ContractDetails()
      data.contract = contractDetails.contract

      data.rank = decodeInt(fields)
      contractDetails.contract.conId = decodeInt(fields) // ver 3
      contractDetails.contract.symbol = decodeStr(fields)
      contractDetails.contract.secType = coerceSecType(decodeStr(fields))
      contractDetails.contract.lastTradeDateOrContractMonth = decodeStr(fields)
      contractDetails.contract.strike = decodeFloat(fields)
      contractDetails.contract.right = decodeStr(fields)
      contractDetails.contract.exchange = decodeStr(fields)
      contractDetails.contract.currency = decodeStr(fields)
      contractDetails.contract.localSymbol = decodeStr(fields)
      contractDetails.marketName = decodeStr(fields)
      contractDetails.contract.tradingClass = decodeStr(fields)
      data.distance = decodeStr(fields)
      data.benchmark = decodeStr(fields)
      data.projection = decodeStr(fields)
      data.legsStr = decodeStr(fields)
      d.wrapper.scannerData(
        reqId, data.rank, contractDetails,
        data.distance, data.benchmark, data.projection, data.legsStr,
      )
    }

    d.wrapper.scannerDataEnd(reqId)
  })

  // --- IN.FUNDAMENTAL_DATA (51) ---
  decoder.registerText(IN.FUNDAMENTAL_DATA, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const data = decodeStr(fields)
    d.wrapper.fundamentalData(reqId, data)
  })

  // --- IN.NEWS_PROVIDERS (85) ---
  decoder.registerText(IN.NEWS_PROVIDERS, (d, fields) => {
    decodeInt(fields) // msgId
    const newsProviders: NewsProvider[] = []
    const nNewsProviders = decodeInt(fields)
    if (nNewsProviders > 0) {
      for (let i = 0; i < nNewsProviders; i++) {
        const provider = new NewsProvider()
        provider.code = decodeStr(fields)
        provider.name = decodeStr(fields)
        newsProviders.push(provider)
      }
    }
    d.wrapper.newsProviders(newsProviders)
  })

  // --- IN.NEWS_ARTICLE (83) ---
  decoder.registerText(IN.NEWS_ARTICLE, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const articleType = decodeInt(fields)
    const articleText = decodeStr(fields)
    d.wrapper.newsArticle(reqId, articleType, articleText)
  })

  // --- IN.TICK_NEWS (84) ---
  decoder.registerText(IN.TICK_NEWS, (d, fields) => {
    decodeInt(fields) // msgId
    const tickerId = decodeInt(fields)
    const timeStamp = decodeInt(fields)
    const providerCode = decodeStr(fields)
    const articleId = decodeStr(fields)
    const headline = decodeStr(fields)
    const extraData = decodeStr(fields)
    d.wrapper.tickNews(tickerId, timeStamp, providerCode, articleId, headline, extraData)
  })

  // --- IN.HISTORICAL_NEWS (86) ---
  decoder.registerText(IN.HISTORICAL_NEWS, (d, fields) => {
    decodeInt(fields) // msgId
    const requestId = decodeInt(fields)
    const time = decodeStr(fields)
    const providerCode = decodeStr(fields)
    const articleId = decodeStr(fields)
    const headline = decodeStr(fields)
    d.wrapper.historicalNews(requestId, time, providerCode, articleId, headline)
  })

  // --- IN.HISTORICAL_NEWS_END (87) ---
  decoder.registerText(IN.HISTORICAL_NEWS_END, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const hasMore = decodeBool(fields)
    d.wrapper.historicalNewsEnd(reqId, hasMore)
  })

  // --- IN.SECURITY_DEFINITION_OPTION_PARAMETER (75) ---
  decoder.registerText(IN.SECURITY_DEFINITION_OPTION_PARAMETER, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const exchange = decodeStr(fields)
    const underlyingConId = decodeInt(fields)
    const tradingClass = decodeStr(fields)
    const multiplier = decodeStr(fields)

    const expCount = decodeInt(fields)
    const expirations = new Set<string>()
    for (let i = 0; i < expCount; i++) {
      expirations.add(decodeStr(fields))
    }

    const strikeCount = decodeInt(fields)
    const strikes = new Set<number>()
    for (let i = 0; i < strikeCount; i++) {
      strikes.add(decodeFloat(fields))
    }

    d.wrapper.securityDefinitionOptionParameter(
      reqId, exchange, underlyingConId, tradingClass, multiplier,
      expirations, strikes,
    )
  })

  // --- IN.SECURITY_DEFINITION_OPTION_PARAMETER_END (76) ---
  decoder.registerText(IN.SECURITY_DEFINITION_OPTION_PARAMETER_END, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    d.wrapper.securityDefinitionOptionParameterEnd(reqId)
  })

  // --- IN.SOFT_DOLLAR_TIERS (77) ---
  decoder.registerText(IN.SOFT_DOLLAR_TIERS, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const nTiers = decodeInt(fields)

    const tiers: SoftDollarTier[] = []
    for (let i = 0; i < nTiers; i++) {
      const tier = new SoftDollarTier()
      tier.name = decodeStr(fields)
      tier.val = decodeStr(fields)
      tier.displayName = decodeStr(fields)
      tiers.push(tier)
    }

    d.wrapper.softDollarTiers(reqId, tiers)
  })

  // --- IN.FAMILY_CODES (78) ---
  decoder.registerText(IN.FAMILY_CODES, (d, fields) => {
    decodeInt(fields) // msgId
    const nFamilyCodes = decodeInt(fields)
    const familyCodes: FamilyCode[] = []
    for (let i = 0; i < nFamilyCodes; i++) {
      const famCode = new FamilyCode()
      famCode.accountID = decodeStr(fields)
      famCode.familyCodeStr = decodeStr(fields)
      familyCodes.push(famCode)
    }
    d.wrapper.familyCodes(familyCodes)
  })

  // --- IN.SMART_COMPONENTS (82) ---
  decoder.registerText(IN.SMART_COMPONENTS, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const n = decodeInt(fields)

    const smartComponentMap: SmartComponent[] = []
    for (let i = 0; i < n; i++) {
      const smartComponent = new SmartComponent()
      smartComponent.bitNumber = decodeInt(fields)
      smartComponent.exchange = decodeStr(fields)
      smartComponent.exchangeLetter = decodeStr(fields)
      smartComponentMap.push(smartComponent)
    }

    d.wrapper.smartComponents(reqId, smartComponentMap)
  })

  // --- IN.MKT_DEPTH_EXCHANGES (80) ---
  decoder.registerText(IN.MKT_DEPTH_EXCHANGES, (d, fields) => {
    decodeInt(fields) // msgId
    const depthMktDataDescriptions: DepthMktDataDescription[] = []
    const nDepthMktDataDescriptions = decodeInt(fields)

    if (nDepthMktDataDescriptions > 0) {
      for (let i = 0; i < nDepthMktDataDescriptions; i++) {
        const desc = new DepthMktDataDescription()
        desc.exchange = decodeStr(fields)
        desc.secType = coerceSecType(decodeStr(fields))
        if (d.serverVersion >= MIN_SERVER_VER_SERVICE_DATA_TYPE) {
          desc.listingExch = decodeStr(fields)
          desc.serviceDataType = decodeStr(fields)
          desc.aggGroup = decodeInt(fields)
        } else {
          decodeInt(fields) // boolean notSuppIsL2
        }
        depthMktDataDescriptions.push(desc)
      }
    }

    d.wrapper.mktDepthExchanges(depthMktDataDescriptions)
  })

  // --- IN.VERIFY_MESSAGE_API (65) ---
  decoder.registerText(IN.VERIFY_MESSAGE_API, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const apiData = decodeStr(fields)
    d.wrapper.verifyMessageAPI(apiData)
  })

  // --- IN.VERIFY_COMPLETED (66) ---
  decoder.registerText(IN.VERIFY_COMPLETED, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const isSuccessful = decodeBool(fields)
    const errorText = decodeStr(fields)
    d.wrapper.verifyCompleted(isSuccessful, errorText)
  })

  // --- IN.VERIFY_AND_AUTH_MESSAGE_API (69) ---
  decoder.registerText(IN.VERIFY_AND_AUTH_MESSAGE_API, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const apiData = decodeStr(fields)
    const xyzChallenge = decodeStr(fields)
    d.wrapper.verifyAndAuthMessageAPI(apiData, xyzChallenge)
  })

  // --- IN.VERIFY_AND_AUTH_COMPLETED (70) ---
  decoder.registerText(IN.VERIFY_AND_AUTH_COMPLETED, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const isSuccessful = decodeBool(fields)
    const errorText = decodeStr(fields)
    d.wrapper.verifyAndAuthCompleted(isSuccessful, errorText)
  })

  // --- IN.DISPLAY_GROUP_LIST (67) ---
  decoder.registerText(IN.DISPLAY_GROUP_LIST, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const groups = decodeStr(fields)
    d.wrapper.displayGroupList(reqId, groups)
  })

  // --- IN.DISPLAY_GROUP_UPDATED (68) ---
  decoder.registerText(IN.DISPLAY_GROUP_UPDATED, (d, fields) => {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const contractInfo = decodeStr(fields)
    d.wrapper.displayGroupUpdated(reqId, contractInfo)
  })

  // --- IN.WSH_META_DATA (104) ---
  decoder.registerText(IN.WSH_META_DATA, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const dataJson = decodeStr(fields)
    d.wrapper.wshMetaData(reqId, dataJson)
  })

  // --- IN.WSH_EVENT_DATA (105) ---
  decoder.registerText(IN.WSH_EVENT_DATA, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const dataJson = decodeStr(fields)
    d.wrapper.wshEventData(reqId, dataJson)
  })

  // --- IN.USER_INFO (107) ---
  decoder.registerText(IN.USER_INFO, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const whiteBrandingId = decodeStr(fields)
    d.wrapper.userInfo(reqId, whiteBrandingId)
  })

  // --- IN.REPLACE_FA_END (103) ---
  decoder.registerText(IN.REPLACE_FA_END, (d, fields) => {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const text = decodeStr(fields)
    d.wrapper.replaceFAEnd(reqId, text)
  })

  // ========================================================================
  // Protobuf handlers
  // ========================================================================

  // --- IN.ERR_MSG (4) ---
  decoder.registerProto(IN.ERR_MSG, (d, buf) => {
    const proto = ErrorMessageProto.decode(buf)
    d.wrapper.error(
      proto.id ?? -1,
      proto.errorTime ?? 0,
      proto.errorCode ?? 0,
      proto.errorMsg ?? '',
      proto.advancedOrderRejectJson ?? '',
    )
  })

  // --- IN.CURRENT_TIME (49) ---
  decoder.registerProto(IN.CURRENT_TIME, (d, buf) => {
    const proto = CurrentTimeProto.decode(buf)
    d.wrapper.currentTime(proto.currentTime ?? 0)
  })

  // --- IN.CURRENT_TIME_IN_MILLIS (109) ---
  decoder.registerProto(IN.CURRENT_TIME_IN_MILLIS, (d, buf) => {
    const proto = CurrentTimeInMillisProto.decode(buf)
    d.wrapper.currentTimeInMillis(proto.currentTimeInMillis ?? 0)
  })

  // --- IN.NEWS_BULLETINS (14) ---
  decoder.registerProto(IN.NEWS_BULLETINS, (d, buf) => {
    const proto = NewsBulletinProto.decode(buf)
    d.wrapper.updateNewsBulletin(
      proto.newsMsgId ?? 0,
      proto.newsMsgType ?? 0,
      proto.newsMessage ?? '',
      proto.originatingExch ?? '',
    )
  })

  // --- IN.RECEIVE_FA (16) ---
  decoder.registerProto(IN.RECEIVE_FA, (d, buf) => {
    const proto = ReceiveFAProto.decode(buf)
    d.wrapper.receiveFA(
      proto.faDataType ?? 0,
      proto.xml ?? '',
    )
  })

  // --- IN.SCANNER_PARAMETERS (19) ---
  decoder.registerProto(IN.SCANNER_PARAMETERS, (d, buf) => {
    const proto = ScannerParametersProto.decode(buf)
    d.wrapper.scannerParameters(proto.xml ?? '')
  })

  // --- IN.SCANNER_DATA (20) ---
  decoder.registerProto(IN.SCANNER_DATA, (d, buf) => {
    const proto = ScannerDataProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID

    if (proto.scannerDataElement) {
      for (const element of proto.scannerDataElement) {
        const rank = element.rank ?? 0
        const contractDetails = new ContractDetails()
        if (element.contract) {
          contractDetails.contract = decodeContractFromProto(element.contract)
          contractDetails.marketName = element.marketName ?? ''
        }
        const distance = element.distance ?? ''
        const benchmark = element.benchmark ?? ''
        const projection = element.projection ?? ''
        const comboKey = element.comboKey ?? ''

        d.wrapper.scannerData(reqId, rank, contractDetails, distance, benchmark, projection, comboKey)
      }
    }

    d.wrapper.scannerDataEnd(reqId)
  })

  // --- IN.FUNDAMENTAL_DATA (51) ---
  decoder.registerProto(IN.FUNDAMENTAL_DATA, (d, buf) => {
    const proto = FundamentalsDataProto.decode(buf)
    d.wrapper.fundamentalData(
      proto.reqId ?? NO_VALID_ID,
      proto.data ?? '',
    )
  })

  // --- IN.NEWS_PROVIDERS (85) ---
  decoder.registerProto(IN.NEWS_PROVIDERS, (d, buf) => {
    const proto = NewsProvidersProto.decode(buf)
    const newsProviders: NewsProvider[] = []
    if (proto.newsProviders) {
      for (const np of proto.newsProviders) {
        const provider = new NewsProvider()
        provider.code = np.providerCode ?? ''
        provider.name = np.providerName ?? ''
        newsProviders.push(provider)
      }
    }
    d.wrapper.newsProviders(newsProviders)
  })

  // --- IN.NEWS_ARTICLE (83) ---
  decoder.registerProto(IN.NEWS_ARTICLE, (d, buf) => {
    const proto = NewsArticleProto.decode(buf)
    d.wrapper.newsArticle(
      proto.reqId ?? NO_VALID_ID,
      proto.articleType ?? 0,
      proto.articleText ?? '',
    )
  })

  // --- IN.TICK_NEWS (84) ---
  decoder.registerProto(IN.TICK_NEWS, (d, buf) => {
    const proto = TickNewsProto.decode(buf)
    d.wrapper.tickNews(
      proto.reqId ?? NO_VALID_ID,
      proto.timestamp ?? 0,
      proto.providerCode ?? '',
      proto.articleId ?? '',
      proto.headline ?? '',
      proto.extraData ?? '',
    )
  })

  // --- IN.HISTORICAL_NEWS (86) ---
  decoder.registerProto(IN.HISTORICAL_NEWS, (d, buf) => {
    const proto = HistoricalNewsProto.decode(buf)
    d.wrapper.historicalNews(
      proto.reqId ?? NO_VALID_ID,
      proto.time ?? '',
      proto.providerCode ?? '',
      proto.articleId ?? '',
      proto.headline ?? '',
    )
  })

  // --- IN.HISTORICAL_NEWS_END (87) ---
  decoder.registerProto(IN.HISTORICAL_NEWS_END, (d, buf) => {
    const proto = HistoricalNewsEndProto.decode(buf)
    d.wrapper.historicalNewsEnd(
      proto.reqId ?? NO_VALID_ID,
      proto.hasMore ?? false,
    )
  })

  // --- IN.SECURITY_DEFINITION_OPTION_PARAMETER (75) ---
  decoder.registerProto(IN.SECURITY_DEFINITION_OPTION_PARAMETER, (d, buf) => {
    const proto = SecDefOptParameterProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    const exchange = proto.exchange ?? ''
    const underlyingConId = proto.underlyingConId ?? 0
    const tradingClass = proto.tradingClass ?? ''
    const multiplier = proto.multiplier ?? ''

    const expirations = new Set<string>()
    if (proto.expirations) {
      for (const exp of proto.expirations) {
        expirations.add(exp)
      }
    }

    const strikes = new Set<number>()
    if (proto.strikes) {
      for (const strike of proto.strikes) {
        strikes.add(strike)
      }
    }

    d.wrapper.securityDefinitionOptionParameter(
      reqId, exchange, underlyingConId, tradingClass, multiplier,
      expirations, strikes,
    )
  })

  // --- IN.SECURITY_DEFINITION_OPTION_PARAMETER_END (76) ---
  decoder.registerProto(IN.SECURITY_DEFINITION_OPTION_PARAMETER_END, (d, buf) => {
    const proto = SecDefOptParameterEndProto.decode(buf)
    d.wrapper.securityDefinitionOptionParameterEnd(proto.reqId ?? NO_VALID_ID)
  })

  // --- IN.SOFT_DOLLAR_TIERS (77) ---
  decoder.registerProto(IN.SOFT_DOLLAR_TIERS, (d, buf) => {
    const proto = SoftDollarTiersProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    const tiers: SoftDollarTier[] = []
    if (proto.softDollarTiers) {
      for (const tierProto of proto.softDollarTiers) {
        tiers.push(decodeSoftDollarTierFromProto(tierProto))
      }
    }
    d.wrapper.softDollarTiers(reqId, tiers)
  })

  // --- IN.FAMILY_CODES (78) ---
  decoder.registerProto(IN.FAMILY_CODES, (d, buf) => {
    const proto = FamilyCodesProto.decode(buf)
    const familyCodes: FamilyCode[] = []
    if (proto.familyCodes) {
      for (const fcProto of proto.familyCodes) {
        familyCodes.push(decodeFamilyCodeFromProto(fcProto))
      }
    }
    d.wrapper.familyCodes(familyCodes)
  })

  // --- IN.SMART_COMPONENTS (82) ---
  decoder.registerProto(IN.SMART_COMPONENTS, (d, buf) => {
    const proto = SmartComponentsProto.decode(buf)
    const reqId = proto.reqId ?? NO_VALID_ID
    const smartComponentsMap: SmartComponent[] = []
    if (proto.smartComponents) {
      for (const scProto of proto.smartComponents) {
        smartComponentsMap.push(decodeSmartComponentFromProto(scProto))
      }
    }
    d.wrapper.smartComponents(reqId, smartComponentsMap)
  })

  // --- IN.MKT_DEPTH_EXCHANGES (80) ---
  decoder.registerProto(IN.MKT_DEPTH_EXCHANGES, (d, buf) => {
    const proto = MarketDepthExchangesProto.decode(buf)
    const depthMktDataDescriptions: DepthMktDataDescription[] = []
    if (proto.depthMarketDataDescriptions) {
      for (const descProto of proto.depthMarketDataDescriptions) {
        depthMktDataDescriptions.push(decodeDepthMktDataDescFromProto(descProto))
      }
    }
    d.wrapper.mktDepthExchanges(depthMktDataDescriptions)
  })

  // --- IN.VERIFY_MESSAGE_API (65) ---
  decoder.registerProto(IN.VERIFY_MESSAGE_API, (d, buf) => {
    const proto = VerifyMessageApiProto.decode(buf)
    d.wrapper.verifyMessageAPI(proto.apiData ?? '')
  })

  // --- IN.VERIFY_COMPLETED (66) ---
  decoder.registerProto(IN.VERIFY_COMPLETED, (d, buf) => {
    const proto = VerifyCompletedProto.decode(buf)
    d.wrapper.verifyCompleted(
      proto.isSuccessful ?? false,
      proto.errorText ?? '',
    )
  })

  // --- IN.DISPLAY_GROUP_LIST (67) ---
  decoder.registerProto(IN.DISPLAY_GROUP_LIST, (d, buf) => {
    const proto = DisplayGroupListProto.decode(buf)
    d.wrapper.displayGroupList(
      proto.reqId ?? NO_VALID_ID,
      proto.groups ?? '',
    )
  })

  // --- IN.DISPLAY_GROUP_UPDATED (68) ---
  decoder.registerProto(IN.DISPLAY_GROUP_UPDATED, (d, buf) => {
    const proto = DisplayGroupUpdatedProto.decode(buf)
    d.wrapper.displayGroupUpdated(
      proto.reqId ?? NO_VALID_ID,
      proto.contractInfo ?? '',
    )
  })

  // --- IN.WSH_META_DATA (104) ---
  decoder.registerProto(IN.WSH_META_DATA, (d, buf) => {
    const proto = WshMetaDataProto.decode(buf)
    d.wrapper.wshMetaData(
      proto.reqId ?? NO_VALID_ID,
      proto.dataJson ?? '',
    )
  })

  // --- IN.WSH_EVENT_DATA (105) ---
  decoder.registerProto(IN.WSH_EVENT_DATA, (d, buf) => {
    const proto = WshEventDataProto.decode(buf)
    d.wrapper.wshEventData(
      proto.reqId ?? NO_VALID_ID,
      proto.dataJson ?? '',
    )
  })

  // --- IN.USER_INFO (107) ---
  decoder.registerProto(IN.USER_INFO, (d, buf) => {
    const proto = UserInfoProto.decode(buf)
    d.wrapper.userInfo(
      proto.reqId ?? NO_VALID_ID,
      proto.whiteBrandingId ?? '',
    )
  })

  // --- IN.REPLACE_FA_END (103) ---
  decoder.registerProto(IN.REPLACE_FA_END, (d, buf) => {
    const proto = ReplaceFAEndProto.decode(buf)
    d.wrapper.replaceFAEnd(
      proto.reqId ?? NO_VALID_ID,
      proto.text ?? '',
    )
  })

  // --- IN.CONFIG_RESPONSE (110) --- proto only
  decoder.registerProto(IN.CONFIG_RESPONSE, (d, buf) => {
    const proto = ConfigResponseProto.decode(buf)
    d.wrapper.configResponseProtoBuf(proto)
  })

  // --- IN.UPDATE_CONFIG_RESPONSE (111) --- proto only
  decoder.registerProto(IN.UPDATE_CONFIG_RESPONSE, (d, buf) => {
    const proto = UpdateConfigResponseProto.decode(buf)
    d.wrapper.updateConfigResponseProtoBuf(proto)
  })
}
