/**
 * Mirrors: ibapi/wrapper.py
 *
 * EWrapper is the callback interface that must be implemented to receive
 * responses from TWS/IBGW.  DefaultEWrapper provides no-op defaults for
 * every method so callers can override only the callbacks they need.
 */

import type { Decimal } from 'decimal.js';

import type {
  Contract,
  ContractDetails,
  ContractDescription,
  DeltaNeutralContract,
} from './contract.js';
import type { Order } from './order.js';
import type { OrderState } from './order-state.js';
import type { Execution } from './execution.js';
import type { CommissionAndFeesReport } from './commission-and-fees-report.js';
import type {
  BarData,
  RealTimeBar,
  HistogramData,
  NewsProvider,
  DepthMktDataDescription,
  SmartComponent,
  FamilyCode,
  PriceIncrement,
  HistoricalTick,
  HistoricalTickBidAsk,
  HistoricalTickLast,
  HistoricalSession,
  WshEventData,
  TickAttrib,
  TickAttribBidAsk,
  TickAttribLast,
} from './common.js';
import type { SoftDollarTier } from './softdollartier.js';
import type { IneligibilityReason } from './ineligibility-reason.js';
import type { TagValue } from './tag-value.js';
import type { ScanData } from './scanner.js';

// ---------------------------------------------------------------------------
// EWrapper interface
// ---------------------------------------------------------------------------

export interface EWrapper {
  // ── Connection & server ──────────────────────────────────────────────

  error(
    reqId: number,
    errorTime: number,
    errorCode: number,
    errorString: string,
    advancedOrderRejectJson?: string,
  ): void;

  winError(text: string, lastError: number): void;

  connectAck(): void;

  connectionClosed(): void;

  // ── Market data ──────────────────────────────────────────────────────

  marketDataType(reqId: number, marketDataType: number): void;

  tickPrice(
    reqId: number,
    tickType: number,
    price: number,
    attrib: TickAttrib,
  ): void;

  tickSize(reqId: number, tickType: number, size: Decimal): void;

  tickSnapshotEnd(reqId: number): void;

  tickGeneric(reqId: number, tickType: number, value: number): void;

  tickString(reqId: number, tickType: number, value: string): void;

  tickEFP(
    reqId: number,
    tickType: number,
    basisPoints: number,
    formattedBasisPoints: string,
    totalDividends: number,
    holdDays: number,
    futureLastTradeDate: string,
    dividendImpact: number,
    dividendsToLastTradeDate: number,
  ): void;

  tickOptionComputation(
    reqId: number,
    tickType: number,
    tickAttrib: number,
    impliedVol: number | null,
    delta: number | null,
    optPrice: number | null,
    pvDividend: number | null,
    gamma: number | null,
    vega: number | null,
    theta: number | null,
    undPrice: number | null,
  ): void;

  tickReqParams(
    tickerId: number,
    minTick: number,
    bboExchange: string,
    snapshotPermissions: number,
  ): void;

  tickNews(
    tickerId: number,
    timeStamp: number,
    providerCode: string,
    articleId: string,
    headline: string,
    extraData: string,
  ): void;

  // ── Orders ───────────────────────────────────────────────────────────

  orderStatus(
    orderId: number,
    status: string,
    filled: Decimal,
    remaining: Decimal,
    avgFillPrice: number,
    permId: number,
    parentId: number,
    lastFillPrice: number,
    clientId: number,
    whyHeld: string,
    mktCapPrice: number,
  ): void;

  openOrder(
    orderId: number,
    contract: Contract,
    order: Order,
    orderState: OrderState,
  ): void;

  openOrderEnd(): void;

  completedOrder(
    contract: Contract,
    order: Order,
    orderState: OrderState,
  ): void;

  completedOrdersEnd(): void;

  orderBound(permId: number, clientId: number, orderId: number): void;

  // ── Account ──────────────────────────────────────────────────────────

  updateAccountValue(
    key: string,
    val: string,
    currency: string,
    accountName: string,
  ): void;

  updatePortfolio(
    contract: Contract,
    position: Decimal,
    marketPrice: string,
    marketValue: string,
    averageCost: string,
    unrealizedPNL: string,
    realizedPNL: string,
    accountName: string,
  ): void;

  updateAccountTime(timeStamp: string): void;

  accountDownloadEnd(accountName: string): void;

  managedAccounts(accountsList: string): void;

  accountSummary(
    reqId: number,
    account: string,
    tag: string,
    value: string,
    currency: string,
  ): void;

  accountSummaryEnd(reqId: number): void;

  accountUpdateMulti(
    reqId: number,
    account: string,
    modelCode: string,
    key: string,
    value: string,
    currency: string,
  ): void;

  accountUpdateMultiEnd(reqId: number): void;

  // ── Positions ────────────────────────────────────────────────────────

  position(
    account: string,
    contract: Contract,
    position: Decimal,
    avgCost: number,
  ): void;

  positionEnd(): void;

  positionMulti(
    reqId: number,
    account: string,
    modelCode: string,
    contract: Contract,
    pos: Decimal,
    avgCost: number,
  ): void;

  positionMultiEnd(reqId: number): void;

  // ── Contract details ─────────────────────────────────────────────────

  nextValidId(orderId: number): void;

  contractDetails(reqId: number, contractDetails: ContractDetails): void;

  bondContractDetails(reqId: number, contractDetails: ContractDetails): void;

  contractDetailsEnd(reqId: number): void;

  // ── Executions ───────────────────────────────────────────────────────

  execDetails(reqId: number, contract: Contract, execution: Execution): void;

  execDetailsEnd(reqId: number): void;

  commissionAndFeesReport(
    commissionAndFeesReport: CommissionAndFeesReport,
  ): void;

  // ── Market depth ─────────────────────────────────────────────────────

  updateMktDepth(
    reqId: number,
    position: number,
    operation: number,
    side: number,
    price: number,
    size: Decimal,
  ): void;

  updateMktDepthL2(
    reqId: number,
    position: number,
    marketMaker: string,
    operation: number,
    side: number,
    price: number,
    size: Decimal,
    isSmartDepth: boolean,
  ): void;

  mktDepthExchanges(
    depthMktDataDescriptions: DepthMktDataDescription[],
  ): void;

  // ── News ─────────────────────────────────────────────────────────────

  updateNewsBulletin(
    msgId: number,
    msgType: number,
    newsMessage: string,
    originExch: string,
  ): void;

  newsProviders(newsProviders: NewsProvider[]): void;

  newsArticle(
    requestId: number,
    articleType: number,
    articleText: string,
  ): void;

  historicalNews(
    requestId: number,
    time: string,
    providerCode: string,
    articleId: string,
    headline: string,
  ): void;

  historicalNewsEnd(requestId: number, hasMore: boolean): void;

  // ── Financial Advisor ────────────────────────────────────────────────

  receiveFA(faData: number, cxml: string): void;

  replaceFAEnd(reqId: number, text: string): void;

  // ── Historical data ──────────────────────────────────────────────────

  historicalData(reqId: number, bar: BarData): void;

  historicalDataEnd(reqId: number, start: string, end: string): void;

  historicalDataUpdate(reqId: number, bar: BarData): void;

  historicalSchedule(
    reqId: number,
    startDateTime: string,
    endDateTime: string,
    timeZone: string,
    sessions: HistoricalSession[],
  ): void;

  headTimestamp(reqId: number, headTimestamp: string): void;

  histogramData(reqId: number, items: HistogramData[]): void;

  historicalTicks(
    reqId: number,
    ticks: HistoricalTick[],
    done: boolean,
  ): void;

  historicalTicksBidAsk(
    reqId: number,
    ticks: HistoricalTickBidAsk[],
    done: boolean,
  ): void;

  historicalTicksLast(
    reqId: number,
    ticks: HistoricalTickLast[],
    done: boolean,
  ): void;

  // ── Scanner ──────────────────────────────────────────────────────────

  scannerParameters(xml: string): void;

  scannerData(
    reqId: number,
    rank: number,
    contractDetails: ContractDetails,
    distance: string,
    benchmark: string,
    projection: string,
    legsStr: string,
  ): void;

  scannerDataEnd(reqId: number): void;

  // ── Real-time bars ───────────────────────────────────────────────────

  realtimeBar(
    reqId: number,
    time: number,
    open_: number,
    high: number,
    low: number,
    close: number,
    volume: Decimal,
    wap: Decimal,
    count: number,
  ): void;

  // ── Tick-by-tick ─────────────────────────────────────────────────────

  tickByTickAllLast(
    reqId: number,
    tickType: number,
    time: number,
    price: number,
    size: Decimal,
    tickAttribLast: TickAttribLast,
    exchange: string,
    specialConditions: string,
  ): void;

  tickByTickBidAsk(
    reqId: number,
    time: number,
    bidPrice: number,
    askPrice: number,
    bidSize: Decimal,
    askSize: Decimal,
    tickAttribBidAsk: TickAttribBidAsk,
  ): void;

  tickByTickMidPoint(reqId: number, time: number, midPoint: number): void;

  // ── Fundamentals & misc ──────────────────────────────────────────────

  currentTime(time: number): void;

  currentTimeInMillis(timeInMillis: number): void;

  fundamentalData(reqId: number, data: string): void;

  deltaNeutralValidation(
    reqId: number,
    deltaNeutralContract: DeltaNeutralContract,
  ): void;

  // ── Option chains ────────────────────────────────────────────────────

  securityDefinitionOptionParameter(
    reqId: number,
    exchange: string,
    underlyingConId: number,
    tradingClass: string,
    multiplier: string,
    expirations: Set<string>,
    strikes: Set<number>,
  ): void;

  securityDefinitionOptionParameterEnd(reqId: number): void;

  // ── Soft dollar tiers ────────────────────────────────────────────────

  softDollarTiers(reqId: number, tiers: SoftDollarTier[]): void;

  // ── Symbol / family / smart / market rules ───────────────────────────

  familyCodes(familyCodes: FamilyCode[]): void;

  symbolSamples(
    reqId: number,
    contractDescriptions: ContractDescription[],
  ): void;

  smartComponents(
    reqId: number,
    smartComponentMap: SmartComponent[],
  ): void;

  marketRule(marketRuleId: number, priceIncrements: PriceIncrement[]): void;

  // ── PnL ──────────────────────────────────────────────────────────────

  pnl(
    reqId: number,
    dailyPnL: number,
    unrealizedPnL: number | null,
    realizedPnL: number | null,
  ): void;

  pnlSingle(
    reqId: number,
    pos: Decimal,
    dailyPnL: number,
    unrealizedPnL: number | null,
    realizedPnL: number | null,
    value: number,
  ): void;

  // ── Reroute ──────────────────────────────────────────────────────────

  rerouteMktDataReq(reqId: number, conId: number, exchange: string): void;

  rerouteMktDepthReq(reqId: number, conId: number, exchange: string): void;

  // ── Display groups ───────────────────────────────────────────────────

  displayGroupList(reqId: number, groups: string): void;

  displayGroupUpdated(reqId: number, contractInfo: string): void;

  // ── Verify (deprecated) ──────────────────────────────────────────────

  verifyMessageAPI(apiData: string): void;

  verifyCompleted(isSuccessful: boolean, errorText: string): void;

  verifyAndAuthMessageAPI(apiData: string, xyzChallange: string): void;

  verifyAndAuthCompleted(isSuccessful: boolean, errorText: string): void;

  // ── WSH ──────────────────────────────────────────────────────────────

  wshMetaData(reqId: number, dataJson: string): void;

  wshEventData(reqId: number, dataJson: string): void;

  // ── User info ────────────────────────────────────────────────────────

  userInfo(reqId: number, whiteBrandingId: string): void;

  // ── Protobuf callbacks ───────────────────────────────────────────────

  orderStatusProtoBuf(orderStatusProto: unknown): void;
  openOrderProtoBuf(openOrderProto: unknown): void;
  openOrdersEndProtoBuf(openOrdersEndProto: unknown): void;
  errorProtoBuf(errorMessageProto: unknown): void;
  executionDetailsProtoBuf(executionDetailsProto: unknown): void;
  executionDetailsEndProtoBuf(executionDetailsProto: unknown): void;
  completedOrderProtoBuf(completedOrderProto: unknown): void;
  completedOrdersEndProtoBuf(completedOrdersEndProto: unknown): void;
  orderBoundProtoBuf(orderBoundProto: unknown): void;
  contractDataProtoBuf(contractDataProto: unknown): void;
  bondContractDataProtoBuf(contractDataProto: unknown): void;
  contractDataEndProtoBuf(contractDataEndProto: unknown): void;
  tickPriceProtoBuf(tickPriceProto: unknown): void;
  tickSizeProtoBuf(tickSizeProto: unknown): void;
  tickOptionComputationProtoBuf(tickOptionComputationProto: unknown): void;
  tickGenericProtoBuf(tickGenericProto: unknown): void;
  tickStringProtoBuf(tickStringProto: unknown): void;
  tickSnapshotEndProtoBuf(tickSnapshotEndProto: unknown): void;
  updateMarketDepthProtoBuf(marketDepthProto: unknown): void;
  updateMarketDepthL2ProtoBuf(marketDepthL2Proto: unknown): void;
  updateMarketDataTypeProtoBuf(marketDataTypeProto: unknown): void;
  tickReqParamsProtoBuf(tickReqParamsProto: unknown): void;
  updateAccountValueProtoBuf(accountValueProto: unknown): void;
  updatePortfolioProtoBuf(portfolioValueProto: unknown): void;
  updateAccountTimeProtoBuf(accountUpdateTimeProto: unknown): void;
  accountDataEndProtoBuf(accountDataEndProto: unknown): void;
  managedAccountsProtoBuf(managedAccountsProto: unknown): void;
  positionProtoBuf(positionProto: unknown): void;
  positionEndProtoBuf(positionEndProto: unknown): void;
  accountSummaryProtoBuf(accountSummaryProto: unknown): void;
  accountSummaryEndProtoBuf(accountSummaryEndProto: unknown): void;
  positionMultiProtoBuf(positionMultiProto: unknown): void;
  positionMultiEndProtoBuf(positionMultiEndProto: unknown): void;
  accountUpdateMultiProtoBuf(accountUpdateMultiProto: unknown): void;
  accountUpdateMultiEndProtoBuf(accountUpdateMultiEndProto: unknown): void;
  historicalDataProtoBuf(historicalDataProto: unknown): void;
  historicalDataUpdateProtoBuf(historicalDataUpdateProto: unknown): void;
  historicalDataEndProtoBuf(historicalDataEndProto: unknown): void;
  realTimeBarTickProtoBuf(realTimeBarTickProto: unknown): void;
  headTimestampProtoBuf(headTimestampProto: unknown): void;
  histogramDataProtoBuf(histogramDataProto: unknown): void;
  historicalTicksProtoBuf(historicalTicksProto: unknown): void;
  historicalTicksBidAskProtoBuf(historicalTicksBidAskProto: unknown): void;
  historicalTicksLastProtoBuf(historicalTicksLastProto: unknown): void;
  tickByTickDataProtoBuf(tickByTickDataProto: unknown): void;
  updateNewsBulletinProtoBuf(newsBulletinProto: unknown): void;
  newsArticleProtoBuf(newsArticleProto: unknown): void;
  newsProvidersProtoBuf(newsProvidersProto: unknown): void;
  historicalNewsProtoBuf(historicalNewsProto: unknown): void;
  historicalNewsEndProtoBuf(historicalNewsEndProto: unknown): void;
  wshMetaDataProtoBuf(wshMetaDataProto: unknown): void;
  wshEventDataProtoBuf(wshEventDataProto: unknown): void;
  tickNewsProtoBuf(tickNewsProto: unknown): void;
  scannerParametersProtoBuf(scannerParametersProto: unknown): void;
  scannerDataProtoBuf(scannerDataProto: unknown): void;
  fundamentalsDataProtoBuf(fundamentalsDataProto: unknown): void;
  pnlProtoBuf(pnlProto: unknown): void;
  pnlSingleProtoBuf(pnlSingleProto: unknown): void;
  receiveFAProtoBuf(receiveFAProto: unknown): void;
  replaceFAEndProtoBuf(replaceFAEndProto: unknown): void;
  commissionAndFeesReportProtoBuf(commissionAndFeesReportProto: unknown): void;
  historicalScheduleProtoBuf(historicalScheduleProto: unknown): void;
  rerouteMarketDataRequestProtoBuf(rerouteMarketDataRequestProto: unknown): void;
  rerouteMarketDepthRequestProtoBuf(rerouteMarketDepthRequestProto: unknown): void;
  secDefOptParameterProtoBuf(secDefOptParameterProto: unknown): void;
  secDefOptParameterEndProtoBuf(secDefOptParameterEndProto: unknown): void;
  softDollarTiersProtoBuf(softDollarTiersProto: unknown): void;
  familyCodesProtoBuf(familyCodesProto: unknown): void;
  symbolSamplesProtoBuf(symbolSamplesProto: unknown): void;
  smartComponentsProtoBuf(smartComponentsProto: unknown): void;
  marketRuleProtoBuf(marketRuleProto: unknown): void;
  userInfoProtoBuf(userInfoProto: unknown): void;
  nextValidIdProtoBuf(nextValidIdProto: unknown): void;
  currentTimeProtoBuf(currentTimeProto: unknown): void;
  currentTimeInMillisProtoBuf(currentTimeInMillisProto: unknown): void;
  verifyMessageApiProtoBuf(verifyMessageApiProto: unknown): void;
  verifyCompletedProtoBuf(verifyCompletedProto: unknown): void;
  displayGroupListProtoBuf(displayGroupListProto: unknown): void;
  displayGroupUpdatedProtoBuf(displayGroupUpdatedProto: unknown): void;
  marketDepthExchangesProtoBuf(marketDepthExchangesProto: unknown): void;
  configResponseProtoBuf(configResponseProto: unknown): void;
  updateConfigResponseProtoBuf(updateConfigResponseProto: unknown): void;
}

// ---------------------------------------------------------------------------
// DefaultEWrapper — no-op implementation
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-unused-vars */

export class DefaultEWrapper implements EWrapper {
  // ── Connection & server ──────────────────────────────────────────────

  error(
    _reqId: number,
    _errorTime: number,
    _errorCode: number,
    _errorString: string,
    _advancedOrderRejectJson?: string,
  ): void {}

  winError(_text: string, _lastError: number): void {}

  connectAck(): void {}

  connectionClosed(): void {}

  // ── Market data ──────────────────────────────────────────────────────

  marketDataType(_reqId: number, _marketDataType: number): void {}

  tickPrice(
    _reqId: number,
    _tickType: number,
    _price: number,
    _attrib: TickAttrib,
  ): void {}

  tickSize(_reqId: number, _tickType: number, _size: Decimal): void {}

  tickSnapshotEnd(_reqId: number): void {}

  tickGeneric(_reqId: number, _tickType: number, _value: number): void {}

  tickString(_reqId: number, _tickType: number, _value: string): void {}

  tickEFP(
    _reqId: number,
    _tickType: number,
    _basisPoints: number,
    _formattedBasisPoints: string,
    _totalDividends: number,
    _holdDays: number,
    _futureLastTradeDate: string,
    _dividendImpact: number,
    _dividendsToLastTradeDate: number,
  ): void {}

  tickOptionComputation(
    _reqId: number,
    _tickType: number,
    _tickAttrib: number,
    _impliedVol: number | null,
    _delta: number | null,
    _optPrice: number | null,
    _pvDividend: number | null,
    _gamma: number | null,
    _vega: number | null,
    _theta: number | null,
    _undPrice: number | null,
  ): void {}

  tickReqParams(
    _tickerId: number,
    _minTick: number,
    _bboExchange: string,
    _snapshotPermissions: number,
  ): void {}

  tickNews(
    _tickerId: number,
    _timeStamp: number,
    _providerCode: string,
    _articleId: string,
    _headline: string,
    _extraData: string,
  ): void {}

  // ── Orders ───────────────────────────────────────────────────────────

  orderStatus(
    _orderId: number,
    _status: string,
    _filled: Decimal,
    _remaining: Decimal,
    _avgFillPrice: number,
    _permId: number,
    _parentId: number,
    _lastFillPrice: number,
    _clientId: number,
    _whyHeld: string,
    _mktCapPrice: number,
  ): void {}

  openOrder(
    _orderId: number,
    _contract: Contract,
    _order: Order,
    _orderState: OrderState,
  ): void {}

  openOrderEnd(): void {}

  completedOrder(
    _contract: Contract,
    _order: Order,
    _orderState: OrderState,
  ): void {}

  completedOrdersEnd(): void {}

  orderBound(_permId: number, _clientId: number, _orderId: number): void {}

  // ── Account ──────────────────────────────────────────────────────────

  updateAccountValue(
    _key: string,
    _val: string,
    _currency: string,
    _accountName: string,
  ): void {}

  updatePortfolio(
    _contract: Contract,
    _position: Decimal,
    _marketPrice: string,
    _marketValue: string,
    _averageCost: string,
    _unrealizedPNL: string,
    _realizedPNL: string,
    _accountName: string,
  ): void {}

  updateAccountTime(_timeStamp: string): void {}

  accountDownloadEnd(_accountName: string): void {}

  managedAccounts(_accountsList: string): void {}

  accountSummary(
    _reqId: number,
    _account: string,
    _tag: string,
    _value: string,
    _currency: string,
  ): void {}

  accountSummaryEnd(_reqId: number): void {}

  accountUpdateMulti(
    _reqId: number,
    _account: string,
    _modelCode: string,
    _key: string,
    _value: string,
    _currency: string,
  ): void {}

  accountUpdateMultiEnd(_reqId: number): void {}

  // ── Positions ────────────────────────────────────────────────────────

  position(
    _account: string,
    _contract: Contract,
    _position: Decimal,
    _avgCost: number,
  ): void {}

  positionEnd(): void {}

  positionMulti(
    _reqId: number,
    _account: string,
    _modelCode: string,
    _contract: Contract,
    _pos: Decimal,
    _avgCost: number,
  ): void {}

  positionMultiEnd(_reqId: number): void {}

  // ── Contract details ─────────────────────────────────────────────────

  nextValidId(_orderId: number): void {}

  contractDetails(_reqId: number, _contractDetails: ContractDetails): void {}

  bondContractDetails(
    _reqId: number,
    _contractDetails: ContractDetails,
  ): void {}

  contractDetailsEnd(_reqId: number): void {}

  // ── Executions ───────────────────────────────────────────────────────

  execDetails(
    _reqId: number,
    _contract: Contract,
    _execution: Execution,
  ): void {}

  execDetailsEnd(_reqId: number): void {}

  commissionAndFeesReport(
    _commissionAndFeesReport: CommissionAndFeesReport,
  ): void {}

  // ── Market depth ─────────────────────────────────────────────────────

  updateMktDepth(
    _reqId: number,
    _position: number,
    _operation: number,
    _side: number,
    _price: number,
    _size: Decimal,
  ): void {}

  updateMktDepthL2(
    _reqId: number,
    _position: number,
    _marketMaker: string,
    _operation: number,
    _side: number,
    _price: number,
    _size: Decimal,
    _isSmartDepth: boolean,
  ): void {}

  mktDepthExchanges(
    _depthMktDataDescriptions: DepthMktDataDescription[],
  ): void {}

  // ── News ─────────────────────────────────────────────────────────────

  updateNewsBulletin(
    _msgId: number,
    _msgType: number,
    _newsMessage: string,
    _originExch: string,
  ): void {}

  newsProviders(_newsProviders: NewsProvider[]): void {}

  newsArticle(
    _requestId: number,
    _articleType: number,
    _articleText: string,
  ): void {}

  historicalNews(
    _requestId: number,
    _time: string,
    _providerCode: string,
    _articleId: string,
    _headline: string,
  ): void {}

  historicalNewsEnd(_requestId: number, _hasMore: boolean): void {}

  // ── Financial Advisor ────────────────────────────────────────────────

  receiveFA(_faData: number, _cxml: string): void {}

  replaceFAEnd(_reqId: number, _text: string): void {}

  // ── Historical data ──────────────────────────────────────────────────

  historicalData(_reqId: number, _bar: BarData): void {}

  historicalDataEnd(_reqId: number, _start: string, _end: string): void {}

  historicalDataUpdate(_reqId: number, _bar: BarData): void {}

  historicalSchedule(
    _reqId: number,
    _startDateTime: string,
    _endDateTime: string,
    _timeZone: string,
    _sessions: HistoricalSession[],
  ): void {}

  headTimestamp(_reqId: number, _headTimestamp: string): void {}

  histogramData(_reqId: number, _items: HistogramData[]): void {}

  historicalTicks(
    _reqId: number,
    _ticks: HistoricalTick[],
    _done: boolean,
  ): void {}

  historicalTicksBidAsk(
    _reqId: number,
    _ticks: HistoricalTickBidAsk[],
    _done: boolean,
  ): void {}

  historicalTicksLast(
    _reqId: number,
    _ticks: HistoricalTickLast[],
    _done: boolean,
  ): void {}

  // ── Scanner ──────────────────────────────────────────────────────────

  scannerParameters(_xml: string): void {}

  scannerData(
    _reqId: number,
    _rank: number,
    _contractDetails: ContractDetails,
    _distance: string,
    _benchmark: string,
    _projection: string,
    _legsStr: string,
  ): void {}

  scannerDataEnd(_reqId: number): void {}

  // ── Real-time bars ───────────────────────────────────────────────────

  realtimeBar(
    _reqId: number,
    _time: number,
    _open_: number,
    _high: number,
    _low: number,
    _close: number,
    _volume: Decimal,
    _wap: Decimal,
    _count: number,
  ): void {}

  // ── Tick-by-tick ─────────────────────────────────────────────────────

  tickByTickAllLast(
    _reqId: number,
    _tickType: number,
    _time: number,
    _price: number,
    _size: Decimal,
    _tickAttribLast: TickAttribLast,
    _exchange: string,
    _specialConditions: string,
  ): void {}

  tickByTickBidAsk(
    _reqId: number,
    _time: number,
    _bidPrice: number,
    _askPrice: number,
    _bidSize: Decimal,
    _askSize: Decimal,
    _tickAttribBidAsk: TickAttribBidAsk,
  ): void {}

  tickByTickMidPoint(
    _reqId: number,
    _time: number,
    _midPoint: number,
  ): void {}

  // ── Fundamentals & misc ──────────────────────────────────────────────

  currentTime(_time: number): void {}

  currentTimeInMillis(_timeInMillis: number): void {}

  fundamentalData(_reqId: number, _data: string): void {}

  deltaNeutralValidation(
    _reqId: number,
    _deltaNeutralContract: DeltaNeutralContract,
  ): void {}

  // ── Option chains ────────────────────────────────────────────────────

  securityDefinitionOptionParameter(
    _reqId: number,
    _exchange: string,
    _underlyingConId: number,
    _tradingClass: string,
    _multiplier: string,
    _expirations: Set<string>,
    _strikes: Set<number>,
  ): void {}

  securityDefinitionOptionParameterEnd(_reqId: number): void {}

  // ── Soft dollar tiers ────────────────────────────────────────────────

  softDollarTiers(_reqId: number, _tiers: SoftDollarTier[]): void {}

  // ── Symbol / family / smart / market rules ───────────────────────────

  familyCodes(_familyCodes: FamilyCode[]): void {}

  symbolSamples(
    _reqId: number,
    _contractDescriptions: ContractDescription[],
  ): void {}

  smartComponents(
    _reqId: number,
    _smartComponentMap: SmartComponent[],
  ): void {}

  marketRule(
    _marketRuleId: number,
    _priceIncrements: PriceIncrement[],
  ): void {}

  // ── PnL ──────────────────────────────────────────────────────────────

  pnl(
    _reqId: number,
    _dailyPnL: number,
    _unrealizedPnL: number | null,
    _realizedPnL: number | null,
  ): void {}

  pnlSingle(
    _reqId: number,
    _pos: Decimal,
    _dailyPnL: number,
    _unrealizedPnL: number | null,
    _realizedPnL: number | null,
    _value: number,
  ): void {}

  // ── Reroute ──────────────────────────────────────────────────────────

  rerouteMktDataReq(
    _reqId: number,
    _conId: number,
    _exchange: string,
  ): void {}

  rerouteMktDepthReq(
    _reqId: number,
    _conId: number,
    _exchange: string,
  ): void {}

  // ── Display groups ───────────────────────────────────────────────────

  displayGroupList(_reqId: number, _groups: string): void {}

  displayGroupUpdated(_reqId: number, _contractInfo: string): void {}

  // ── Verify (deprecated) ──────────────────────────────────────────────

  verifyMessageAPI(_apiData: string): void {}

  verifyCompleted(_isSuccessful: boolean, _errorText: string): void {}

  verifyAndAuthMessageAPI(_apiData: string, _xyzChallange: string): void {}

  verifyAndAuthCompleted(_isSuccessful: boolean, _errorText: string): void {}

  // ── WSH ──────────────────────────────────────────────────────────────

  wshMetaData(_reqId: number, _dataJson: string): void {}

  wshEventData(_reqId: number, _dataJson: string): void {}

  // ── User info ────────────────────────────────────────────────────────

  userInfo(_reqId: number, _whiteBrandingId: string): void {}

  // ── Protobuf callbacks ───────────────────────────────────────────────

  orderStatusProtoBuf(_orderStatusProto: unknown): void {}
  openOrderProtoBuf(_openOrderProto: unknown): void {}
  openOrdersEndProtoBuf(_openOrdersEndProto: unknown): void {}
  errorProtoBuf(_errorMessageProto: unknown): void {}
  executionDetailsProtoBuf(_executionDetailsProto: unknown): void {}
  executionDetailsEndProtoBuf(_executionDetailsProto: unknown): void {}
  completedOrderProtoBuf(_completedOrderProto: unknown): void {}
  completedOrdersEndProtoBuf(_completedOrdersEndProto: unknown): void {}
  orderBoundProtoBuf(_orderBoundProto: unknown): void {}
  contractDataProtoBuf(_contractDataProto: unknown): void {}
  bondContractDataProtoBuf(_contractDataProto: unknown): void {}
  contractDataEndProtoBuf(_contractDataEndProto: unknown): void {}
  tickPriceProtoBuf(_tickPriceProto: unknown): void {}
  tickSizeProtoBuf(_tickSizeProto: unknown): void {}
  tickOptionComputationProtoBuf(_tickOptionComputationProto: unknown): void {}
  tickGenericProtoBuf(_tickGenericProto: unknown): void {}
  tickStringProtoBuf(_tickStringProto: unknown): void {}
  tickSnapshotEndProtoBuf(_tickSnapshotEndProto: unknown): void {}
  updateMarketDepthProtoBuf(_marketDepthProto: unknown): void {}
  updateMarketDepthL2ProtoBuf(_marketDepthL2Proto: unknown): void {}
  updateMarketDataTypeProtoBuf(_marketDataTypeProto: unknown): void {}
  tickReqParamsProtoBuf(_tickReqParamsProto: unknown): void {}
  updateAccountValueProtoBuf(_accountValueProto: unknown): void {}
  updatePortfolioProtoBuf(_portfolioValueProto: unknown): void {}
  updateAccountTimeProtoBuf(_accountUpdateTimeProto: unknown): void {}
  accountDataEndProtoBuf(_accountDataEndProto: unknown): void {}
  managedAccountsProtoBuf(_managedAccountsProto: unknown): void {}
  positionProtoBuf(_positionProto: unknown): void {}
  positionEndProtoBuf(_positionEndProto: unknown): void {}
  accountSummaryProtoBuf(_accountSummaryProto: unknown): void {}
  accountSummaryEndProtoBuf(_accountSummaryEndProto: unknown): void {}
  positionMultiProtoBuf(_positionMultiProto: unknown): void {}
  positionMultiEndProtoBuf(_positionMultiEndProto: unknown): void {}
  accountUpdateMultiProtoBuf(_accountUpdateMultiProto: unknown): void {}
  accountUpdateMultiEndProtoBuf(_accountUpdateMultiEndProto: unknown): void {}
  historicalDataProtoBuf(_historicalDataProto: unknown): void {}
  historicalDataUpdateProtoBuf(_historicalDataUpdateProto: unknown): void {}
  historicalDataEndProtoBuf(_historicalDataEndProto: unknown): void {}
  realTimeBarTickProtoBuf(_realTimeBarTickProto: unknown): void {}
  headTimestampProtoBuf(_headTimestampProto: unknown): void {}
  histogramDataProtoBuf(_histogramDataProto: unknown): void {}
  historicalTicksProtoBuf(_historicalTicksProto: unknown): void {}
  historicalTicksBidAskProtoBuf(_historicalTicksBidAskProto: unknown): void {}
  historicalTicksLastProtoBuf(_historicalTicksLastProto: unknown): void {}
  tickByTickDataProtoBuf(_tickByTickDataProto: unknown): void {}
  updateNewsBulletinProtoBuf(_newsBulletinProto: unknown): void {}
  newsArticleProtoBuf(_newsArticleProto: unknown): void {}
  newsProvidersProtoBuf(_newsProvidersProto: unknown): void {}
  historicalNewsProtoBuf(_historicalNewsProto: unknown): void {}
  historicalNewsEndProtoBuf(_historicalNewsEndProto: unknown): void {}
  wshMetaDataProtoBuf(_wshMetaDataProto: unknown): void {}
  wshEventDataProtoBuf(_wshEventDataProto: unknown): void {}
  tickNewsProtoBuf(_tickNewsProto: unknown): void {}
  scannerParametersProtoBuf(_scannerParametersProto: unknown): void {}
  scannerDataProtoBuf(_scannerDataProto: unknown): void {}
  fundamentalsDataProtoBuf(_fundamentalsDataProto: unknown): void {}
  pnlProtoBuf(_pnlProto: unknown): void {}
  pnlSingleProtoBuf(_pnlSingleProto: unknown): void {}
  receiveFAProtoBuf(_receiveFAProto: unknown): void {}
  replaceFAEndProtoBuf(_replaceFAEndProto: unknown): void {}
  commissionAndFeesReportProtoBuf(_commissionAndFeesReportProto: unknown): void {}
  historicalScheduleProtoBuf(_historicalScheduleProto: unknown): void {}
  rerouteMarketDataRequestProtoBuf(_rerouteMarketDataRequestProto: unknown): void {}
  rerouteMarketDepthRequestProtoBuf(_rerouteMarketDepthRequestProto: unknown): void {}
  secDefOptParameterProtoBuf(_secDefOptParameterProto: unknown): void {}
  secDefOptParameterEndProtoBuf(_secDefOptParameterEndProto: unknown): void {}
  softDollarTiersProtoBuf(_softDollarTiersProto: unknown): void {}
  familyCodesProtoBuf(_familyCodesProto: unknown): void {}
  symbolSamplesProtoBuf(_symbolSamplesProto: unknown): void {}
  smartComponentsProtoBuf(_smartComponentsProto: unknown): void {}
  marketRuleProtoBuf(_marketRuleProto: unknown): void {}
  userInfoProtoBuf(_userInfoProto: unknown): void {}
  nextValidIdProtoBuf(_nextValidIdProto: unknown): void {}
  currentTimeProtoBuf(_currentTimeProto: unknown): void {}
  currentTimeInMillisProtoBuf(_currentTimeInMillisProto: unknown): void {}
  verifyMessageApiProtoBuf(_verifyMessageApiProto: unknown): void {}
  verifyCompletedProtoBuf(_verifyCompletedProto: unknown): void {}
  displayGroupListProtoBuf(_displayGroupListProto: unknown): void {}
  displayGroupUpdatedProtoBuf(_displayGroupUpdatedProto: unknown): void {}
  marketDepthExchangesProtoBuf(_marketDepthExchangesProto: unknown): void {}
  configResponseProtoBuf(_configResponseProto: unknown): void {}
  updateConfigResponseProtoBuf(_updateConfigResponseProto: unknown): void {}
}
