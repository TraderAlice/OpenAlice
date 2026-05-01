"""
Copyright (C) 2025 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""
from ibapi.const import NO_VALID_ID
from ibapi.utils import getEnumTypeFromString
from ibapi.common import PROTOBUF_MSG_ID

"""
The Decoder knows how to transform a message's payload into higher level
IB message (eg: order info, mkt data, etc).
It will call the corresponding method from the EWrapper so that customer's code
(eg: class derived from EWrapper) can make further use of the data.
"""

from ibapi.message import IN
from ibapi.wrapper import *  # @UnusedWildImport
from ibapi.contract import ContractDescription
from ibapi.server_versions import *  # @UnusedWildImport
from ibapi.utils import *  # @UnusedWildImport
from ibapi.softdollartier import SoftDollarTier
from ibapi.ticktype import *  # @UnusedWildImport
from ibapi.tag_value import TagValue
from ibapi.scanner import ScanData
from ibapi.errors import BAD_MESSAGE, UNKNOWN_ID
from ibapi.common import *  # @UnusedWildImport
from ibapi.orderdecoder import OrderDecoder
from ibapi.contract import FundDistributionPolicyIndicator
from ibapi.contract import FundAssetType
from ibapi.ineligibility_reason import IneligibilityReason
from ibapi.decoder_utils import decodeContract, decodeOrder, decodeExecution, decodeOrderState, decodeContractDetails, setLastTradeDate
from ibapi.decoder_utils import decodeHistoricalDataBar, decodeHistogramDataEntry, decodeHistoricalTickLast, decodeHistoricalTickBidAsk, decodeHistoricalTick
from ibapi.decoder_utils import decodeSoftDollarTier, decodeFamilyCode, decodeSmartComponents, decodePriceIncrement, decodeDepthMarketDataDescription

from ibapi.protobuf.OrderStatus_pb2 import OrderStatus as OrderStatusProto
from ibapi.protobuf.OpenOrder_pb2 import OpenOrder as OpenOrderProto
from ibapi.protobuf.OpenOrdersEnd_pb2 import OpenOrdersEnd as OpenOrdersEndProto
from ibapi.protobuf.ErrorMessage_pb2 import ErrorMessage as ErrorMessageProto
from ibapi.protobuf.ExecutionDetails_pb2 import ExecutionDetails as ExecutionDetailsProto
from ibapi.protobuf.ExecutionDetailsEnd_pb2 import ExecutionDetailsEnd as ExecutionDetailsEndProto
from ibapi.protobuf.CompletedOrder_pb2 import CompletedOrder as CompletedOrderProto
from ibapi.protobuf.CompletedOrdersEnd_pb2 import CompletedOrdersEnd as CompletedOrdersEndProto
from ibapi.protobuf.OrderBound_pb2 import OrderBound as OrderBoundProto
from ibapi.protobuf.ContractData_pb2 import ContractData as ContractDataProto
from ibapi.protobuf.ContractDataEnd_pb2 import ContractDataEnd as ContractDataEndProto
from ibapi.protobuf.CompletedOrder_pb2 import CompletedOrder as CompletedOrderProto
from ibapi.protobuf.CompletedOrdersEnd_pb2 import CompletedOrdersEnd as CompletedOrdersEndProto
from ibapi.protobuf.OrderBound_pb2 import OrderBound as OrderBoundProto
from ibapi.protobuf.ContractData_pb2 import ContractData as ContractDataProto
from ibapi.protobuf.ContractDataEnd_pb2 import ContractDataEnd as ContractDataEndProto
from ibapi.protobuf.TickPrice_pb2 import TickPrice as TickPriceProto
from ibapi.protobuf.TickSize_pb2 import TickSize as TickSizeProto
from ibapi.protobuf.TickOptionComputation_pb2 import TickOptionComputation as TickOptionComputationProto
from ibapi.protobuf.TickGeneric_pb2 import TickGeneric as TickGenericProto
from ibapi.protobuf.TickString_pb2 import TickString as TickStringProto
from ibapi.protobuf.TickSnapshotEnd_pb2 import TickSnapshotEnd as TickSnapshotEndProto
from ibapi.protobuf.MarketDepth_pb2 import MarketDepth as MarketDepthProto
from ibapi.protobuf.MarketDepthL2_pb2 import MarketDepthL2 as MarketDepthL2Proto
from ibapi.protobuf.MarketDataType_pb2 import MarketDataType as MarketDataTypeProto
from ibapi.protobuf.TickReqParams_pb2 import TickReqParams as TickReqParamsProto
from ibapi.protobuf.AccountValue_pb2 import AccountValue as AccountValueProto
from ibapi.protobuf.PortfolioValue_pb2 import PortfolioValue as PortfolioValueProto
from ibapi.protobuf.AccountUpdateTime_pb2 import AccountUpdateTime as AccountUpdateTimeProto
from ibapi.protobuf.AccountDataEnd_pb2 import AccountDataEnd as AccountDataEndProto
from ibapi.protobuf.ManagedAccounts_pb2 import ManagedAccounts as ManagedAccountsProto
from ibapi.protobuf.Position_pb2 import Position as PositionProto
from ibapi.protobuf.PositionEnd_pb2 import PositionEnd as PositionEndProto
from ibapi.protobuf.AccountSummary_pb2 import AccountSummary as AccountSummaryProto
from ibapi.protobuf.AccountSummaryEnd_pb2 import AccountSummaryEnd as AccountSummaryEndProto
from ibapi.protobuf.PositionMulti_pb2 import PositionMulti as PositionMultiProto
from ibapi.protobuf.PositionMultiEnd_pb2 import PositionMultiEnd as PositionMultiEndProto
from ibapi.protobuf.AccountUpdateMulti_pb2 import AccountUpdateMulti as AccountUpdateMultiProto
from ibapi.protobuf.AccountUpdateMultiEnd_pb2 import AccountUpdateMultiEnd as AccountUpdateMultiEndProto
from ibapi.protobuf.HistoricalData_pb2 import HistoricalData as HistoricalDataProto
from ibapi.protobuf.HistoricalDataUpdate_pb2 import HistoricalDataUpdate as HistoricalDataUpdateProto
from ibapi.protobuf.HistoricalDataEnd_pb2 import HistoricalDataEnd as HistoricalDataEndProto
from ibapi.protobuf.RealTimeBarTick_pb2 import RealTimeBarTick as RealTimeBarTickProto
from ibapi.protobuf.HeadTimestamp_pb2 import HeadTimestamp as HeadTimestampProto
from ibapi.protobuf.HistogramData_pb2 import HistogramData as HistogramDataProto
from ibapi.protobuf.HistoricalTicks_pb2 import HistoricalTicks as HistoricalTicksProto
from ibapi.protobuf.HistoricalTicksBidAsk_pb2 import HistoricalTicksBidAsk as HistoricalTicksBidAskProto
from ibapi.protobuf.HistoricalTicksLast_pb2 import HistoricalTicksLast as HistoricalTicksLastProto
from ibapi.protobuf.TickByTickData_pb2 import TickByTickData as TickByTickDataProto
from ibapi.protobuf.NewsBulletin_pb2 import NewsBulletin as NewsBulletinProto
from ibapi.protobuf.NewsArticle_pb2 import NewsArticle as NewsArticleProto
from ibapi.protobuf.NewsProviders_pb2 import NewsProviders as NewsProvidersProto
from ibapi.protobuf.HistoricalNews_pb2 import HistoricalNews as HistoricalNewsProto
from ibapi.protobuf.HistoricalNewsEnd_pb2 import HistoricalNewsEnd as HistoricalNewsEndProto
from ibapi.protobuf.WshMetaData_pb2 import WshMetaData as WshMetaDataProto
from ibapi.protobuf.WshEventData_pb2 import WshEventData as WshEventDataProto
from ibapi.protobuf.TickNews_pb2 import TickNews as TickNewsProto
from ibapi.protobuf.ScannerParameters_pb2 import ScannerParameters as ScannerParametersProto
from ibapi.protobuf.ScannerData_pb2 import ScannerData as ScannerDataProto
from ibapi.protobuf.FundamentalsData_pb2 import FundamentalsData as FundamentalsDataProto
from ibapi.protobuf.PnL_pb2 import PnL as PnLProto
from ibapi.protobuf.PnLSingle_pb2 import PnLSingle as PnLSingleProto
from ibapi.protobuf.ReceiveFA_pb2 import ReceiveFA as ReceiveFAProto
from ibapi.protobuf.ReplaceFAEnd_pb2 import ReplaceFAEnd as ReplaceFAEndProto
from ibapi.protobuf.CommissionAndFeesReport_pb2 import CommissionAndFeesReport as CommissionAndFeesReportProto
from ibapi.protobuf.HistoricalSchedule_pb2 import HistoricalSchedule as HistoricalScheduleProto
from ibapi.protobuf.RerouteMarketDataRequest_pb2 import RerouteMarketDataRequest as RerouteMarketDataRequestProto
from ibapi.protobuf.RerouteMarketDepthRequest_pb2 import RerouteMarketDepthRequest as RerouteMarketDepthRequestProto
from ibapi.protobuf.SecDefOptParameter_pb2 import SecDefOptParameter as SecDefOptParameterProto
from ibapi.protobuf.SecDefOptParameterEnd_pb2 import SecDefOptParameterEnd as SecDefOptParameterEndProto
from ibapi.protobuf.SoftDollarTiers_pb2 import SoftDollarTiers as SoftDollarTiersProto
from ibapi.protobuf.FamilyCodes_pb2 import FamilyCodes as FamilyCodesProto
from ibapi.protobuf.SymbolSamples_pb2 import SymbolSamples as SymbolSamplesProto
from ibapi.protobuf.SmartComponents_pb2 import SmartComponents as SmartComponentsProto
from ibapi.protobuf.MarketRule_pb2 import MarketRule as MarketRuleProto
from ibapi.protobuf.UserInfo_pb2 import UserInfo as UserInfoProto
from ibapi.protobuf.NextValidId_pb2 import NextValidId as NextValidIdProto
from ibapi.protobuf.CurrentTime_pb2 import CurrentTime as CurrentTimeProto
from ibapi.protobuf.CurrentTimeInMillis_pb2 import CurrentTimeInMillis as CurrentTimeInMillisProto
from ibapi.protobuf.VerifyMessageApi_pb2 import VerifyMessageApi as VerifyMessageApiProto
from ibapi.protobuf.VerifyCompleted_pb2 import VerifyCompleted as VerifyCompletedProto
from ibapi.protobuf.DisplayGroupList_pb2 import DisplayGroupList as DisplayGroupListProto
from ibapi.protobuf.DisplayGroupUpdated_pb2 import DisplayGroupUpdated as DisplayGroupUpdatedProto
from ibapi.protobuf.MarketDepthExchanges_pb2 import MarketDepthExchanges as MarketDepthExchangesProto
from ibapi.protobuf.ConfigResponse_pb2 import ConfigResponse as ConfigResponseProto
from ibapi.protobuf.UpdateConfigResponse_pb2 import UpdateConfigResponse as UpdateConfigResponseProto

logger = logging.getLogger(__name__)


class HandleInfo(Object):
    def __init__(self, wrap=None, proc=None):
        self.wrapperMeth = wrap
        self.wrapperParams = None
        self.processMeth = proc
        if wrap is None and proc is None:
            raise ValueError("both wrap and proc can't be None")

    def __str__(self):
        s = f"wrap:{self.wrapperMeth} meth:{self.processMeth} prms:{self.wrapperParams}"
        return s


class Decoder(Object):
    def __init__(self, wrapper, serverVersion):
        self.wrapper = wrapper
        self.serverVersion = serverVersion
        self.discoverParams()

    def processTickPriceMsg(self, fields):
        decode(int, fields)

        reqId = decode(int, fields)
        tickType = decode(int, fields)
        price = decode(float, fields)
        size = decode(Decimal, fields)  # ver 2 field
        attrMask = decode(int, fields)  # ver 3 field

        attrib = TickAttrib()

        attrib.canAutoExecute = attrMask == 1

        if self.serverVersion >= MIN_SERVER_VER_PAST_LIMIT:
            attrib.canAutoExecute = attrMask & 1 != 0
            attrib.pastLimit = attrMask & 2 != 0
            if self.serverVersion >= MIN_SERVER_VER_PRE_OPEN_BID_ASK:
                attrib.preOpen = attrMask & 4 != 0

        self.wrapper.tickPrice(reqId, tickType, price, attrib)

        # process ver 2 fields
        sizeTickType = TickTypeEnum.NOT_SET
        if TickTypeEnum.BID == tickType:
            sizeTickType = TickTypeEnum.BID_SIZE
        elif TickTypeEnum.ASK == tickType:
            sizeTickType = TickTypeEnum.ASK_SIZE
        elif TickTypeEnum.LAST == tickType:
            sizeTickType = TickTypeEnum.LAST_SIZE
        elif TickTypeEnum.DELAYED_BID == tickType:
            sizeTickType = TickTypeEnum.DELAYED_BID_SIZE
        elif TickTypeEnum.DELAYED_ASK == tickType:
            sizeTickType = TickTypeEnum.DELAYED_ASK_SIZE
        elif TickTypeEnum.DELAYED_LAST == tickType:
            sizeTickType = TickTypeEnum.DELAYED_LAST_SIZE

        if sizeTickType != TickTypeEnum.NOT_SET:
            self.wrapper.tickSize(reqId, sizeTickType, size)

    def processTickPriceMsgProtoBuf(self, protobuf):
        tickPriceProto = TickPriceProto()
        tickPriceProto.ParseFromString(protobuf)

        self.wrapper.tickPriceProtoBuf(tickPriceProto)

        reqId = tickPriceProto.reqId if tickPriceProto.HasField('reqId') else NO_VALID_ID
        tickType = tickPriceProto.tickType if tickPriceProto.HasField('tickType') else UNSET_INTEGER
        price = tickPriceProto.price if tickPriceProto.HasField('price') else UNSET_DOUBLE
        size = Decimal(tickPriceProto.size) if tickPriceProto.HasField('size') else UNSET_DECIMAL
        attrMask = tickPriceProto.attrMask if tickPriceProto.HasField('attrMask') else UNSET_INTEGER
        attrib = TickAttrib()
        attrib.canAutoExecute = attrMask & 1 != 0
        attrib.pastLimit = attrMask & 2 != 0
        attrib.preOpen = attrMask & 4 != 0

        self.wrapper.tickPrice(reqId, tickType, price, attrib)

        sizeTickType = TickTypeEnum.NOT_SET
        if TickTypeEnum.BID == tickType:
            sizeTickType = TickTypeEnum.BID_SIZE
        elif TickTypeEnum.ASK == tickType:
            sizeTickType = TickTypeEnum.ASK_SIZE
        elif TickTypeEnum.LAST == tickType:
            sizeTickType = TickTypeEnum.LAST_SIZE
        elif TickTypeEnum.DELAYED_BID == tickType:
            sizeTickType = TickTypeEnum.DELAYED_BID_SIZE
        elif TickTypeEnum.DELAYED_ASK == tickType:
            sizeTickType = TickTypeEnum.DELAYED_ASK_SIZE
        elif TickTypeEnum.DELAYED_LAST == tickType:
            sizeTickType = TickTypeEnum.DELAYED_LAST_SIZE

        if sizeTickType != TickTypeEnum.NOT_SET:
            self.wrapper.tickSize(reqId, sizeTickType, size)

    def processTickSizeMsg(self, fields):
        decode(int, fields)

        reqId = decode(int, fields)
        sizeTickType = decode(int, fields)
        size = decode(Decimal, fields)

        if sizeTickType != TickTypeEnum.NOT_SET:
            self.wrapper.tickSize(reqId, sizeTickType, size)

    def processTickSizeMsgProtoBuf(self, protobuf):
        tickSizeProto = TickSizeProto()
        tickSizeProto.ParseFromString(protobuf)

        self.wrapper.tickSizeProtoBuf(tickSizeProto)

        reqId = tickSizeProto.reqId if tickSizeProto.HasField('reqId') else NO_VALID_ID
        tickType = tickSizeProto.tickType if tickSizeProto.HasField('tickType') else UNSET_INTEGER
        size = Decimal(tickSizeProto.size) if tickSizeProto.HasField('size') else UNSET_DECIMAL

        if tickType != TickTypeEnum.NOT_SET:
            self.wrapper.tickSize(reqId, tickType, size)

    def processOrderStatusMsg(self, fields):
        if self.serverVersion < MIN_SERVER_VER_MARKET_CAP_PRICE:
            decode(int, fields)
        orderId = decode(int, fields)
        status = decode(str, fields)
        filled = decode(Decimal, fields)
        remaining = decode(Decimal, fields)
        avgFillPrice = decode(float, fields)

        permId = decode(int, fields)  # ver 2 field
        parentId = decode(int, fields)  # ver 3 field
        lastFillPrice = decode(float, fields)  # ver 4 field
        clientId = decode(int, fields)  # ver 5 field
        whyHeld = decode(str, fields)  # ver 6 field

        if self.serverVersion >= MIN_SERVER_VER_MARKET_CAP_PRICE:
            mktCapPrice = decode(float, fields)
        else:
            mktCapPrice = None

        self.wrapper.orderStatus(
            orderId,
            status,
            filled,
            remaining,
            avgFillPrice,
            permId,
            parentId,
            lastFillPrice,
            clientId,
            whyHeld,
            mktCapPrice,
        )

    def processOrderStatusMsgProtoBuf(self, protobuf):
        orderStatusProto = OrderStatusProto()
        orderStatusProto.ParseFromString(protobuf)

        self.wrapper.orderStatusProtoBuf(orderStatusProto)

        orderId = orderStatusProto.orderId if orderStatusProto.HasField('orderId') else UNSET_INTEGER
        status = orderStatusProto.status if orderStatusProto.HasField('status') else ""
        filled = Decimal(orderStatusProto.filled) if orderStatusProto.HasField('filled') else UNSET_DECIMAL
        remaining = Decimal(orderStatusProto.remaining) if orderStatusProto.HasField('remaining') else UNSET_DECIMAL
        avgFillPrice = orderStatusProto.avgFillPrice if orderStatusProto.HasField('avgFillPrice') else UNSET_DOUBLE
        permId = orderStatusProto.permId if orderStatusProto.HasField('permId') else UNSET_LONG
        parentId = orderStatusProto.parentId if orderStatusProto.HasField('parentId') else UNSET_INTEGER
        lastFillPrice = orderStatusProto.lastFillPrice if orderStatusProto.HasField('lastFillPrice') else UNSET_DOUBLE
        clientId = orderStatusProto.clientId if orderStatusProto.HasField('clientId') else UNSET_INTEGER
        whyHeld = orderStatusProto.whyHeld if orderStatusProto.HasField('whyHeld') else ""
        mktCapPrice = orderStatusProto.mktCapPrice if orderStatusProto.HasField('mktCapPrice') else UNSET_DOUBLE

        self.wrapper.orderStatus(orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice)

    def processOpenOrder(self, fields):
        order = Order()
        contract = Contract()
        orderState = OrderState()

        if self.serverVersion < MIN_SERVER_VER_ORDER_CONTAINER:
            version = decode(int, fields)
        else:
            version = self.serverVersion

        OrderDecoder.__init__(
            self, contract, order, orderState, version, self.serverVersion
        )

        # read orderId
        OrderDecoder.decodeOrderId(self, fields)

        # read contract fields
        OrderDecoder.decodeContractFields(self, fields)

        # read order fields
        OrderDecoder.decodeAction(self, fields)
        OrderDecoder.decodeTotalQuantity(self, fields)
        OrderDecoder.decodeOrderType(self, fields)
        OrderDecoder.decodeLmtPrice(self, fields)
        OrderDecoder.decodeAuxPrice(self, fields)
        OrderDecoder.decodeTIF(self, fields)
        OrderDecoder.decodeOcaGroup(self, fields)
        OrderDecoder.decodeAccount(self, fields)
        OrderDecoder.decodeOpenClose(self, fields)
        OrderDecoder.decodeOrigin(self, fields)
        OrderDecoder.decodeOrderRef(self, fields)
        OrderDecoder.decodeClientId(self, fields)
        OrderDecoder.decodePermId(self, fields)
        OrderDecoder.decodeOutsideRth(self, fields)
        OrderDecoder.decodeHidden(self, fields)
        OrderDecoder.decodeDiscretionaryAmt(self, fields)
        OrderDecoder.decodeGoodAfterTime(self, fields)
        OrderDecoder.skipSharesAllocation(self, fields)
        OrderDecoder.decodeFAParams(self, fields)
        OrderDecoder.decodeModelCode(self, fields)
        OrderDecoder.decodeGoodTillDate(self, fields)
        OrderDecoder.decodeRule80A(self, fields)
        OrderDecoder.decodePercentOffset(self, fields)
        OrderDecoder.decodeSettlingFirm(self, fields)
        OrderDecoder.decodeShortSaleParams(self, fields)
        OrderDecoder.decodeAuctionStrategy(self, fields)
        OrderDecoder.decodeBoxOrderParams(self, fields)
        OrderDecoder.decodePegToStkOrVolOrderParams(self, fields)
        OrderDecoder.decodeDisplaySize(self, fields)
        OrderDecoder.decodeBlockOrder(self, fields)
        OrderDecoder.decodeSweepToFill(self, fields)
        OrderDecoder.decodeAllOrNone(self, fields)
        OrderDecoder.decodeMinQty(self, fields)
        OrderDecoder.decodeOcaType(self, fields)
        OrderDecoder.skipETradeOnly(self, fields)
        OrderDecoder.skipFirmQuoteOnly(self, fields)
        OrderDecoder.skipNbboPriceCap(self, fields)
        OrderDecoder.decodeParentId(self, fields)
        OrderDecoder.decodeTriggerMethod(self, fields)
        OrderDecoder.decodeVolOrderParams(self, fields, True)
        OrderDecoder.decodeTrailParams(self, fields)
        OrderDecoder.decodeBasisPoints(self, fields)
        OrderDecoder.decodeComboLegs(self, fields)
        OrderDecoder.decodeSmartComboRoutingParams(self, fields)
        OrderDecoder.decodeScaleOrderParams(self, fields)
        OrderDecoder.decodeHedgeParams(self, fields)
        OrderDecoder.decodeOptOutSmartRouting(self, fields)
        OrderDecoder.decodeClearingParams(self, fields)
        OrderDecoder.decodeNotHeld(self, fields)
        OrderDecoder.decodeDeltaNeutral(self, fields)
        OrderDecoder.decodeAlgoParams(self, fields)
        OrderDecoder.decodeSolicited(self, fields)
        OrderDecoder.decodeWhatIfInfoAndCommissionAndFees(self, fields)
        OrderDecoder.decodeVolRandomizeFlags(self, fields)
        OrderDecoder.decodePegToBenchParams(self, fields)
        OrderDecoder.decodeConditions(self, fields)
        OrderDecoder.decodeAdjustedOrderParams(self, fields)
        OrderDecoder.decodeSoftDollarTier(self, fields)
        OrderDecoder.decodeCashQty(self, fields)
        OrderDecoder.decodeDontUseAutoPriceForHedge(self, fields)
        OrderDecoder.decodeIsOmsContainers(self, fields)
        OrderDecoder.decodeDiscretionaryUpToLimitPrice(self, fields)
        OrderDecoder.decodeUsePriceMgmtAlgo(self, fields)
        OrderDecoder.decodeDuration(self, fields)
        OrderDecoder.decodePostToAts(self, fields)
        OrderDecoder.decodeAutoCancelParent(
            self, fields, MIN_SERVER_VER_AUTO_CANCEL_PARENT
        )
        OrderDecoder.decodePegBestPegMidOrderAttributes(self, fields)
        OrderDecoder.decodeCustomerAccount(self, fields)
        OrderDecoder.decodeProfessionalCustomer(self, fields)
        OrderDecoder.decodeBondAccruedInterest(self, fields)
        OrderDecoder.decodeIncludeOvernight(self, fields)
        OrderDecoder.decodeCMETaggingFields(self, fields)
        OrderDecoder.decodeSubmitter(self, fields)
        OrderDecoder.decodeImbalanceOnly(
            self, fields, MIN_SERVER_VER_IMBALANCE_ONLY
        )

        self.wrapper.openOrder(order.orderId, contract, order, orderState)

    def processOpenOrderMsgProtoBuf(self, protobuf):
        openOrderProto = OpenOrderProto()
        openOrderProto.ParseFromString(protobuf)

        self.wrapper.openOrderProtoBuf(openOrderProto)

        orderId = openOrderProto.orderId if openOrderProto.HasField('orderId') else 0

        # decode contract fields
        if not openOrderProto.HasField('contract'):
            return
        contract = decodeContract(openOrderProto.contract)

        # decode order fields
        if not openOrderProto.HasField('order'):
            return
        order = decodeOrder(orderId, openOrderProto.contract, openOrderProto.order)
        
        # decode order state fields
        if not openOrderProto.HasField('orderState'):
            return
        orderState = decodeOrderState(openOrderProto.orderState)

        self.wrapper.openOrder(orderId, contract, order, orderState);

    def processOpenOrdersEndMsgProtoBuf(self, protobuf):
        openOrdersEndProto = OpenOrdersEndProto()
        openOrdersEndProto.ParseFromString(protobuf)

        self.wrapper.openOrdersEndProtoBuf(openOrdersEndProto)

        self.wrapper.openOrderEnd()

    def processPortfolioValueMsg(self, fields):
        version = decode(int, fields)

        # read contract fields
        contract = Contract()
        contract.conId = decode(int, fields)  # ver 6 field
        contract.symbol = decode(str, fields)
        contract.secType = decode(str, fields)
        contract.lastTradeDateOrContractMonth = decode(str, fields)
        contract.strike = decode(float, fields)
        contract.right = decode(str, fields)

        if version >= 7:
            contract.multiplier = decode(str, fields)
            contract.primaryExchange = decode(str, fields)

        contract.currency = decode(str, fields)
        contract.localSymbol = decode(str, fields)  # ver 2 field
        if version >= 8:
            contract.tradingClass = decode(str, fields)

        position = decode(Decimal, fields)

        marketPrice = decode(float, fields)
        marketValue = decode(float, fields)
        averageCost = decode(float, fields)  # ver 3 field
        unrealizedPNL = decode(float, fields)  # ver 3 field
        realizedPNL = decode(float, fields)  # ver 3 field

        accountName = decode(str, fields)  # ver 4 field

        if version == 6 and self.serverVersion == 39:
            contract.primaryExchange = decode(str, fields)

        self.wrapper.updatePortfolio(
            contract,
            position,
            marketPrice,
            marketValue,
            averageCost,
            unrealizedPNL,
            realizedPNL,
            accountName,
        )

    def processPortfolioValueMsgProtoBuf(self, protobuf):
        portfolioValueProto = PortfolioValueProto()
        portfolioValueProto.ParseFromString(protobuf)

        self.wrapper.updatePortfolioProtoBuf(portfolioValueProto)

        # decode contract fields
        if not portfolioValueProto.HasField('contract'):
            return
        contract = decodeContract(portfolioValueProto.contract)

        position = Decimal(portfolioValueProto.position) if portfolioValueProto.HasField('position') else UNSET_DECIMAL
        marketPrice = portfolioValueProto.marketPrice if portfolioValueProto.HasField('marketPrice') else 0
        marketValue = portfolioValueProto.marketValue if portfolioValueProto.HasField('marketValue') else 0
        averageCost = portfolioValueProto.averageCost if portfolioValueProto.HasField('averageCost') else 0
        unrealizedPNL = portfolioValueProto.unrealizedPNL if portfolioValueProto.HasField('unrealizedPNL') else 0
        realizedPNL = portfolioValueProto.realizedPNL if portfolioValueProto.HasField('realizedPNL') else 0
        accountName = portfolioValueProto.accountName if portfolioValueProto.HasField('accountName') else ""

        self.wrapper.updatePortfolio(contract, position, marketPrice, marketValue, averageCost, unrealizedPNL, realizedPNL, accountName)

    def processContractDataMsg(self, fields):
        version = 8
        if self.serverVersion < MIN_SERVER_VER_SIZE_RULES:
            version = decode(int, fields)

        reqId = -1
        if version >= 3:
            reqId = decode(int, fields)

        contract = ContractDetails()
        contract.contract.symbol = decode(str, fields)
        contract.contract.secType = decode(str, fields)
        self.readLastTradeDate(fields, contract, False)
        if self.serverVersion >= MIN_SERVER_VER_LAST_TRADE_DATE:
            contract.contract.lastTradeDate = decode(str, fields)
        contract.contract.strike = decode(float, fields)
        contract.contract.right = decode(str, fields)
        contract.contract.exchange = decode(str, fields)
        contract.contract.currency = decode(str, fields)
        contract.contract.localSymbol = decode(str, fields)
        contract.marketName = decode(str, fields)
        contract.contract.tradingClass = decode(str, fields)
        contract.contract.conId = decode(int, fields)
        contract.minTick = decode(float, fields)
        if (
            self.serverVersion >= MIN_SERVER_VER_MD_SIZE_MULTIPLIER
            and self.serverVersion < MIN_SERVER_VER_SIZE_RULES
        ):
            decode(int, fields)  # mdSizeMultiplier - not used anymore
        contract.contract.multiplier = decode(str, fields)
        contract.orderTypes = decode(str, fields)
        contract.validExchanges = decode(str, fields)
        contract.priceMagnifier = decode(int, fields)  # ver 2 field
        if version >= 4:
            contract.underConId = decode(int, fields)
        if version >= 5:
            contract.longName = (
                decode(str, fields).encode().decode("unicode-escape")
                if self.serverVersion >= MIN_SERVER_VER_ENCODE_MSG_ASCII7
                else decode(str, fields)
            )
            contract.contract.primaryExchange = decode(str, fields)
        if version >= 6:
            contract.contractMonth = decode(str, fields)
            contract.industry = decode(str, fields)
            contract.category = decode(str, fields)
            contract.subcategory = decode(str, fields)
            contract.timeZoneId = decode(str, fields)
            contract.tradingHours = decode(str, fields)
            contract.liquidHours = decode(str, fields)
        if version >= 8:
            contract.evRule = decode(str, fields)
            contract.evMultiplier = decode(int, fields)
        if version >= 7:
            secIdListCount = decode(int, fields)
            if secIdListCount > 0:
                contract.secIdList = []
                for _ in range(secIdListCount):
                    tagValue = TagValue()
                    tagValue.tag = decode(str, fields)
                    tagValue.value = decode(str, fields)
                    contract.secIdList.append(tagValue)

        if self.serverVersion >= MIN_SERVER_VER_AGG_GROUP:
            contract.aggGroup = decode(int, fields)

        if self.serverVersion >= MIN_SERVER_VER_UNDERLYING_INFO:
            contract.underSymbol = decode(str, fields)
            contract.underSecType = decode(str, fields)

        if self.serverVersion >= MIN_SERVER_VER_MARKET_RULES:
            contract.marketRuleIds = decode(str, fields)

        if self.serverVersion >= MIN_SERVER_VER_REAL_EXPIRATION_DATE:
            contract.realExpirationDate = decode(str, fields)

        if self.serverVersion >= MIN_SERVER_VER_STOCK_TYPE:
            contract.stockType = decode(str, fields)

        if (
            self.serverVersion >= MIN_SERVER_VER_FRACTIONAL_SIZE_SUPPORT
            and self.serverVersion < MIN_SERVER_VER_SIZE_RULES
        ):
            decode(Decimal, fields)  # sizeMinTick - not used anymore

        if self.serverVersion >= MIN_SERVER_VER_SIZE_RULES:
            contract.minSize = decode(Decimal, fields)
            contract.sizeIncrement = decode(Decimal, fields)
            contract.suggestedSizeIncrement = decode(Decimal, fields)

        if (
            self.serverVersion >= MIN_SERVER_VER_FUND_DATA_FIELDS
            and contract.contract.secType == "FUND"
        ):
            contract.fundName = decode(str, fields)
            contract.fundFamily = decode(str, fields)
            contract.fundType = decode(str, fields)
            contract.fundFrontLoad = decode(str, fields)
            contract.fundBackLoad = decode(str, fields)
            contract.fundBackLoadTimeInterval = decode(str, fields)
            contract.fundManagementFee = decode(str, fields)
            contract.fundClosed = decode(bool, fields)
            contract.fundClosedForNewInvestors = decode(bool, fields)
            contract.fundClosedForNewMoney = decode(bool, fields)
            contract.fundNotifyAmount = decode(str, fields)
            contract.fundMinimumInitialPurchase = decode(str, fields)
            contract.fundSubsequentMinimumPurchase = decode(str, fields)
            contract.fundBlueSkyStates = decode(str, fields)
            contract.fundBlueSkyTerritories = decode(str, fields)
            contract.fundDistributionPolicyIndicator = getEnumTypeFromString(FundDistributionPolicyIndicator, decode(str, fields))
            contract.fundAssetType = getEnumTypeFromString(FundAssetType, decode(str, fields))

        if self.serverVersion >= MIN_SERVER_VER_INELIGIBILITY_REASONS:
            ineligibilityReasonListCount = decode(int, fields)
            if ineligibilityReasonListCount > 0:
                contract.ineligibilityReasonList = []
                for _ in range(ineligibilityReasonListCount):
                    ineligibilityReason = IneligibilityReason()
                    ineligibilityReason.id_ = decode(str, fields)
                    ineligibilityReason.description = decode(str, fields)
                    contract.ineligibilityReasonList.append(ineligibilityReason)

        self.wrapper.contractDetails(reqId, contract)

    def processContractDataMsgProtoBuf(self, protobuf):
        contractDataProto = ContractDataProto()
        contractDataProto.ParseFromString(protobuf)

        self.wrapper.contractDataProtoBuf(contractDataProto)

        reqId = contractDataProto.reqId if contractDataProto.HasField('reqId') else NO_VALID_ID

        # decode contract details fields
        if not contractDataProto.HasField('contract') or not contractDataProto.HasField('contractDetails'):
            return
        contractDetails = decodeContractDetails(contractDataProto.contract, contractDataProto.contractDetails, False)

        self.wrapper.contractDetails(reqId, contractDetails)

    def processBondContractDataMsg(self, fields):
        version = 6
        if self.serverVersion < MIN_SERVER_VER_SIZE_RULES:
            version = decode(int, fields)

        reqId = -1
        if version >= 3:
            reqId = decode(int, fields)

        contract = ContractDetails()
        contract.contract.symbol = decode(str, fields)
        contract.contract.secType = decode(str, fields)
        contract.cusip = decode(str, fields)
        contract.coupon = decode(float, fields)
        self.readLastTradeDate(fields, contract, True)
        contract.issueDate = decode(str, fields)
        contract.ratings = decode(str, fields)
        contract.bondType = decode(str, fields)
        contract.couponType = decode(str, fields)
        contract.convertible = decode(bool, fields)
        contract.callable = decode(bool, fields)
        contract.putable = decode(bool, fields)
        contract.descAppend = decode(str, fields)
        contract.contract.exchange = decode(str, fields)
        contract.contract.currency = decode(str, fields)
        contract.marketName = decode(str, fields)
        contract.contract.tradingClass = decode(str, fields)
        contract.contract.conId = decode(int, fields)
        contract.minTick = decode(float, fields)
        if (
            self.serverVersion >= MIN_SERVER_VER_MD_SIZE_MULTIPLIER
            and self.serverVersion < MIN_SERVER_VER_SIZE_RULES
        ):
            decode(int, fields)  # mdSizeMultiplier - not used anymore
        contract.orderTypes = decode(str, fields)
        contract.validExchanges = decode(str, fields)
        contract.nextOptionDate = decode(str, fields)  # ver 2 field
        contract.nextOptionType = decode(str, fields)  # ver 2 field
        contract.nextOptionPartial = decode(bool, fields)  # ver 2 field
        contract.notes = decode(str, fields)  # ver 2 field
        if version >= 4:
            contract.longName = decode(str, fields)
        if self.serverVersion >= MIN_SERVER_VER_BOND_TRADING_HOURS:
            contract.timeZoneId = decode(str, fields)
            contract.tradingHours = decode(str, fields)
            contract.liquidHours = decode(str, fields)
        if version >= 6:
            contract.evRule = decode(str, fields)
            contract.evMultiplier = decode(int, fields)
        if version >= 5:
            secIdListCount = decode(int, fields)
            if secIdListCount > 0:
                contract.secIdList = []
                for _ in range(secIdListCount):
                    tagValue = TagValue()
                    tagValue.tag = decode(str, fields)
                    tagValue.value = decode(str, fields)
                    contract.secIdList.append(tagValue)

        if self.serverVersion >= MIN_SERVER_VER_AGG_GROUP:
            contract.aggGroup = decode(int, fields)

        if self.serverVersion >= MIN_SERVER_VER_MARKET_RULES:
            contract.marketRuleIds = decode(str, fields)

        if self.serverVersion >= MIN_SERVER_VER_SIZE_RULES:
            contract.minSize = decode(Decimal, fields)
            contract.sizeIncrement = decode(Decimal, fields)
            contract.suggestedSizeIncrement = decode(Decimal, fields)

        self.wrapper.bondContractDetails(reqId, contract)

    def processBondContractDataMsgProtoBuf(self, protobuf):
        contractDataProto = ContractDataProto()
        contractDataProto.ParseFromString(protobuf)

        self.wrapper.bondContractDataProtoBuf(contractDataProto)

        reqId = contractDataProto.reqId if contractDataProto.HasField('reqId') else NO_VALID_ID

        # decode contract details fields
        if not contractDataProto.HasField('contract') or not contractDataProto.HasField('contractDetails'):
            return
        contractDetails = decodeContractDetails(contractDataProto.contract, contractDataProto.contractDetails, True)

        self.wrapper.bondContractDetails(reqId, contractDetails)

    def processContractDataEndMsgProtoBuf(self, protobuf):
        contractDataEndProto = ContractDataEndProto()
        contractDataEndProto.ParseFromString(protobuf)

        self.wrapper.contractDataEndProtoBuf(contractDataEndProto)

        reqId = contractDataEndProto.reqId if contractDataEndProto.HasField('reqId') else NO_VALID_ID

        self.wrapper.contractDetailsEnd(reqId)

    def processScannerDataMsg(self, fields):
        decode(int, fields)
        reqId = decode(int, fields)

        numberOfElements = decode(int, fields)

        for _ in range(numberOfElements):
            data = ScanData()
            data.contract = ContractDetails()

            data.rank = decode(int, fields)
            data.contract.contract.conId = decode(int, fields)  # ver 3 field
            data.contract.contract.symbol = decode(str, fields)
            data.contract.contract.secType = decode(str, fields)
            data.contract.contract.lastTradeDateOrContractMonth = decode(str, fields)
            data.contract.contract.strike = decode(float, fields)
            data.contract.contract.right = decode(str, fields)
            data.contract.contract.exchange = decode(str, fields)
            data.contract.contract.currency = decode(str, fields)
            data.contract.contract.localSymbol = decode(str, fields)
            data.contract.marketName = decode(str, fields)
            data.contract.contract.tradingClass = decode(str, fields)
            data.distance = decode(str, fields)
            data.benchmark = decode(str, fields)
            data.projection = decode(str, fields)
            data.legsStr = decode(str, fields)
            self.wrapper.scannerData(
                reqId,
                data.rank,
                data.contract,
                data.distance,
                data.benchmark,
                data.projection,
                data.legsStr,
            )

        self.wrapper.scannerDataEnd(reqId)

    def processScannerDataMsgProtoBuf(self, protobuf):
        scannerDataProto = ScannerDataProto()
        scannerDataProto.ParseFromString(protobuf)

        self.wrapper.scannerDataProtoBuf(scannerDataProto)

        reqId = scannerDataProto.reqId if scannerDataProto.HasField('reqId') else NO_VALID_ID

        if scannerDataProto.scannerDataElement:
            for element in scannerDataProto.scannerDataElement:
                rank = element.rank if element.HasField('rank') else 0

                # Set contract details
                contractDetails = ContractDetails()
                if element.HasField('contract'):
                    contract = decodeContract(element.contract)
                    contractDetails.contract = contract
                    contractDetails.marketName = element.marketName if element.HasField('marketName') else ""

                distance = element.distance if element.HasField('distance') else ""
                benchmark = element.benchmark if element.HasField('benchmark') else ""
                projection = element.projection if element.HasField('projection') else ""
                comboKey = element.comboKey if element.HasField('comboKey') else ""

                self.wrapper.scannerData(reqId, rank, contractDetails, distance, benchmark, projection, comboKey)

        self.wrapper.scannerDataEnd(reqId)

    def processExecutionDataMsg(self, fields):
        version = self.serverVersion

        if self.serverVersion < MIN_SERVER_VER_LAST_LIQUIDITY:
            version = decode(int, fields)

        reqId = -1
        if version >= 7:
            reqId = decode(int, fields)

        orderId = decode(int, fields)

        # decode contract fields
        contract = Contract()
        contract.conId = decode(int, fields)  # ver 5 field
        contract.symbol = decode(str, fields)
        contract.secType = decode(str, fields)
        contract.lastTradeDateOrContractMonth = decode(str, fields)
        contract.strike = decode(float, fields)
        contract.right = decode(str, fields)
        if version >= 9:
            contract.multiplier = decode(str, fields)
        contract.exchange = decode(str, fields)
        contract.currency = decode(str, fields)
        contract.localSymbol = decode(str, fields)
        if version >= 10:
            contract.tradingClass = decode(str, fields)

        # decode execution fields
        execution = Execution()
        execution.orderId = orderId
        execution.execId = decode(str, fields)
        execution.time = decode(str, fields)
        execution.acctNumber = decode(str, fields)
        execution.exchange = decode(str, fields)
        execution.side = decode(str, fields)
        execution.shares = decode(Decimal, fields)
        execution.price = decode(float, fields)
        execution.permId = decode(int, fields)  # ver 2 field
        execution.clientId = decode(int, fields)  # ver 3 field
        execution.liquidation = decode(int, fields)  # ver 4 field

        if version >= 6:
            execution.cumQty = decode(Decimal, fields)
            execution.avgPrice = decode(float, fields)

        if version >= 8:
            execution.orderRef = decode(str, fields)

        if version >= 9:
            execution.evRule = decode(str, fields)
            execution.evMultiplier = decode(float, fields)
        if self.serverVersion >= MIN_SERVER_VER_MODELS_SUPPORT:
            execution.modelCode = decode(str, fields)
        if self.serverVersion >= MIN_SERVER_VER_LAST_LIQUIDITY:
            execution.lastLiquidity = decode(int, fields)
        if self.serverVersion >= MIN_SERVER_VER_PENDING_PRICE_REVISION:
            execution.pendingPriceRevision = decode(bool, fields)
        if self.serverVersion >= MIN_SERVER_VER_SUBMITTER:
            execution.submitter = decode(str, fields)

        self.wrapper.execDetails(reqId, contract, execution)

    def processExecutionDataEndMsgProtoBuf(self, protobuf):
        executionDetailsEndProto = ExecutionDetailsEndProto()
        executionDetailsEndProto.ParseFromString(protobuf)

        self.wrapper.executionDetailsEndProtoBuf(executionDetailsEndProto)

        reqId = executionDetailsEndProto.reqId if executionDetailsEndProto.HasField('reqId') else NO_VALID_ID

        self.wrapper.execDetailsEnd(reqId)

    def processExecutionDataMsgProtoBuf(self, protobuf):
        executionDetailsProto = ExecutionDetailsProto()
        executionDetailsProto.ParseFromString(protobuf)

        self.wrapper.executionDetailsProtoBuf(executionDetailsProto)

        reqId = executionDetailsProto.reqId if executionDetailsProto.HasField('reqId') else NO_VALID_ID

        # decode contract fields
        if not executionDetailsProto.HasField('contract'):
            return
        contract = decodeContract(executionDetailsProto.contract)

        # decode execution fields
        if not executionDetailsProto.HasField('execution'):
            return
        execution = decodeExecution(executionDetailsProto.execution)

        self.wrapper.execDetails(reqId, contract, execution)

    def processHistoricalDataMsg(self, fields):
        if self.serverVersion < MIN_SERVER_VER_SYNT_REALTIME_BARS:
            decode(int, fields)

        reqId = decode(int, fields)
        
        if self.serverVersion < MIN_SERVER_VER_HISTORICAL_DATA_END:
            startDateStr = decode(str, fields)  # ver 2 field
            endDateStr = decode(str, fields)  # ver 2 field

        itemCount = decode(int, fields)

        for _ in range(itemCount):
            bar = BarData()
            bar.date = decode(str, fields)
            bar.open = decode(float, fields)
            bar.high = decode(float, fields)
            bar.low = decode(float, fields)
            bar.close = decode(float, fields)
            bar.volume = decode(Decimal, fields)
            bar.wap = decode(Decimal, fields)

            if self.serverVersion < MIN_SERVER_VER_SYNT_REALTIME_BARS:
                decode(str, fields)

            bar.barCount = decode(int, fields)  # ver 3 field

            self.wrapper.historicalData(reqId, bar)

        if self.serverVersion < MIN_SERVER_VER_HISTORICAL_DATA_END:
            # send end of dataset marker
            self.wrapper.historicalDataEnd(reqId, startDateStr, endDateStr)

    def processHistoricalDataMsgProtoBuf(self, protobuf):
        historicalDataProto = HistoricalDataProto()
        historicalDataProto.ParseFromString(protobuf)

        self.wrapper.historicalDataProtoBuf(historicalDataProto)

        reqId = historicalDataProto.reqId if historicalDataProto.HasField('reqId') else NO_VALID_ID

        if not historicalDataProto.historicalDataBars:
            return

        for historicalDataBarProto in historicalDataProto.historicalDataBars:
            bar = decodeHistoricalDataBar(historicalDataBarProto)
            self.wrapper.historicalData(reqId, bar)

    def processHistoricalDataEndMsg(self, fields):
        reqId = decode(int, fields)
        startDateStr = decode(str, fields)
        endDateStr = decode(str, fields)
        
        self.wrapper.historicalDataEnd(reqId, startDateStr, endDateStr)

    def processHistoricalDataEndMsgProtoBuf(self, protobuf):
        historicalDataEndProto = HistoricalDataEndProto()
        historicalDataEndProto.ParseFromString(protobuf)

        self.wrapper.historicalDataEndProtoBuf(historicalDataEndProto)

        reqId = historicalDataEndProto.reqId if historicalDataEndProto.HasField('reqId') else NO_VALID_ID
        startDateStr = historicalDataEndProto.startDateStr if historicalDataEndProto.HasField('startDateStr') else ""
        endDateStr = historicalDataEndProto.endDateStr if historicalDataEndProto.HasField('endDateStr') else ""

        self.wrapper.historicalDataEnd(reqId, startDateStr, endDateStr)

    def processHistoricalDataUpdateMsg(self, fields):
        reqId = decode(int, fields)
        bar = BarData()
        bar.barCount = decode(int, fields)
        bar.date = decode(str, fields)
        bar.open = decode(float, fields)
        bar.close = decode(float, fields)
        bar.high = decode(float, fields)
        bar.low = decode(float, fields)
        bar.wap = decode(Decimal, fields)
        bar.volume = decode(Decimal, fields)
        self.wrapper.historicalDataUpdate(reqId, bar)

    def processHistoricalDataUpdateMsgProtoBuf(self, protobuf):
        historicalDataUpdateProto = HistoricalDataUpdateProto()
        historicalDataUpdateProto.ParseFromString(protobuf)

        self.wrapper.historicalDataUpdateProtoBuf(historicalDataUpdateProto)

        reqId = historicalDataUpdateProto.reqId if historicalDataUpdateProto.HasField('reqId') else NO_VALID_ID
    
        if not historicalDataUpdateProto.HasField('historicalDataBar'):
            return
        
        bar = decodeHistoricalDataBar(historicalDataUpdateProto.historicalDataBar)
        self.wrapper.historicalDataUpdate(reqId, bar)

    def processRealTimeBarMsg(self, fields):
        decode(int, fields)
        reqId = decode(int, fields)

        bar = RealTimeBar()
        bar.time = decode(int, fields)
        bar.open = decode(float, fields)
        bar.high = decode(float, fields)
        bar.low = decode(float, fields)
        bar.close = decode(float, fields)
        bar.volume = decode(Decimal, fields)
        bar.wap = decode(Decimal, fields)
        bar.count = decode(int, fields)

        self.wrapper.realtimeBar(
            reqId,
            bar.time,
            bar.open,
            bar.high,
            bar.low,
            bar.close,
            bar.volume,
            bar.wap,
            bar.count,
        )

    def processRealTimeBarMsgProtoBuf(self, protobuf):
        realTimeBarTickProto = RealTimeBarTickProto()
        realTimeBarTickProto.ParseFromString(protobuf)

        self.wrapper.realTimeBarTickProtoBuf(realTimeBarTickProto)

        reqId = realTimeBarTickProto.reqId if realTimeBarTickProto.HasField('reqId') else NO_VALID_ID
        time = realTimeBarTickProto.time if realTimeBarTickProto.HasField('time') else 0
        open_ = realTimeBarTickProto.open if realTimeBarTickProto.HasField('open') else 0.0
        high = realTimeBarTickProto.high if realTimeBarTickProto.HasField('high') else 0.0
        low = realTimeBarTickProto.low if realTimeBarTickProto.HasField('low') else 0.0
        close = realTimeBarTickProto.close if realTimeBarTickProto.HasField('close') else 0.0
        volume = Decimal(realTimeBarTickProto.volume) if realTimeBarTickProto.HasField('volume') else UNSET_DECIMAL
        wap = Decimal(realTimeBarTickProto.WAP) if realTimeBarTickProto.HasField('WAP') else UNSET_DECIMAL
        count = realTimeBarTickProto.count if realTimeBarTickProto.HasField('count') else 0

        self.wrapper.realtimeBar(reqId, time, open_, high, low, close, volume, wap, count)

    def processTickOptionComputationMsg(self, fields):
        version = self.serverVersion
        tickAttrib = None
        optPrice = None
        pvDividend = None
        gamma = None
        vega = None
        theta = None
        undPrice = None

        if self.serverVersion < MIN_SERVER_VER_PRICE_BASED_VOLATILITY:
            version = decode(int, fields)

        reqId = decode(int, fields)
        tickTypeInt = decode(int, fields)

        if self.serverVersion >= MIN_SERVER_VER_PRICE_BASED_VOLATILITY:
            tickAttrib = decode(int, fields)

        impliedVol = decode(float, fields)
        delta = decode(float, fields)

        if impliedVol < 0:  # -1 is the "not computed" indicator
            impliedVol = None
        if delta == -2:  # -2 is the "not computed" indicator
            delta = None

        if (
            version >= 6
            or tickTypeInt == TickTypeEnum.MODEL_OPTION
            or tickTypeInt == TickTypeEnum.DELAYED_MODEL_OPTION
        ):
            optPrice = decode(float, fields)
            pvDividend = decode(float, fields)

            if optPrice == -1:  # -1 is the "not computed" indicator
                optPrice = None
            if pvDividend == -1:  # -1 is the "not computed" indicator
                pvDividend = None

        if version >= 6:
            gamma = decode(float, fields)
            vega = decode(float, fields)
            theta = decode(float, fields)
            undPrice = decode(float, fields)

            if gamma == -2:  # -2 is the "not yet computed" indicator
                gamma = None
            if vega == -2:  # -2 is the "not yet computed" indicator
                vega = None
            if theta == -2:  # -2 is the "not yet computed" indicator
                theta = None
            if undPrice == -1:  # -1 is the "not computed" indicator
                undPrice = None

        self.wrapper.tickOptionComputation(
            reqId,
            tickTypeInt,
            tickAttrib,
            impliedVol,
            delta,
            optPrice,
            pvDividend,
            gamma,
            vega,
            theta,
            undPrice,
        )

    def processTickOptionComputationMsgProtoBuf(self, protobuf):
        tickOptionComputationProto = TickOptionComputationProto()
        tickOptionComputationProto.ParseFromString(protobuf)

        self.wrapper.tickOptionComputationProtoBuf(tickOptionComputationProto)

        reqId = tickOptionComputationProto.reqId if tickOptionComputationProto.HasField('reqId') else NO_VALID_ID
        tickType = tickOptionComputationProto.tickType if tickOptionComputationProto.HasField('tickType') else UNSET_INTEGER
        tickAttrib = tickOptionComputationProto.tickAttrib if tickOptionComputationProto.HasField('tickAttrib') else UNSET_INTEGER
        impliedVol = tickOptionComputationProto.impliedVol if tickOptionComputationProto.HasField('impliedVol') else None
        if impliedVol is not None and impliedVol < 0:  # -1 is the "not computed" indicator
            impliedVol = None
        delta = tickOptionComputationProto.delta if tickOptionComputationProto.HasField('delta') else None
        if delta is not None and delta == -2:  # -2 is the "not computed" indicator
            delta = None
        optPrice = tickOptionComputationProto.optPrice if tickOptionComputationProto.HasField('optPrice') else None
        if optPrice is not None and optPrice == -1:  # -1 is the "not computed" indicator
            optPrice = None
        pvDividend = tickOptionComputationProto.pvDividend if tickOptionComputationProto.HasField('pvDividend') else None
        if pvDividend is not None and pvDividend == -1:  # -1 is the "not computed" indicator
            pvDividend = None
        gamma = tickOptionComputationProto.gamma if tickOptionComputationProto.HasField('gamma') else None
        if gamma is not None and gamma == -2:  # -2 is the "not yet computed" indicator
            gamma = None
        vega = tickOptionComputationProto.vega if tickOptionComputationProto.HasField('vega') else None
        if vega is not None and vega == -2:  # -2 is the "not yet computed" indicator
            vega = None
        theta = tickOptionComputationProto.theta if tickOptionComputationProto.HasField('theta') else None
        if theta is not None and theta == -2:  # -2 is the "not yet computed" indicator
            theta = None
        undPrice = tickOptionComputationProto.undPrice if tickOptionComputationProto.HasField('undPrice') else None
        if undPrice is not None and undPrice == -1:  # -1 is the "not computed" indicator
            undPrice = None

        self.wrapper.tickOptionComputation(reqId, tickType, tickAttrib, impliedVol, delta, optPrice, pvDividend, gamma, vega, theta, undPrice)

    def processDeltaNeutralValidationMsg(self, fields):
        decode(int, fields)
        reqId = decode(int, fields)

        deltaNeutralContract = DeltaNeutralContract()

        deltaNeutralContract.conId = decode(int, fields)
        deltaNeutralContract.delta = decode(float, fields)
        deltaNeutralContract.price = decode(float, fields)

        self.wrapper.deltaNeutralValidation(reqId, deltaNeutralContract)

    def processMarketDataTypeMsg(self, fields):
        decode(int, fields)
        reqId = decode(int, fields)
        marketDataType = decode(int, fields)

        self.wrapper.marketDataType(reqId, marketDataType)

    def processMarketDataTypeMsgProtoBuf(self, protobuf):
        marketDataTypeProto = MarketDataTypeProto()
        marketDataTypeProto.ParseFromString(protobuf)

        self.wrapper.updateMarketDataTypeProtoBuf(marketDataTypeProto)

        reqId = marketDataTypeProto.reqId if marketDataTypeProto.HasField('reqId') else NO_VALID_ID
        marketDataType = marketDataTypeProto.marketDataType if marketDataTypeProto.HasField('marketDataType') else UNSET_INTEGER

        self.wrapper.marketDataType(reqId, marketDataType)

    def processCommissionAndFeesReportMsg(self, fields):
        decode(int, fields)

        commissionAndFeesReport = CommissionAndFeesReport()
        commissionAndFeesReport.execId = decode(str, fields)
        commissionAndFeesReport.commissionAndFees = decode(float, fields)
        commissionAndFeesReport.currency = decode(str, fields)
        commissionAndFeesReport.realizedPNL = decode(float, fields)
        commissionAndFeesReport.yield_ = decode(float, fields)
        commissionAndFeesReport.yieldRedemptionDate = decode(int, fields)

        self.wrapper.commissionAndFeesReport(commissionAndFeesReport)

    def processCommissionAndFeesReportMsgProtoBuf(self, protobuf):
        commissionAndFeesReportProto = CommissionAndFeesReportProto()
        commissionAndFeesReportProto.ParseFromString(protobuf)
    
        self.wrapper.commissionAndFeesReportProtoBuf(commissionAndFeesReportProto)
    
        commissionAndFeesReport = CommissionAndFeesReport()
        commissionAndFeesReport.execId = commissionAndFeesReportProto.execId if commissionAndFeesReportProto.HasField('execId') else ""
        commissionAndFeesReport.commissionAndFees = commissionAndFeesReportProto.commissionAndFees if commissionAndFeesReportProto.HasField('commissionAndFees') else 0.0
        commissionAndFeesReport.currency = commissionAndFeesReportProto.currency if commissionAndFeesReportProto.HasField('currency') else ""
        commissionAndFeesReport.realizedPNL = commissionAndFeesReportProto.realizedPNL if commissionAndFeesReportProto.HasField('realizedPNL') else 0.0
        commissionAndFeesReport.yield_ = commissionAndFeesReportProto.bondYield if commissionAndFeesReportProto.HasField('bondYield') else 0.0
        commissionAndFeesReport.yieldRedemptionDate = int(commissionAndFeesReportProto.yieldRedemptionDate) if commissionAndFeesReportProto.HasField('yieldRedemptionDate') else 0
    
        self.wrapper.commissionAndFeesReport(commissionAndFeesReport)

    def processPositionDataMsg(self, fields):
        version = decode(int, fields)

        account = decode(str, fields)

        # decode contract fields
        contract = Contract()
        contract.conId = decode(int, fields)
        contract.symbol = decode(str, fields)
        contract.secType = decode(str, fields)
        contract.lastTradeDateOrContractMonth = decode(str, fields)
        contract.strike = decode(float, fields)
        contract.right = decode(str, fields)
        contract.multiplier = decode(str, fields)
        contract.exchange = decode(str, fields)
        contract.currency = decode(str, fields)
        contract.localSymbol = decode(str, fields)
        if version >= 2:
            contract.tradingClass = decode(str, fields)

        position = decode(Decimal, fields)

        avgCost = 0.0
        if version >= 3:
            avgCost = decode(float, fields)

        self.wrapper.position(account, contract, position, avgCost)

    def processPositionMsgProtoBuf(self, protobuf):
        positionProto = PositionProto()
        positionProto.ParseFromString(protobuf)

        self.wrapper.positionProtoBuf(positionProto)

        # decode contract fields
        if not positionProto.HasField('contract'):
            return
        contract = decodeContract(positionProto.contract)

        position = Decimal(positionProto.position) if positionProto.HasField('position') else UNSET_DECIMAL
        avgCost = positionProto.avgCost if positionProto.HasField('avgCost') else 0
        account = positionProto.account if positionProto.HasField('account') else ""

        self.wrapper.position(account, contract, position, avgCost)

    def processPositionMultiMsg(self, fields):
        decode(int, fields)
        reqId = decode(int, fields)
        account = decode(str, fields)

        # decode contract fields
        contract = Contract()
        contract.conId = decode(int, fields)
        contract.symbol = decode(str, fields)
        contract.secType = decode(str, fields)
        contract.lastTradeDateOrContractMonth = decode(str, fields)
        contract.strike = decode(float, fields)
        contract.right = decode(str, fields)
        contract.multiplier = decode(str, fields)
        contract.exchange = decode(str, fields)
        contract.currency = decode(str, fields)
        contract.localSymbol = decode(str, fields)
        contract.tradingClass = decode(str, fields)
        position = decode(Decimal, fields)
        avgCost = decode(float, fields)
        modelCode = decode(str, fields)

        self.wrapper.positionMulti(
            reqId, account, modelCode, contract, position, avgCost
        )

    def processPositionMultiMsgProtoBuf(self, protobuf):
        positionMultiProto = PositionMultiProto()
        positionMultiProto.ParseFromString(protobuf)

        self.wrapper.positionMultiProtoBuf(positionMultiProto)

        reqId = positionMultiProto.reqId if positionMultiProto.HasField('reqId') else NO_VALID_ID
        account = positionMultiProto.account if positionMultiProto.HasField('account') else ""
        modelCode = positionMultiProto.modelCode if positionMultiProto.HasField('modelCode') else ""

        # decode contract fields
        if not positionMultiProto.HasField('contract'):
            return
        contract = decodeContract(positionMultiProto.contract)

        position = Decimal(positionMultiProto.position) if positionMultiProto.HasField('position') else UNSET_DECIMAL
        avgCost = positionMultiProto.avgCost if positionMultiProto.HasField('avgCost') else 0

        self.wrapper.positionMulti(reqId, account, modelCode, contract, position, avgCost)

    def processSecurityDefinitionOptionParameterMsg(self, fields):
        reqId = decode(int, fields)
        exchange = decode(str, fields)
        underlyingConId = decode(int, fields)
        tradingClass = decode(str, fields)
        multiplier = decode(str, fields)

        expCount = decode(int, fields)
        expirations = set()
        for _ in range(expCount):
            expiration = decode(str, fields)
            expirations.add(expiration)

        strikeCount = decode(int, fields)
        strikes = set()
        for _ in range(strikeCount):
            strike = decode(float, fields)
            strikes.add(strike)

        self.wrapper.securityDefinitionOptionParameter(
            reqId,
            exchange,
            underlyingConId,
            tradingClass,
            multiplier,
            expirations,
            strikes,
        )

    def processSecurityDefinitionOptionParameterMsgProtoBuf(self, protobuf):
        secDefOptParameterProto = SecDefOptParameterProto()
        secDefOptParameterProto.ParseFromString(protobuf)
    
        self.wrapper.secDefOptParameterProtoBuf(secDefOptParameterProto)
    
        reqId = secDefOptParameterProto.reqId if secDefOptParameterProto.HasField('reqId') else NO_VALID_ID
        exchange = secDefOptParameterProto.exchange if secDefOptParameterProto.HasField('exchange') else ""
        underlyingConId = secDefOptParameterProto.underlyingConId if secDefOptParameterProto.HasField('underlyingConId') else 0
        tradingClass = secDefOptParameterProto.tradingClass if secDefOptParameterProto.HasField('tradingClass') else ""
        multiplier = secDefOptParameterProto.multiplier if secDefOptParameterProto.HasField('multiplier') else ""
    
        expirations = set()
        if secDefOptParameterProto.expirations:
            for expiration in secDefOptParameterProto.expirations:
                expirations.add(expiration)
    
        strikes = set()
        if secDefOptParameterProto.strikes:
            for strike in secDefOptParameterProto.strikes:
                strikes.add(strike)
    
        self.wrapper.securityDefinitionOptionParameter(reqId, exchange, underlyingConId, tradingClass, multiplier, expirations, strikes)

    def processSecurityDefinitionOptionParameterEndMsg(self, fields):
        reqId = decode(int, fields)
        self.wrapper.securityDefinitionOptionParameterEnd(reqId)

    def processSecurityDefinitionOptionParameterEndMsgProtoBuf(self, protobuf):
        secDefOptParameterEndProto = SecDefOptParameterEndProto()
        secDefOptParameterEndProto.ParseFromString(protobuf)
    
        self.wrapper.secDefOptParameterEndProtoBuf(secDefOptParameterEndProto)
    
        reqId = secDefOptParameterEndProto.reqId if secDefOptParameterEndProto.HasField('reqId') else NO_VALID_ID
    
        self.wrapper.securityDefinitionOptionParameterEnd(reqId)

    def processSoftDollarTiersMsg(self, fields):
        reqId = decode(int, fields)
        nTiers = decode(int, fields)

        tiers = []
        for _ in range(nTiers):
            tier = SoftDollarTier()
            tier.name = decode(str, fields)
            tier.val = decode(str, fields)
            tier.displayName = decode(str, fields)
            tiers.append(tier)

        self.wrapper.softDollarTiers(reqId, tiers)

    def processSoftDollarTiersMsgProtoBuf(self, protobuf):
        softDollarTiersProto = SoftDollarTiersProto()
        softDollarTiersProto.ParseFromString(protobuf)
    
        self.wrapper.softDollarTiersProtoBuf(softDollarTiersProto)
    
        reqId = softDollarTiersProto.reqId if softDollarTiersProto.HasField('reqId') else NO_VALID_ID
    
        tiers = []
        if softDollarTiersProto.softDollarTiers:
            for softDollarTierProto in softDollarTiersProto.softDollarTiers:
                tier = decodeSoftDollarTier(softDollarTierProto)
                if tier is not None: tiers.append(tier);
    
        self.wrapper.softDollarTiers(reqId, tiers)

    def processFamilyCodesMsg(self, fields):
        nFamilyCodes = decode(int, fields)
        familyCodes = []
        for _ in range(nFamilyCodes):
            famCode = FamilyCode()
            famCode.accountID = decode(str, fields)
            famCode.familyCodeStr = decode(str, fields)
            familyCodes.append(famCode)

        self.wrapper.familyCodes(familyCodes)

    def processFamilyCodesMsgProtoBuf(self, protobuf):
        familyCodesProto = FamilyCodesProto()
        familyCodesProto.ParseFromString(protobuf)
    
        self.wrapper.familyCodesProtoBuf(familyCodesProto)
    
        familyCodes = []
        if familyCodesProto.familyCodes:
            for familCodeProto in familyCodesProto.familyCodes:
                familyCode = decodeFamilyCode(familCodeProto)
                familyCodes.append(familyCode)
    
        self.wrapper.familyCodes(familyCodes)

    def processSymbolSamplesMsg(self, fields):
        reqId = decode(int, fields)
        nContractDescriptions = decode(int, fields)
        contractDescriptions = []
        for _ in range(nContractDescriptions):
            conDesc = ContractDescription()
            conDesc.contract.conId = decode(int, fields)
            conDesc.contract.symbol = decode(str, fields)
            conDesc.contract.secType = decode(str, fields)
            conDesc.contract.primaryExchange = decode(str, fields)
            conDesc.contract.currency = decode(str, fields)

            nDerivativeSecTypes = decode(int, fields)
            conDesc.derivativeSecTypes = []
            for _ in range(nDerivativeSecTypes):
                derivSecType = decode(str, fields)
                conDesc.derivativeSecTypes.append(derivSecType)
            contractDescriptions.append(conDesc)

            if self.serverVersion >= MIN_SERVER_VER_BOND_ISSUERID:
                conDesc.contract.description = decode(str, fields)
                conDesc.contract.issuerId = decode(str, fields)

        self.wrapper.symbolSamples(reqId, contractDescriptions)


    def processSymbolSamplesMsgProtoBuf(self, protobuf):
        symbolSamplesProto = SymbolSamplesProto()
        symbolSamplesProto.ParseFromString(protobuf)
    
        self.wrapper.symbolSamplesProtoBuf(symbolSamplesProto)
    
        reqId = symbolSamplesProto.reqId if symbolSamplesProto.HasField('reqId') else NO_VALID_ID
    
        contractDescriptions = []
        if symbolSamplesProto.contractDescriptions:
            for contractDescriptionProto in symbolSamplesProto.contractDescriptions:
                contract = Contract()
                if contractDescriptionProto.HasField('contract'):
                    contract = decodeContract(contractDescriptionProto.contract)
            
                derivativeSecTypes = []
                if contractDescriptionProto.derivativeSecTypes:
                    for secType in contractDescriptionProto.derivativeSecTypes:
                        derivativeSecTypes.append(secType)
            
                contracrDescription = ContractDescription()
                contracrDescription.contract = contract
                contracrDescription.derivativeSecTypes = derivativeSecTypes

                contractDescriptions.append(contracrDescription)
    
        self.wrapper.symbolSamples(reqId, contractDescriptions)

    def processSmartComponents(self, fields):
        reqId = decode(int, fields)
        n = decode(int, fields)

        smartComponentMap = []
        for _ in range(n):
            smartComponent = SmartComponent()
            smartComponent.bitNumber = decode(int, fields)
            smartComponent.exchange = decode(str, fields)
            smartComponent.exchangeLetter = decode(str, fields)
            smartComponentMap.append(smartComponent)

        self.wrapper.smartComponents(reqId, smartComponentMap)

    def processSmartComponentsMsgProtoBuf(self, protobuf):
        smartComponentsProto = SmartComponentsProto()
        smartComponentsProto.ParseFromString(protobuf)
    
        self.wrapper.smartComponentsProtoBuf(smartComponentsProto)
    
        reqId = smartComponentsProto.reqId if smartComponentsProto.HasField('reqId') else NO_VALID_ID
    
        smartComponentsMap = []

        smartComponentsMap = decodeSmartComponents(smartComponentsProto)
    
        self.wrapper.smartComponents(reqId, smartComponentsMap)

    def processTickReqParams(self, fields):
        tickerId = decode(int, fields)
        minTick = decode(float, fields)
        bboExchange = decode(str, fields)
        snapshotPermissions = decode(int, fields)
        self.wrapper.tickReqParams(tickerId, minTick, bboExchange, snapshotPermissions)

    def processTickReqParamsMsgProtoBuf(self, protobuf):
        tickReqParamsProto = TickReqParamsProto()
        tickReqParamsProto.ParseFromString(protobuf)

        self.wrapper.tickReqParamsProtoBuf(tickReqParamsProto)

        reqId = tickReqParamsProto.reqId if tickReqParamsProto.HasField('reqId') else NO_VALID_ID
        minTick = float(tickReqParamsProto.minTick) if tickReqParamsProto.HasField('minTick') else UNSET_DOUBLE
        bboExchange = tickReqParamsProto.bboExchange if tickReqParamsProto.HasField('bboExchange') else ""
        snapshotPermissions = tickReqParamsProto.snapshotPermissions if tickReqParamsProto.HasField('snapshotPermissions') else UNSET_INTEGER

        self.wrapper.tickReqParams(reqId, minTick, bboExchange, snapshotPermissions)

    def processMktDepthExchanges(self, fields):
        depthMktDataDescriptions = []
        nDepthMktDataDescriptions = decode(int, fields)

        if nDepthMktDataDescriptions > 0:
            for _ in range(nDepthMktDataDescriptions):
                desc = DepthMktDataDescription()
                desc.exchange = decode(str, fields)
                desc.secType = decode(str, fields)
                if self.serverVersion >= MIN_SERVER_VER_SERVICE_DATA_TYPE:
                    desc.listingExch = decode(str, fields)
                    desc.serviceDataType = decode(str, fields)
                    desc.aggGroup = decode(int, fields)
                else:
                    decode(int, fields)  # boolean notSuppIsL2
                depthMktDataDescriptions.append(desc)

        self.wrapper.mktDepthExchanges(depthMktDataDescriptions)

    def processMktDepthExchangesMsgProtoBuf(self, protobuf):
        marketDepthExchangesProto = MarketDepthExchangesProto()
        marketDepthExchangesProto.ParseFromString(protobuf)
    
        self.wrapper.marketDepthExchangesProtoBuf(marketDepthExchangesProto)
    
        depthMktDataDescriptions = []
        if marketDepthExchangesProto.depthMarketDataDescriptions:
            for depthMarketDataDescriptionProto in marketDepthExchangesProto.depthMarketDataDescriptions:
                depthMktDataDescriptions.append(decodeDepthMarketDataDescription(depthMarketDataDescriptionProto))
    
        self.wrapper.mktDepthExchanges(depthMktDataDescriptions)

    def processHeadTimestamp(self, fields):
        reqId = decode(int, fields)
        headTimestamp = decode(str, fields)
        self.wrapper.headTimestamp(reqId, headTimestamp)

    def processHeadTimestampMsgProtoBuf(self, protobuf):
        headTimestampProto = HeadTimestampProto()
        headTimestampProto.ParseFromString(protobuf)

        self.wrapper.headTimestampProtoBuf(headTimestampProto)

        reqId = headTimestampProto.reqId if headTimestampProto.HasField('reqId') else NO_VALID_ID
        headTimestamp = headTimestampProto.headTimestamp if headTimestampProto.HasField('headTimestamp') else ""

        self.wrapper.headTimestamp(reqId, headTimestamp)

    def processTickNews(self, fields):
        tickerId = decode(int, fields)
        timeStamp = decode(int, fields)
        providerCode = decode(str, fields)
        articleId = decode(str, fields)
        headline = decode(str, fields)
        extraData = decode(str, fields)
        self.wrapper.tickNews(
            tickerId, timeStamp, providerCode, articleId, headline, extraData
        )

    def processTickNewsMsgProtoBuf(self, protobuf):
        tickNewsProto = TickNewsProto()
        tickNewsProto.ParseFromString(protobuf)

        self.wrapper.tickNewsProtoBuf(tickNewsProto)

        reqId = tickNewsProto.reqId if tickNewsProto.HasField('reqId') else NO_VALID_ID
        timestamp = tickNewsProto.timestamp if tickNewsProto.HasField('timestamp') else 0
        providerCode = tickNewsProto.providerCode if tickNewsProto.HasField('providerCode') else ""
        articleId = tickNewsProto.articleId if tickNewsProto.HasField('articleId') else ""
        headline = tickNewsProto.headline if tickNewsProto.HasField('headline') else ""
        extraData = tickNewsProto.extraData if tickNewsProto.HasField('extraData') else ""

        self.wrapper.tickNews(reqId, timestamp, providerCode, articleId, headline, extraData)

    def processNewsProviders(self, fields):
        newsProviders = []
        nNewsProviders = decode(int, fields)
        if nNewsProviders > 0:
            for _ in range(nNewsProviders):
                provider = NewsProvider()
                provider.code = decode(str, fields)
                provider.name = decode(str, fields)
                newsProviders.append(provider)

        self.wrapper.newsProviders(newsProviders)

    def processNewsProvidersMsgProtoBuf(self, protobuf):
        newsProvidersProto = NewsProvidersProto()
        newsProvidersProto.ParseFromString(protobuf)

        self.wrapper.newsProvidersProtoBuf(newsProvidersProto)

        newsProviders = []
        if newsProvidersProto.newsProviders:
            for newsProviderProto in newsProvidersProto.newsProviders:
                newsProvider = NewsProvider()
                newsProvider.code = newsProviderProto.providerCode if newsProviderProto.HasField('providerCode') else ""
                newsProvider.name = newsProviderProto.providerName if newsProviderProto.HasField('providerName') else ""
                newsProviders.append(newsProvider)

        self.wrapper.newsProviders(newsProviders)

    def processNewsArticle(self, fields):
        reqId = decode(int, fields)
        articleType = decode(int, fields)
        articleText = decode(str, fields)
        self.wrapper.newsArticle(reqId, articleType, articleText)

    def processNewsArticleMsgProtoBuf(self, protobuf):
        newsArticleProto = NewsArticleProto()
        newsArticleProto.ParseFromString(protobuf)

        self.wrapper.newsArticleProtoBuf(newsArticleProto)

        reqId = newsArticleProto.reqId if newsArticleProto.HasField('reqId') else NO_VALID_ID
        articleType = newsArticleProto.articleType if newsArticleProto.HasField('articleType') else 0
        articleText = newsArticleProto.articleText if newsArticleProto.HasField('articleText') else ""

        self.wrapper.newsArticle(reqId, articleType, articleText)

    def processHistoricalNews(self, fields):
        requestId = decode(int, fields)
        time = decode(str, fields)
        providerCode = decode(str, fields)
        articleId = decode(str, fields)
        headline = decode(str, fields)
        self.wrapper.historicalNews(requestId, time, providerCode, articleId, headline)

    def processHistoricalNewsMsgProtoBuf(self, protobuf):
        historicalNewsProto = HistoricalNewsProto()
        historicalNewsProto.ParseFromString(protobuf)

        self.wrapper.historicalNewsProtoBuf(historicalNewsProto)

        reqId = historicalNewsProto.reqId if historicalNewsProto.HasField('reqId') else NO_VALID_ID
        time = historicalNewsProto.time if historicalNewsProto.HasField('time') else ""
        providerCode = historicalNewsProto.providerCode if historicalNewsProto.HasField('providerCode') else ""
        articleId = historicalNewsProto.articleId if historicalNewsProto.HasField('articleId') else ""
        headline = historicalNewsProto.headline if historicalNewsProto.HasField('headline') else ""

        self.wrapper.historicalNews(reqId, time, providerCode, articleId, headline)

    def processHistoricalNewsEnd(self, fields):
        reqId = decode(int, fields)
        hasMore = decode(bool, fields)
        self.wrapper.historicalNewsEnd(reqId, hasMore)

    def processHistoricalNewsEndMsgProtoBuf(self, protobuf):
        historicalNewsEndProto = HistoricalNewsEndProto()
        historicalNewsEndProto.ParseFromString(protobuf)

        self.wrapper.historicalNewsEndProtoBuf(historicalNewsEndProto)

        reqId = historicalNewsEndProto.reqId if historicalNewsEndProto.HasField('reqId') else NO_VALID_ID
        hasMore = historicalNewsEndProto.hasMore if historicalNewsEndProto.HasField('hasMore') else False

        self.wrapper.historicalNewsEnd(reqId, hasMore)

    def processHistogramData(self, fields):
        reqId = decode(int, fields)
        numPoints = decode(int, fields)

        histogram = []
        for _ in range(numPoints):
            dataPoint = HistogramData()
            dataPoint.price = decode(float, fields)
            dataPoint.size = decode(Decimal, fields)
            histogram.append(dataPoint)

        self.wrapper.histogramData(reqId, histogram)

    def processHistogramDataMsgProtoBuf(self, protobuf):
        histogramDataProto = HistogramDataProto()
        histogramDataProto.ParseFromString(protobuf)

        self.wrapper.histogramDataProtoBuf(histogramDataProto)

        reqId = histogramDataProto.reqId if histogramDataProto.HasField('reqId') else NO_VALID_ID
    
        histogram = []
        if histogramDataProto.histogramDataEntries:
            for histogramDataEntryProto in histogramDataProto.histogramDataEntries:
                histogramEntry = decodeHistogramDataEntry(histogramDataEntryProto)
                histogram.append(histogramEntry)

        self.wrapper.histogramData(reqId, histogram)

    def processRerouteMktDataReq(self, fields):
        reqId = decode(int, fields)
        conId = decode(int, fields)
        exchange = decode(str, fields)

        self.wrapper.rerouteMktDataReq(reqId, conId, exchange)

    def processRerouteMktDataReqMsgProtoBuf(self, protobuf):
        rerouteMarketDataRequestProto = RerouteMarketDataRequestProto()
        rerouteMarketDataRequestProto.ParseFromString(protobuf)
    
        self.wrapper.rerouteMarketDataRequestProtoBuf(rerouteMarketDataRequestProto)
    
        reqId = rerouteMarketDataRequestProto.reqId if rerouteMarketDataRequestProto.HasField('reqId') else NO_VALID_ID
        conId = rerouteMarketDataRequestProto.conId if rerouteMarketDataRequestProto.HasField('conId') else 0
        exchange = rerouteMarketDataRequestProto.exchange if rerouteMarketDataRequestProto.HasField('exchange') else ""
    
        self.wrapper.rerouteMktDataReq(reqId, conId, exchange)

    def processRerouteMktDepthReq(self, fields):
        reqId = decode(int, fields)
        conId = decode(int, fields)
        exchange = decode(str, fields)

        self.wrapper.rerouteMktDepthReq(reqId, conId, exchange)

    def processRerouteMktDepthReqMsgProtoBuf(self, protobuf):
        rerouteMarketDepthRequestProto = RerouteMarketDepthRequestProto()
        rerouteMarketDepthRequestProto.ParseFromString(protobuf)
    
        self.wrapper.rerouteMarketDepthRequestProtoBuf(rerouteMarketDepthRequestProto)
    
        reqId = rerouteMarketDepthRequestProto.reqId if rerouteMarketDepthRequestProto.HasField('reqId') else NO_VALID_ID
        conId = rerouteMarketDepthRequestProto.conId if rerouteMarketDepthRequestProto.HasField('conId') else 0
        exchange = rerouteMarketDepthRequestProto.exchange if rerouteMarketDepthRequestProto.HasField('exchange') else ""
    
        self.wrapper.rerouteMktDepthReq(reqId, conId, exchange)

    def processMarketRuleMsg(self, fields):
        marketRuleId = decode(int, fields)

        nPriceIncrements = decode(int, fields)
        priceIncrements = []

        if nPriceIncrements > 0:
            for _ in range(nPriceIncrements):
                prcInc = PriceIncrement()
                prcInc.lowEdge = decode(float, fields)
                prcInc.increment = decode(float, fields)
                priceIncrements.append(prcInc)

        self.wrapper.marketRule(marketRuleId, priceIncrements)

    def processMarketRuleMsgProtoBuf(self, protobuf):
        marketRuleProto = MarketRuleProto()
        marketRuleProto.ParseFromString(protobuf)
    
        self.wrapper.marketRuleProtoBuf(marketRuleProto)
    
        marketRuleId = marketRuleProto.marketRuleId if marketRuleProto.HasField('marketRuleId') else 0
    
        priceIncrements = []
        if marketRuleProto.priceIncrements:
            for priceIncrementProto in marketRuleProto.priceIncrements:
                priceIncrement = decodePriceIncrement(priceIncrementProto)
                priceIncrements.append(priceIncrement)
    
        self.wrapper.marketRule(marketRuleId, priceIncrements)

    def processPnLMsg(self, fields):
        reqId = decode(int, fields)
        dailyPnL = decode(float, fields)
        unrealizedPnL = None
        realizedPnL = None

        if self.serverVersion >= MIN_SERVER_VER_UNREALIZED_PNL:
            unrealizedPnL = decode(float, fields)

        if self.serverVersion >= MIN_SERVER_VER_REALIZED_PNL:
            realizedPnL = decode(float, fields)

        self.wrapper.pnl(reqId, dailyPnL, unrealizedPnL, realizedPnL)

    def processPnLMsgProtoBuf(self, protobuf):
        pnlProto = PnLProto()
        pnlProto.ParseFromString(protobuf)

        self.wrapper.pnlProtoBuf(pnlProto)

        reqId = pnlProto.reqId if pnlProto.HasField('reqId') else NO_VALID_ID
        dailyPnL = pnlProto.dailyPnL if pnlProto.HasField('dailyPnL') else UNSET_DOUBLE
        unrealizedPnL = pnlProto.unrealizedPnL if pnlProto.HasField('unrealizedPnL') else UNSET_DOUBLE
        realizedPnL = pnlProto.realizedPnL if pnlProto.HasField('realizedPnL') else UNSET_DOUBLE

        self.wrapper.pnl(reqId, dailyPnL, unrealizedPnL, realizedPnL)

    def processPnLSingleMsg(self, fields):
        reqId = decode(int, fields)
        pos = decode(Decimal, fields)
        dailyPnL = decode(float, fields)
        unrealizedPnL = None
        realizedPnL = None

        if self.serverVersion >= MIN_SERVER_VER_UNREALIZED_PNL:
            unrealizedPnL = decode(float, fields)

        if self.serverVersion >= MIN_SERVER_VER_REALIZED_PNL:
            realizedPnL = decode(float, fields)

        value = decode(float, fields)

        self.wrapper.pnlSingle(reqId, pos, dailyPnL, unrealizedPnL, realizedPnL, value)

    def processPnLSingleMsgProtoBuf(self, protobuf):
        pnlSingleProto = PnLSingleProto()
        pnlSingleProto.ParseFromString(protobuf)

        self.wrapper.pnlSingleProtoBuf(pnlSingleProto)

        reqId = pnlSingleProto.reqId if pnlSingleProto.HasField('reqId') else NO_VALID_ID
        pos = Decimal(pnlSingleProto.position) if pnlSingleProto.HasField('position') else UNSET_DECIMAL
        dailyPnL = pnlSingleProto.dailyPnL if pnlSingleProto.HasField('dailyPnL') else UNSET_DOUBLE
        unrealizedPnL = pnlSingleProto.unrealizedPnL if pnlSingleProto.HasField('unrealizedPnL') else UNSET_DOUBLE
        realizedPnL = pnlSingleProto.realizedPnL if pnlSingleProto.HasField('realizedPnL') else UNSET_DOUBLE
        value = pnlSingleProto.value if pnlSingleProto.HasField('value') else UNSET_DOUBLE

        self.wrapper.pnlSingle(reqId, pos, dailyPnL, unrealizedPnL, realizedPnL, value)

    def processHistoricalTicks(self, fields):
        reqId = decode(int, fields)
        tickCount = decode(int, fields)

        ticks = []

        for _ in range(tickCount):
            historicalTick = HistoricalTick()
            historicalTick.time = decode(int, fields)
            next(fields)  # for consistency
            historicalTick.price = decode(float, fields)
            historicalTick.size = decode(Decimal, fields)
            ticks.append(historicalTick)

        done = decode(bool, fields)

        self.wrapper.historicalTicks(reqId, ticks, done)

    def processHistoricalTicksMsgProtoBuf(self, protobuf):
        historicalTicksProto = HistoricalTicksProto()
        historicalTicksProto.ParseFromString(protobuf)

        self.wrapper.historicalTicksProtoBuf(historicalTicksProto)

        reqId = historicalTicksProto.reqId if historicalTicksProto.HasField('reqId') else NO_VALID_ID
        isDone = historicalTicksProto.isDone if historicalTicksProto.HasField('isDone') else False
    
        historicalTicks = []
        if historicalTicksProto.historicalTicks:
            for historicalTickProto in historicalTicksProto.historicalTicks:
                historicalTick = decodeHistoricalTick(historicalTickProto)
                historicalTicks.append(historicalTick)

        self.wrapper.historicalTicks(reqId, historicalTicks, isDone)

    def processHistoricalTicksBidAsk(self, fields):
        reqId = decode(int, fields)
        tickCount = decode(int, fields)

        ticks = []

        for _ in range(tickCount):
            historicalTickBidAsk = HistoricalTickBidAsk()
            historicalTickBidAsk.time = decode(int, fields)
            mask = decode(int, fields)
            tickAttribBidAsk = TickAttribBidAsk()
            tickAttribBidAsk.askPastHigh = mask & 1 != 0
            tickAttribBidAsk.bidPastLow = mask & 2 != 0
            historicalTickBidAsk.tickAttribBidAsk = tickAttribBidAsk
            historicalTickBidAsk.priceBid = decode(float, fields)
            historicalTickBidAsk.priceAsk = decode(float, fields)
            historicalTickBidAsk.sizeBid = decode(Decimal, fields)
            historicalTickBidAsk.sizeAsk = decode(Decimal, fields)
            ticks.append(historicalTickBidAsk)

        done = decode(bool, fields)

        self.wrapper.historicalTicksBidAsk(reqId, ticks, done)

    def processHistoricalTicksBidAskMsgProtoBuf(self, protobuf):
        historicalTicksBidAskProto = HistoricalTicksBidAskProto()
        historicalTicksBidAskProto.ParseFromString(protobuf)

        self.wrapper.historicalTicksBidAskProtoBuf(historicalTicksBidAskProto)

        reqId = historicalTicksBidAskProto.reqId if historicalTicksBidAskProto.HasField('reqId') else NO_VALID_ID
        isDone = historicalTicksBidAskProto.isDone if historicalTicksBidAskProto.HasField('isDone') else False
    
        historicalTicksBidAsk = []
        if historicalTicksBidAskProto.historicalTicksBidAsk:
            for historicalTickBidAskProto in historicalTicksBidAskProto.historicalTicksBidAsk:
                historicalTickBidAsk = decodeHistoricalTickBidAsk(historicalTickBidAskProto)
                historicalTicksBidAsk.append(historicalTickBidAsk)

        self.wrapper.historicalTicksBidAsk(reqId, historicalTicksBidAsk, isDone)

    def processHistoricalTicksLast(self, fields):
        reqId = decode(int, fields)
        tickCount = decode(int, fields)

        ticks = []

        for _ in range(tickCount):
            historicalTickLast = HistoricalTickLast()
            historicalTickLast.time = decode(int, fields)
            mask = decode(int, fields)
            tickAttribLast = TickAttribLast()
            tickAttribLast.pastLimit = mask & 1 != 0
            tickAttribLast.unreported = mask & 2 != 0
            historicalTickLast.tickAttribLast = tickAttribLast
            historicalTickLast.price = decode(float, fields)
            historicalTickLast.size = decode(Decimal, fields)
            historicalTickLast.exchange = decode(str, fields)
            historicalTickLast.specialConditions = decode(str, fields)
            ticks.append(historicalTickLast)

        done = decode(bool, fields)

        self.wrapper.historicalTicksLast(reqId, ticks, done)

    def processHistoricalTicksLastMsgProtoBuf(self, protobuf):
        historicalTicksLastProto = HistoricalTicksLastProto()
        historicalTicksLastProto.ParseFromString(protobuf)

        self.wrapper.historicalTicksLastProtoBuf(historicalTicksLastProto)

        reqId = historicalTicksLastProto.reqId if historicalTicksLastProto.HasField('reqId') else NO_VALID_ID
        isDone = historicalTicksLastProto.isDone if historicalTicksLastProto.HasField('isDone') else False
    
        historicalTicksLast = []
        if historicalTicksLastProto.historicalTicksLast:
            for historicalTickLastProto in historicalTicksLastProto.historicalTicksLast:
                historicalTickLast = decodeHistoricalTickLast(historicalTickLastProto)
                historicalTicksLast.append(historicalTickLast)

        self.wrapper.historicalTicksLast(reqId, historicalTicksLast, isDone)

    def processTickByTickMsg(self, fields):
        reqId = decode(int, fields)
        tickType = decode(int, fields)
        time = decode(int, fields)

        if tickType == 0:
            # None
            pass
        elif tickType == 1 or tickType == 2:
            # Last or AllLast
            price = decode(float, fields)
            size = decode(Decimal, fields)
            mask = decode(int, fields)

            tickAttribLast = TickAttribLast()
            tickAttribLast.pastLimit = mask & 1 != 0
            tickAttribLast.unreported = mask & 2 != 0
            exchange = decode(str, fields)
            specialConditions = decode(str, fields)

            self.wrapper.tickByTickAllLast(
                reqId,
                tickType,
                time,
                price,
                size,
                tickAttribLast,
                exchange,
                specialConditions,
            )
        elif tickType == 3:
            # BidAsk
            bidPrice = decode(float, fields)
            askPrice = decode(float, fields)
            bidSize = decode(Decimal, fields)
            askSize = decode(Decimal, fields)
            mask = decode(int, fields)
            tickAttribBidAsk = TickAttribBidAsk()
            tickAttribBidAsk.bidPastLow = mask & 1 != 0
            tickAttribBidAsk.askPastHigh = mask & 2 != 0

            self.wrapper.tickByTickBidAsk(
                reqId, time, bidPrice, askPrice, bidSize, askSize, tickAttribBidAsk
            )
        elif tickType == 4:
            # MidPoint
            midPoint = decode(float, fields)

            self.wrapper.tickByTickMidPoint(reqId, time, midPoint)

    def processTickByTickMsgProtoBuf(self, protobuf):
        tickByTickDataProto = TickByTickDataProto()
        tickByTickDataProto.ParseFromString(protobuf)

        self.wrapper.tickByTickDataProtoBuf(tickByTickDataProto)

        reqId = tickByTickDataProto.reqId if tickByTickDataProto.HasField('reqId') else NO_VALID_ID
        tickType = tickByTickDataProto.tickType if tickByTickDataProto.HasField('tickType') else 0

        if tickType == 0:
            # None
            pass
        elif tickType == 1 or tickType == 2:
            # Last or AllLast
            if tickByTickDataProto.HasField('historicalTickLast'):
                historicalTickLast = decodeHistoricalTickLast(tickByTickDataProto.historicalTickLast)
                self.wrapper.tickByTickAllLast(
                    reqId,
                    tickType,
                    historicalTickLast.time,
                    historicalTickLast.price,
                    historicalTickLast.size,
                    historicalTickLast.tickAttribLast,
                    historicalTickLast.exchange,
                    historicalTickLast.specialConditions
                )
        elif tickType == 3:
            # BidAsk
            if tickByTickDataProto.HasField('historicalTickBidAsk'):
                historicalTickBidAsk = decodeHistoricalTickBidAsk(tickByTickDataProto.historicalTickBidAsk)
                self.wrapper.tickByTickBidAsk(
                    reqId,
                    historicalTickBidAsk.time,
                    historicalTickBidAsk.priceBid,
                    historicalTickBidAsk.priceAsk,
                    historicalTickBidAsk.sizeBid,
                    historicalTickBidAsk.sizeAsk,
                    historicalTickBidAsk.tickAttribBidAsk
                )
        elif tickType == 4:
            # MidPoint
            if tickByTickDataProto.HasField('historicalTickMidPoint'):
                historicalTick = decodeHistoricalTick(tickByTickDataProto.historicalTickMidPoint)
                self.wrapper.tickByTickMidPoint(reqId, historicalTick.time, historicalTick.price)

    def processOrderBoundMsg(self, fields):
        permId = decode(int, fields)
        clientId = decode(int, fields)
        orderId = decode(int, fields)

        self.wrapper.orderBound(permId, clientId, orderId)

    def processOrderBoundMsgProtoBuf(self, protobuf):
        orderBoundProto = OrderBoundProto()
        orderBoundProto.ParseFromString(protobuf)

        self.wrapper.orderBoundProtoBuf(orderBoundProto)

        permId = orderBoundProto.permId if orderBoundProto.HasField('permId') else UNSET_LONG
        clientId = orderBoundProto.clientId if orderBoundProto.HasField('clientId') else UNSET_INTEGER
        orderId = orderBoundProto.orderId if orderBoundProto.HasField('orderId') else UNSET_INTEGER

        self.wrapper.orderBound(permId, clientId, orderId)

    def processMarketDepthMsg(self, fields):
        decode(int, fields)
        reqId = decode(int, fields)

        position = decode(int, fields)
        operation = decode(int, fields)
        side = decode(int, fields)
        price = decode(float, fields)
        size = decode(Decimal, fields)

        self.wrapper.updateMktDepth(reqId, position, operation, side, price, size)

    def processMarketDepthMsgProtoBuf(self, protobuf):
        marketDepthProto = MarketDepthProto()
        marketDepthProto.ParseFromString(protobuf)

        self.wrapper.updateMarketDepthProtoBuf(marketDepthProto)

        reqId = marketDepthProto.reqId if marketDepthProto.HasField('reqId') else NO_VALID_ID

        # decode market depth fields
        if not marketDepthProto.HasField('marketDepthData'):
            return
        marketDepthDataProto = marketDepthProto.marketDepthData

        position = marketDepthDataProto.position if marketDepthDataProto.HasField('position') else UNSET_INTEGER
        operation = marketDepthDataProto.operation if marketDepthDataProto.HasField('operation') else UNSET_INTEGER
        side = marketDepthDataProto.side if marketDepthDataProto.HasField('side') else UNSET_INTEGER
        price = marketDepthDataProto.price if marketDepthDataProto.HasField('price') else UNSET_DOUBLE
        size = Decimal(marketDepthDataProto.size) if marketDepthDataProto.HasField('size') else UNSET_DECIMAL

        self.wrapper.updateMktDepth(reqId, position, operation, side, price, size)

    def processMarketDepthL2Msg(self, fields):
        decode(int, fields)
        reqId = decode(int, fields)

        position = decode(int, fields)
        marketMaker = decode(str, fields)
        operation = decode(int, fields)
        side = decode(int, fields)
        price = decode(float, fields)
        size = decode(Decimal, fields)
        isSmartDepth = False

        if self.serverVersion >= MIN_SERVER_VER_SMART_DEPTH:
            isSmartDepth = decode(bool, fields)

        self.wrapper.updateMktDepthL2(
            reqId, position, marketMaker, operation, side, price, size, isSmartDepth
        )

    def processMarketDepthL2MsgProtoBuf(self, protobuf):
        marketDepthL2Proto = MarketDepthL2Proto()
        marketDepthL2Proto.ParseFromString(protobuf)

        self.wrapper.updateMarketDepthL2ProtoBuf(marketDepthL2Proto)

        reqId = marketDepthL2Proto.reqId if marketDepthL2Proto.HasField('reqId') else NO_VALID_ID

        # decode market depth fields
        if not marketDepthL2Proto.HasField('marketDepthData'):
            return
        marketDepthDataProto = marketDepthL2Proto.marketDepthData

        position = marketDepthDataProto.position if marketDepthDataProto.HasField('position') else 0
        marketMaker = marketDepthDataProto.marketMaker if marketDepthDataProto.HasField('marketMaker') else ""
        operation = marketDepthDataProto.operation if marketDepthDataProto.HasField('operation') else UNSET_INTEGER
        side = marketDepthDataProto.side if marketDepthDataProto.HasField('side') else UNSET_INTEGER
        price = marketDepthDataProto.price if marketDepthDataProto.HasField('price') else UNSET_DOUBLE
        size = Decimal(marketDepthDataProto.size) if marketDepthDataProto.HasField('size') else UNSET_DECIMAL
        isSmartDepth = marketDepthDataProto.isSmartDepth if marketDepthDataProto.HasField('isSmartDepth') else False

        self.wrapper.updateMktDepthL2(reqId, position, marketMaker, operation, side, price, size, isSmartDepth)

    def processCompletedOrderMsg(self, fields):
        order = Order()
        contract = Contract()
        orderState = OrderState()

        OrderDecoder.__init__(
            self, contract, order, orderState, UNSET_INTEGER, self.serverVersion
        )

        # read contract fields
        OrderDecoder.decodeContractFields(self, fields)

        # read order fields
        OrderDecoder.decodeAction(self, fields)
        OrderDecoder.decodeTotalQuantity(self, fields)
        OrderDecoder.decodeOrderType(self, fields)
        OrderDecoder.decodeLmtPrice(self, fields)
        OrderDecoder.decodeAuxPrice(self, fields)
        OrderDecoder.decodeTIF(self, fields)
        OrderDecoder.decodeOcaGroup(self, fields)
        OrderDecoder.decodeAccount(self, fields)
        OrderDecoder.decodeOpenClose(self, fields)
        OrderDecoder.decodeOrigin(self, fields)
        OrderDecoder.decodeOrderRef(self, fields)
        OrderDecoder.decodePermId(self, fields)
        OrderDecoder.decodeOutsideRth(self, fields)
        OrderDecoder.decodeHidden(self, fields)
        OrderDecoder.decodeDiscretionaryAmt(self, fields)
        OrderDecoder.decodeGoodAfterTime(self, fields)
        OrderDecoder.decodeFAParams(self, fields)
        OrderDecoder.decodeModelCode(self, fields)
        OrderDecoder.decodeGoodTillDate(self, fields)
        OrderDecoder.decodeRule80A(self, fields)
        OrderDecoder.decodePercentOffset(self, fields)
        OrderDecoder.decodeSettlingFirm(self, fields)
        OrderDecoder.decodeShortSaleParams(self, fields)
        OrderDecoder.decodeBoxOrderParams(self, fields)
        OrderDecoder.decodePegToStkOrVolOrderParams(self, fields)
        OrderDecoder.decodeDisplaySize(self, fields)
        OrderDecoder.decodeSweepToFill(self, fields)
        OrderDecoder.decodeAllOrNone(self, fields)
        OrderDecoder.decodeMinQty(self, fields)
        OrderDecoder.decodeOcaType(self, fields)
        OrderDecoder.decodeTriggerMethod(self, fields)
        OrderDecoder.decodeVolOrderParams(self, fields, False)
        OrderDecoder.decodeTrailParams(self, fields)
        OrderDecoder.decodeComboLegs(self, fields)
        OrderDecoder.decodeSmartComboRoutingParams(self, fields)
        OrderDecoder.decodeScaleOrderParams(self, fields)
        OrderDecoder.decodeHedgeParams(self, fields)
        OrderDecoder.decodeClearingParams(self, fields)
        OrderDecoder.decodeNotHeld(self, fields)
        OrderDecoder.decodeDeltaNeutral(self, fields)
        OrderDecoder.decodeAlgoParams(self, fields)
        OrderDecoder.decodeSolicited(self, fields)
        OrderDecoder.decodeOrderStatus(self, fields)
        OrderDecoder.decodeVolRandomizeFlags(self, fields)
        OrderDecoder.decodePegToBenchParams(self, fields)
        OrderDecoder.decodeConditions(self, fields)
        OrderDecoder.decodeStopPriceAndLmtPriceOffset(self, fields)
        OrderDecoder.decodeCashQty(self, fields)
        OrderDecoder.decodeDontUseAutoPriceForHedge(self, fields)
        OrderDecoder.decodeIsOmsContainers(self, fields)
        OrderDecoder.decodeAutoCancelDate(self, fields)
        OrderDecoder.decodeFilledQuantity(self, fields)
        OrderDecoder.decodeRefFuturesConId(self, fields)
        OrderDecoder.decodeAutoCancelParent(self, fields)
        OrderDecoder.decodeShareholder(self, fields)
        OrderDecoder.decodeImbalanceOnly(self, fields)
        OrderDecoder.decodeRouteMarketableToBbo(self, fields)
        OrderDecoder.decodeParentPermId(self, fields)
        OrderDecoder.decodeCompletedTime(self, fields)
        OrderDecoder.decodeCompletedStatus(self, fields)
        OrderDecoder.decodePegBestPegMidOrderAttributes(self, fields)
        OrderDecoder.decodeCustomerAccount(self, fields)
        OrderDecoder.decodeProfessionalCustomer(self, fields)
        OrderDecoder.decodeSubmitter(self, fields)

        self.wrapper.completedOrder(contract, order, orderState)

    def processCompletedOrderMsgProtoBuf(self, protobuf):
        completedOrderProto = CompletedOrderProto()
        completedOrderProto.ParseFromString(protobuf)

        self.wrapper.completedOrderProtoBuf(completedOrderProto)

        # decode contract fields
        if not completedOrderProto.HasField('contract'):
            return
        contract = decodeContract(completedOrderProto.contract)

        # decode order fields
        if not completedOrderProto.HasField('order'):
            return
        order = decodeOrder(UNSET_INTEGER, completedOrderProto.contract, completedOrderProto.order)
        
        # decode order state fields
        if not completedOrderProto.HasField('orderState'):
            return
        orderState = decodeOrderState(completedOrderProto.orderState)

        self.wrapper.completedOrder(contract, order, orderState);

    def processCompletedOrdersEndMsg(self, fields):
        self.wrapper.completedOrdersEnd()

    def processCompletedOrdersEndMsgProtoBuf(self, protobuf):
        completedOrdersEndProto = CompletedOrdersEndProto()
        completedOrdersEndProto.ParseFromString(protobuf)

        self.wrapper.completedOrdersEndProtoBuf(completedOrdersEndProto)

        self.wrapper.completedOrdersEnd()

    def processReplaceFAEndMsg(self, fields):
        reqId = decode(int, fields)
        text = decode(str, fields)

        self.wrapper.replaceFAEnd(reqId, text)

    def processReplaceFAEndMsgProtoBuf(self, protobuf):
        replaceFAEndProto = ReplaceFAEndProto()
        replaceFAEndProto.ParseFromString(protobuf)
    
        self.wrapper.replaceFAEndProtoBuf(replaceFAEndProto)
    
        reqId = replaceFAEndProto.reqId if replaceFAEndProto.HasField('reqId') else NO_VALID_ID
        text = replaceFAEndProto.text if replaceFAEndProto.HasField('text') else ""
    
        self.wrapper.replaceFAEnd(reqId, text)

    def processWshMetaDataMsg(self, fields):
        reqId = decode(int, fields)
        dataJson = decode(str, fields)

        self.wrapper.wshMetaData(reqId, dataJson)

    def processWshMetaDataMsgProtoBuf(self, protobuf):
        wshMetaDataProto = WshMetaDataProto()
        wshMetaDataProto.ParseFromString(protobuf)

        self.wrapper.wshMetaDataProtoBuf(wshMetaDataProto)

        reqId = wshMetaDataProto.reqId if wshMetaDataProto.HasField('reqId') else NO_VALID_ID
        dataJson = wshMetaDataProto.dataJson if wshMetaDataProto.HasField('dataJson') else ""

        self.wrapper.wshMetaData(reqId, dataJson)

    def processWshEventDataMsg(self, fields):
        reqId = decode(int, fields)
        dataJson = decode(str, fields)

        self.wrapper.wshEventData(reqId, dataJson)

    def processWshEventDataMsgProtoBuf(self, protobuf):
        wshEventDataProto = WshEventDataProto()
        wshEventDataProto.ParseFromString(protobuf)

        self.wrapper.wshEventDataProtoBuf(wshEventDataProto)

        reqId = wshEventDataProto.reqId if wshEventDataProto.HasField('reqId') else NO_VALID_ID
        dataJson = wshEventDataProto.dataJson if wshEventDataProto.HasField('dataJson') else ""

        self.wrapper.wshEventData(reqId, dataJson)

    def processHistoricalSchedule(self, fields):
        reqId = decode(int, fields)
        startDateTime = decode(str, fields)
        endDateTime = decode(str, fields)
        timeZone = decode(str, fields)
        sessionsCount = decode(int, fields)

        sessions = []

        for _ in range(sessionsCount):
            historicalSession = HistoricalSession()
            historicalSession.startDateTime = decode(str, fields)
            historicalSession.endDateTime = decode(str, fields)
            historicalSession.refDate = decode(str, fields)
            sessions.append(historicalSession)

        self.wrapper.historicalSchedule(
            reqId, startDateTime, endDateTime, timeZone, sessions
        )

    def processHistoricalScheduleMsgProtoBuf(self, protobuf):
        historicalScheduleProto = HistoricalScheduleProto()
        historicalScheduleProto.ParseFromString(protobuf)
    
        self.wrapper.historicalScheduleProtoBuf(historicalScheduleProto)
    
        reqId = historicalScheduleProto.reqId if historicalScheduleProto.HasField('reqId') else NO_VALID_ID
        startDateTime = historicalScheduleProto.startDateTime if historicalScheduleProto.HasField('startDateTime') else ""
        endDateTime = historicalScheduleProto.endDateTime if historicalScheduleProto.HasField('endDateTime') else ""
        timeZone = historicalScheduleProto.timeZone if historicalScheduleProto.HasField('timeZone') else ""
    
        sessions = []
        if historicalScheduleProto.historicalSessions:
            for historicalSessionProto in historicalScheduleProto.historicalSessions:
                historicalSession = HistoricalSession()
                historicalSession.startDateTime = historicalSessionProto.startDateTime if historicalSessionProto.HasField('startDateTime') else ""
                historicalSession.endDateTime = historicalSessionProto.endDateTime if historicalSessionProto.HasField('endDateTime') else ""
                historicalSession.refDate = historicalSessionProto.refDate if historicalSessionProto.HasField('refDate') else ""
                sessions.append(historicalSession)
    
        self.wrapper.historicalSchedule(reqId, startDateTime, endDateTime, timeZone, sessions)

    def processUserInfo(self, fields):
        reqId = decode(int, fields)
        whiteBrandingId = decode(str, fields)

        self.wrapper.userInfo(reqId, whiteBrandingId)

    def processUserInfoMsgProtoBuf(self, protobuf):
        userInfoProto = UserInfoProto()
        userInfoProto.ParseFromString(protobuf)
    
        self.wrapper.userInfoProtoBuf(userInfoProto)
    
        reqId = userInfoProto.reqId if userInfoProto.HasField('reqId') else NO_VALID_ID
        whiteBrandingId = userInfoProto.whiteBrandingId if userInfoProto.HasField('whiteBrandingId') else ""
    
        self.wrapper.userInfo(reqId, whiteBrandingId)

    def processCurrentTimeInMillis(self, fields):
        timeInMillis = decode(int, fields)

        self.wrapper.currentTimeInMillis(timeInMillis)

    def processCurrentTimeInMillisMsgProtoBuf(self, protobuf):
        currentTimeInMillisProto = CurrentTimeInMillisProto()
        currentTimeInMillisProto.ParseFromString(protobuf)
    
        self.wrapper.currentTimeInMillisProtoBuf(currentTimeInMillisProto)
    
        timeInMillis = currentTimeInMillisProto.currentTimeInMillis if currentTimeInMillisProto.HasField('currentTimeInMillis') else 0
    
        self.wrapper.currentTimeInMillis(timeInMillis)

    def processErrorMsg(self, fields):
        if self.serverVersion < MIN_SERVER_VER_ERROR_TIME:
            decode(int, fields)
        reqId = decode(TickerId, fields)
        errorCode = decode(int, fields)
        errorString = decode(
            str, fields, False, self.serverVersion >= MIN_SERVER_VER_ENCODE_MSG_ASCII7
        )
        advancedOrderRejectJson = ""
        if self.serverVersion >= MIN_SERVER_VER_ADVANCED_ORDER_REJECT:
            advancedOrderRejectJson = decode(str, fields, False, True)
        errorTime = 0
        if self.serverVersion >= MIN_SERVER_VER_ERROR_TIME:
            errorTime = decode(int, fields)

        self.wrapper.error(reqId, errorTime, errorCode, errorString, advancedOrderRejectJson)

    def processErrorMsgProtoBuf(self, protobuf):
        errorMessageProto = ErrorMessageProto()
        errorMessageProto.ParseFromString(protobuf)

        self.wrapper.errorProtoBuf(errorMessageProto)

        reqId = errorMessageProto.id if errorMessageProto.HasField('id') else 0
        errorCode = errorMessageProto.errorCode if errorMessageProto.HasField('errorCode') else 0
        errorMsg = errorMessageProto.errorMsg if errorMessageProto.HasField('errorMsg') else ""
        advancedOrderRejectJson = errorMessageProto.advancedOrderRejectJson if errorMessageProto.HasField('advancedOrderRejectJson') else ""
        errorTime = errorMessageProto.errorTime if errorMessageProto.HasField('errorTime') else 0

        self.wrapper.error(reqId, errorTime, errorCode, errorMsg, advancedOrderRejectJson)

    def processTickStringMsgProtoBuf(self, protobuf):
        tickStringProto = TickStringProto()
        tickStringProto.ParseFromString(protobuf)

        self.wrapper.tickStringProtoBuf(tickStringProto)

        reqId = tickStringProto.reqId if tickStringProto.HasField('reqId') else NO_VALID_ID
        tickType = tickStringProto.tickType if tickStringProto.HasField('tickType') else UNSET_INTEGER
        value = tickStringProto.value if tickStringProto.HasField('value') else ""

        if tickType != TickTypeEnum.NOT_SET:
            self.wrapper.tickString(reqId, tickType, value)

    def processTickGenericMsgProtoBuf(self, protobuf):
        tickGenericProto = TickGenericProto()
        tickGenericProto.ParseFromString(protobuf)

        self.wrapper.tickGenericProtoBuf(tickGenericProto)

        reqId = tickGenericProto.reqId if tickGenericProto.HasField('reqId') else NO_VALID_ID
        tickType = tickGenericProto.tickType if tickGenericProto.HasField('tickType') else UNSET_INTEGER
        value = tickGenericProto.value if tickGenericProto.HasField('value') else UNSET_DOUBLE

        if tickType != TickTypeEnum.NOT_SET:
            self.wrapper.tickGeneric(reqId, tickType, value)

    def processTickSnapshotEndMsgProtoBuf(self, protobuf):
        tickSnapshotEndProto = TickSnapshotEndProto()
        tickSnapshotEndProto.ParseFromString(protobuf)

        self.wrapper.tickSnapshotEndProtoBuf(tickSnapshotEndProto)

        reqId = tickSnapshotEndProto.reqId if tickSnapshotEndProto.HasField('reqId') else NO_VALID_ID

        self.wrapper.tickSnapshotEnd(reqId)

    def processAccountValueMsgProtoBuf(self, protobuf):
        accountValueProto = AccountValueProto()
        accountValueProto.ParseFromString(protobuf)

        self.wrapper.updateAccountValueProtoBuf(accountValueProto)

        key = accountValueProto.key if accountValueProto.HasField('key') else ""
        value = accountValueProto.value if accountValueProto.HasField('value') else ""
        currency = accountValueProto.currency if accountValueProto.HasField('currency') else ""
        accountName = accountValueProto.accountName if accountValueProto.HasField('accountName') else ""

        self.wrapper.updateAccountValue(key, value, currency, accountName)

    def processAcctUpdateTimeMsgProtoBuf(self, protobuf):
        accountUpdateTimeProto = AccountUpdateTimeProto()
        accountUpdateTimeProto.ParseFromString(protobuf)

        self.wrapper.updateAccountTimeProtoBuf(accountUpdateTimeProto)

        timeStamp = accountUpdateTimeProto.timeStamp if accountUpdateTimeProto.HasField('timeStamp') else ""

        self.wrapper.updateAccountTime(timeStamp)

    def processAccountDataEndMsgProtoBuf(self, protobuf):
        accountDataEndProto = AccountDataEndProto()
        accountDataEndProto.ParseFromString(protobuf)

        self.wrapper.accountDataEndProtoBuf(accountDataEndProto)

        accountName = accountDataEndProto.accountName if accountDataEndProto.HasField('accountName') else ""

        self.wrapper.accountDownloadEnd(accountName)

    def processManagedAccountsMsgProtoBuf(self, protobuf):
        managedAccountsProto = ManagedAccountsProto()
        managedAccountsProto.ParseFromString(protobuf)

        self.wrapper.managedAccountsProtoBuf(managedAccountsProto)

        accountsList = managedAccountsProto.accountsList if managedAccountsProto.HasField('accountsList') else ""

        self.wrapper.managedAccounts(accountsList)

    def processPositionEndMsgProtoBuf(self, protobuf):
        positionEndProto = PositionEndProto()
        positionEndProto.ParseFromString(protobuf)

        self.wrapper.positionEndProtoBuf(positionEndProto)

        self.wrapper.positionEnd()

    def processAccountSummaryMsgProtoBuf(self, protobuf):
        accountSummaryProto = AccountSummaryProto()
        accountSummaryProto.ParseFromString(protobuf)

        self.wrapper.accountSummaryProtoBuf(accountSummaryProto)

        reqId = accountSummaryProto.reqId if accountSummaryProto.HasField('reqId') else NO_VALID_ID
        account = accountSummaryProto.account if accountSummaryProto.HasField('account') else ""
        tag = accountSummaryProto.tag if accountSummaryProto.HasField('tag') else ""
        value = accountSummaryProto.value if accountSummaryProto.HasField('value') else ""
        currency = accountSummaryProto.currency if accountSummaryProto.HasField('currency') else ""

        self.wrapper.accountSummary(reqId, account, tag, value, currency)

    def processAccountSummaryEndMsgProtoBuf(self, protobuf):
        accountSummaryEndProto = AccountSummaryEndProto()
        accountSummaryEndProto.ParseFromString(protobuf)

        self.wrapper.accountSummaryEndProtoBuf(accountSummaryEndProto)

        reqId = accountSummaryEndProto.reqId if accountSummaryEndProto.HasField('reqId') else NO_VALID_ID

        self.wrapper.accountSummaryEnd(reqId)

    def processPositionMultiEndMsgProtoBuf(self, protobuf):
        positionMultiEndProto = PositionMultiEndProto()
        positionMultiEndProto.ParseFromString(protobuf)

        self.wrapper.positionMultiEndProtoBuf(positionMultiEndProto)

        reqId = positionMultiEndProto.reqId if positionMultiEndProto.HasField('reqId') else NO_VALID_ID

        self.wrapper.positionMultiEnd(reqId)

    def processAccountUpdateMultiMsgProtoBuf(self, protobuf):
        accountUpdateMultiProto = AccountUpdateMultiProto()
        accountUpdateMultiProto.ParseFromString(protobuf)

        self.wrapper.accountUpdateMultiProtoBuf(accountUpdateMultiProto)

        reqId = accountUpdateMultiProto.reqId if accountUpdateMultiProto.HasField('reqId') else NO_VALID_ID
        account = accountUpdateMultiProto.account if accountUpdateMultiProto.HasField('account') else ""
        modelCode = accountUpdateMultiProto.modelCode if accountUpdateMultiProto.HasField('modelCode') else ""
        key = accountUpdateMultiProto.key if accountUpdateMultiProto.HasField('key') else ""
        value = accountUpdateMultiProto.value if accountUpdateMultiProto.HasField('value') else ""
        currency = accountUpdateMultiProto.currency if accountUpdateMultiProto.HasField('currency') else ""

        self.wrapper.accountUpdateMulti(reqId, account, modelCode, key, value, currency)

    def processAccountUpdateMultiEndMsgProtoBuf(self, protobuf):
        accountUpdateMultiEndProto = AccountUpdateMultiEndProto()
        accountUpdateMultiEndProto.ParseFromString(protobuf)

        self.wrapper.accountUpdateMultiEndProtoBuf(accountUpdateMultiEndProto)

        reqId = accountUpdateMultiEndProto.reqId if accountUpdateMultiEndProto.HasField('reqId') else NO_VALID_ID

        self.wrapper.accountUpdateMultiEnd(reqId)

    def processNewsBulletinMsgProtoBuf(self, protobuf):
        newsBulletinProto = NewsBulletinProto()
        newsBulletinProto.ParseFromString(protobuf)

        self.wrapper.updateNewsBulletinProtoBuf(newsBulletinProto)

        msgId = newsBulletinProto.newsMsgId if newsBulletinProto.HasField('newsMsgId') else 0
        msgType = newsBulletinProto.newsMsgType if newsBulletinProto.HasField('newsMsgType') else 0
        message = newsBulletinProto.newsMessage if newsBulletinProto.HasField('newsMessage') else ""
        originExch = newsBulletinProto.originatingExch if newsBulletinProto.HasField('originatingExch') else ""

        self.wrapper.updateNewsBulletin(msgId, msgType, message, originExch)

    def processScannerParametersMsgProtoBuf(self, protobuf):
        scannerParametersProto = ScannerParametersProto()
        scannerParametersProto.ParseFromString(protobuf)

        self.wrapper.scannerParametersProtoBuf(scannerParametersProto)

        xml = scannerParametersProto.xml if scannerParametersProto.HasField('xml') else ""

        self.wrapper.scannerParameters(xml)

    def processFundamentalsDataMsgProtoBuf(self, protobuf):
        fundamentalsDataProto = FundamentalsDataProto()
        fundamentalsDataProto.ParseFromString(protobuf)

        self.wrapper.fundamentalsDataProtoBuf(fundamentalsDataProto)

        reqId = fundamentalsDataProto.reqId if fundamentalsDataProto.HasField('reqId') else NO_VALID_ID
        data = fundamentalsDataProto.data if fundamentalsDataProto.HasField('data') else ""

        self.wrapper.fundamentalData(reqId, data)

    def processReceiveFAMsgProtoBuf(self, protobuf):
        receiveFAProto = ReceiveFAProto()
        receiveFAProto.ParseFromString(protobuf)
    
        self.wrapper.receiveFAProtoBuf(receiveFAProto)
    
        faDataType = receiveFAProto.faDataType if receiveFAProto.HasField('faDataType') else 0
        xml = receiveFAProto.xml if receiveFAProto.HasField('xml') else ""
    
        self.wrapper.receiveFA(faDataType, xml)

    def processNextValidIdMsgProtoBuf(self, protobuf):
        nextValidIdProto = NextValidIdProto()
        nextValidIdProto.ParseFromString(protobuf)
    
        self.wrapper.nextValidIdProtoBuf(nextValidIdProto)
    
        orderId = nextValidIdProto.orderId if nextValidIdProto.HasField('orderId') else 0
    
        self.wrapper.nextValidId(orderId)

    def processCurrentTimeMsgProtoBuf(self, protobuf):
        currentTimeProto = CurrentTimeProto()
        currentTimeProto.ParseFromString(protobuf)
    
        self.wrapper.currentTimeProtoBuf(currentTimeProto)
    
        time = currentTimeProto.currentTime if currentTimeProto.HasField('currentTime') else 0
    
        self.wrapper.currentTime(time)

    def processVerifyMessageApiMsgProtoBuf(self, protobuf):
        verifyMessageApiProto = VerifyMessageApiProto()
        verifyMessageApiProto.ParseFromString(protobuf)
    
        self.wrapper.verifyMessageApiProtoBuf(verifyMessageApiProto)
    
        apiData = verifyMessageApiProto.apiData if verifyMessageApiProto.HasField('apiData') else ""
    
        self.wrapper.verifyMessageAPI(apiData)

    def processVerifyCompletedMsgProtoBuf(self, protobuf):
        verifyCompletedProto = VerifyCompletedProto()
        verifyCompletedProto.ParseFromString(protobuf)
    
        self.wrapper.verifyCompletedProtoBuf(verifyCompletedProto)
    
        isSuccessful = verifyCompletedProto.isSuccessful if verifyCompletedProto.HasField('isSuccessful') else False
        errorText = verifyCompletedProto.errorText if verifyCompletedProto.HasField('errorText') else ""
    
        self.wrapper.verifyCompleted(isSuccessful, errorText)

    def processDisplayGroupListMsgProtoBuf(self, protobuf):
        displayGroupListProto = DisplayGroupListProto()
        displayGroupListProto.ParseFromString(protobuf)
    
        self.wrapper.displayGroupListProtoBuf(displayGroupListProto)
    
        reqId = displayGroupListProto.reqId if displayGroupListProto.HasField('reqId') else NO_VALID_ID
        groups = displayGroupListProto.groups if displayGroupListProto.HasField('groups') else ""
    
        self.wrapper.displayGroupList(reqId, groups)

    def processDisplayGroupUpdatedMsgProtoBuf(self, protobuf):
        displayGroupUpdatedProto = DisplayGroupUpdatedProto()
        displayGroupUpdatedProto.ParseFromString(protobuf)
    
        self.wrapper.displayGroupUpdatedProtoBuf(displayGroupUpdatedProto)
    
        reqId = displayGroupUpdatedProto.reqId if displayGroupUpdatedProto.HasField('reqId') else NO_VALID_ID
        contractInfo = displayGroupUpdatedProto.contractInfo if displayGroupUpdatedProto.HasField('contractInfo') else ""
    
        self.wrapper.displayGroupUpdated(reqId, contractInfo)

    def processConfigResponseProtoBuf(self, protobuf):
        configResponseProto = ConfigResponseProto()
        configResponseProto.ParseFromString(protobuf)
    
        self.wrapper.configResponseProtoBuf(configResponseProto)

    def processUpdateConfigResponseProtoBuf(self, protobuf):
        updateConfigResponseProto = UpdateConfigResponseProto()
        updateConfigResponseProto.ParseFromString(protobuf)
    
        self.wrapper.updateConfigResponseProtoBuf(updateConfigResponseProto)
    
    ######################################################################

    def readLastTradeDate(self, fields, contract: ContractDetails, isBond: bool):
        lastTradeDateOrContractMonth = decode(str, fields)
        setLastTradeDate(lastTradeDateOrContractMonth, contract, isBond)

    ######################################################################

    def discoverParams(self):
        meth2handleInfo = {}
        for handleInfo in self.msgId2handleInfo.values():
            meth2handleInfo[handleInfo.wrapperMeth] = handleInfo

        methods = inspect.getmembers(EWrapper, inspect.isfunction)
        for _, meth in methods:
            # logger.debug("meth %s", name)
            sig = inspect.signature(meth)
            handleInfo = meth2handleInfo.get(meth, None)
            if handleInfo is not None:
                handleInfo.wrapperParams = sig.parameters

            # for (pname, param) in sig.parameters.items():
            #     logger.debug("\tparam %s %s %s", pname, param.name, param.annotation)

    def printParams(self):
        for _, handleInfo in self.msgId2handleInfo.items():
            if handleInfo.wrapperMeth is not None:
                logger.debug("meth %s", handleInfo.wrapperMeth.__name__)
                if handleInfo.wrapperParams is not None:
                    for pname, param in handleInfo.wrapperParams.items():
                        logger.debug(
                            "\tparam %s %s %s", pname, param.name, param.annotation
                        )

    def interpretWithSignature(self, fields, handleInfo):
        if handleInfo.wrapperParams is None:
            logger.debug("%s: no param info in %s", fields, handleInfo)
            return

        nIgnoreFields = 1  # bypass msgId faster this way
        if len(fields) - nIgnoreFields != len(handleInfo.wrapperParams) - 1:
            logger.error(
                "diff len fields and params %d %d for fields: %s and handleInfo: %s",
                len(fields),
                len(handleInfo.wrapperParams),
                fields,
                handleInfo,
            )
            return

        fieldIdx = nIgnoreFields
        args = []
        for pname, param in handleInfo.wrapperParams.items():
            if pname != "self":
                logger.debug("field %s ", fields[fieldIdx])
                try:
                    arg = fields[fieldIdx].decode(
                        "unicode-escape"
                        if self.serverVersion >= MIN_SERVER_VER_ENCODE_MSG_ASCII7
                        else "UTF-8"
                    )
                except UnicodeDecodeError:
                    arg = fields[fieldIdx].decode("latin-1")
                logger.debug("arg %s type %s", arg, param.annotation)
                if param.annotation is int:
                    arg = int(arg)
                elif param.annotation is float:
                    arg = float(arg)
                elif param.annotation is Decimal:
                    if arg is None or len(arg) == 0:
                        return UNSET_DECIMAL
                    else:
                        return Decimal(arg)

                args.append(arg)
                fieldIdx += 1

        method = getattr(self.wrapper, handleInfo.wrapperMeth.__name__)
        logger.debug("calling %s with %s %s", method, self.wrapper, args)
        method(*args)

    def interpret(self, fields, msgId):
        if msgId == 0:
            logger.debug("Unset message id:%d", msgId)
            return

        handleInfo = self.msgId2handleInfo.get(msgId, None)

        if handleInfo is None:
            logger.debug("msgId:%d - %s: no handleInfo", fields)
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), UNKNOWN_ID.code(), UNKNOWN_ID.msg())
            return

        try:
            if handleInfo.wrapperMeth is not None:
                logger.debug("In interpret(), handleInfo: %s", handleInfo)
                self.interpretWithSignature(fields, handleInfo)
            elif handleInfo.processMeth is not None:
                handleInfo.processMeth(self, iter(fields))
        except BadMessage:
            theBadMsg = ",".join(fields)
            self.wrapper.error(
                NO_VALID_ID, currentTimeMillis(), BAD_MESSAGE.code(), BAD_MESSAGE.msg() + theBadMsg
            )
            raise

    def processProtoBuf(self, protoBuf, msgId):
        if msgId == 0:
            logger.debug("Unset message id:%d", msgId)
            return

        handleInfo = self.msgId2handleInfoProtoBuf.get(msgId, None)

        if handleInfo is None:
            logger.debug("msgId:%d - %s: no handleInfo for protobuf", msgId, protoBuf)
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), UNKNOWN_ID.code(), UNKNOWN_ID.msg())
            return

        try:
            if handleInfo.processMeth is not None:
                handleInfo.processMeth(self, protoBuf)
        except BadMessage:
            theBadMsg = repr(protoBuf)
            self.wrapper.error(
                NO_VALID_ID, currentTimeMillis(), BAD_MESSAGE.code(), BAD_MESSAGE.msg() + theBadMsg
            )
            raise

    msgId2handleInfo = {
        IN.TICK_PRICE: HandleInfo(proc=processTickPriceMsg),
        IN.TICK_SIZE: HandleInfo(proc=processTickSizeMsg),
        IN.ORDER_STATUS: HandleInfo(proc=processOrderStatusMsg),
        IN.ERR_MSG: HandleInfo(proc=processErrorMsg),
        IN.OPEN_ORDER: HandleInfo(proc=processOpenOrder),
        IN.ACCT_VALUE: HandleInfo(wrap=EWrapper.updateAccountValue),
        IN.PORTFOLIO_VALUE: HandleInfo(proc=processPortfolioValueMsg),
        IN.ACCT_UPDATE_TIME: HandleInfo(wrap=EWrapper.updateAccountTime),
        IN.NEXT_VALID_ID: HandleInfo(
            wrap=EWrapper.nextValidId,
        ),
        IN.CONTRACT_DATA: HandleInfo(proc=processContractDataMsg),
        IN.EXECUTION_DATA: HandleInfo(proc=processExecutionDataMsg),
        IN.MARKET_DEPTH: HandleInfo(proc=processMarketDepthMsg),
        IN.MARKET_DEPTH_L2: HandleInfo(proc=processMarketDepthL2Msg),
        IN.NEWS_BULLETINS: HandleInfo(wrap=EWrapper.updateNewsBulletin),
        IN.MANAGED_ACCTS: HandleInfo(wrap=EWrapper.managedAccounts),
        IN.RECEIVE_FA: HandleInfo(wrap=EWrapper.receiveFA),
        IN.HISTORICAL_DATA: HandleInfo(proc=processHistoricalDataMsg),
        IN.HISTORICAL_DATA_UPDATE: HandleInfo(proc=processHistoricalDataUpdateMsg),
        IN.BOND_CONTRACT_DATA: HandleInfo(proc=processBondContractDataMsg),
        IN.SCANNER_PARAMETERS: HandleInfo(wrap=EWrapper.scannerParameters),
        IN.SCANNER_DATA: HandleInfo(proc=processScannerDataMsg),
        IN.TICK_OPTION_COMPUTATION: HandleInfo(proc=processTickOptionComputationMsg),
        IN.TICK_GENERIC: HandleInfo(wrap=EWrapper.tickGeneric),
        IN.TICK_STRING: HandleInfo(wrap=EWrapper.tickString),
        IN.TICK_EFP: HandleInfo(wrap=EWrapper.tickEFP),
        IN.CURRENT_TIME: HandleInfo(wrap=EWrapper.currentTime),
        IN.REAL_TIME_BARS: HandleInfo(proc=processRealTimeBarMsg),
        IN.FUNDAMENTAL_DATA: HandleInfo(wrap=EWrapper.fundamentalData),
        IN.CONTRACT_DATA_END: HandleInfo(wrap=EWrapper.contractDetailsEnd),
        IN.OPEN_ORDER_END: HandleInfo(wrap=EWrapper.openOrderEnd),
        IN.ACCT_DOWNLOAD_END: HandleInfo(wrap=EWrapper.accountDownloadEnd),
        IN.EXECUTION_DATA_END: HandleInfo(wrap=EWrapper.execDetailsEnd),
        IN.DELTA_NEUTRAL_VALIDATION: HandleInfo(proc=processDeltaNeutralValidationMsg),
        IN.TICK_SNAPSHOT_END: HandleInfo(wrap=EWrapper.tickSnapshotEnd),
        IN.MARKET_DATA_TYPE: HandleInfo(wrap=EWrapper.marketDataType),
        IN.COMMISSION_AND_FEES_REPORT: HandleInfo(proc=processCommissionAndFeesReportMsg),
        IN.POSITION_DATA: HandleInfo(proc=processPositionDataMsg),
        IN.POSITION_END: HandleInfo(wrap=EWrapper.positionEnd),
        IN.ACCOUNT_SUMMARY: HandleInfo(wrap=EWrapper.accountSummary),
        IN.ACCOUNT_SUMMARY_END: HandleInfo(wrap=EWrapper.accountSummaryEnd),
        IN.VERIFY_MESSAGE_API: HandleInfo(wrap=EWrapper.verifyMessageAPI),
        IN.VERIFY_COMPLETED: HandleInfo(wrap=EWrapper.verifyCompleted),
        IN.DISPLAY_GROUP_LIST: HandleInfo(wrap=EWrapper.displayGroupList),
        IN.DISPLAY_GROUP_UPDATED: HandleInfo(wrap=EWrapper.displayGroupUpdated),
        IN.VERIFY_AND_AUTH_MESSAGE_API: HandleInfo(
            wrap=EWrapper.verifyAndAuthMessageAPI
        ),
        IN.VERIFY_AND_AUTH_COMPLETED: HandleInfo(wrap=EWrapper.verifyAndAuthCompleted),
        IN.POSITION_MULTI: HandleInfo(proc=processPositionMultiMsg),
        IN.POSITION_MULTI_END: HandleInfo(wrap=EWrapper.positionMultiEnd),
        IN.ACCOUNT_UPDATE_MULTI: HandleInfo(wrap=EWrapper.accountUpdateMulti),
        IN.ACCOUNT_UPDATE_MULTI_END: HandleInfo(wrap=EWrapper.accountUpdateMultiEnd),
        IN.SECURITY_DEFINITION_OPTION_PARAMETER: HandleInfo(
            proc=processSecurityDefinitionOptionParameterMsg
        ),
        IN.SECURITY_DEFINITION_OPTION_PARAMETER_END: HandleInfo(
            proc=processSecurityDefinitionOptionParameterEndMsg
        ),
        IN.SOFT_DOLLAR_TIERS: HandleInfo(proc=processSoftDollarTiersMsg),
        IN.FAMILY_CODES: HandleInfo(proc=processFamilyCodesMsg),
        IN.SYMBOL_SAMPLES: HandleInfo(proc=processSymbolSamplesMsg),
        IN.SMART_COMPONENTS: HandleInfo(proc=processSmartComponents),
        IN.TICK_REQ_PARAMS: HandleInfo(proc=processTickReqParams),
        IN.MKT_DEPTH_EXCHANGES: HandleInfo(proc=processMktDepthExchanges),
        IN.HEAD_TIMESTAMP: HandleInfo(proc=processHeadTimestamp),
        IN.TICK_NEWS: HandleInfo(proc=processTickNews),
        IN.NEWS_PROVIDERS: HandleInfo(proc=processNewsProviders),
        IN.NEWS_ARTICLE: HandleInfo(proc=processNewsArticle),
        IN.HISTORICAL_NEWS: HandleInfo(proc=processHistoricalNews),
        IN.HISTORICAL_NEWS_END: HandleInfo(proc=processHistoricalNewsEnd),
        IN.HISTOGRAM_DATA: HandleInfo(proc=processHistogramData),
        IN.REROUTE_MKT_DATA_REQ: HandleInfo(proc=processRerouteMktDataReq),
        IN.REROUTE_MKT_DEPTH_REQ: HandleInfo(proc=processRerouteMktDepthReq),
        IN.MARKET_RULE: HandleInfo(proc=processMarketRuleMsg),
        IN.PNL: HandleInfo(proc=processPnLMsg),
        IN.PNL_SINGLE: HandleInfo(proc=processPnLSingleMsg),
        IN.HISTORICAL_TICKS: HandleInfo(proc=processHistoricalTicks),
        IN.HISTORICAL_TICKS_BID_ASK: HandleInfo(proc=processHistoricalTicksBidAsk),
        IN.HISTORICAL_TICKS_LAST: HandleInfo(proc=processHistoricalTicksLast),
        IN.TICK_BY_TICK: HandleInfo(proc=processTickByTickMsg),
        IN.ORDER_BOUND: HandleInfo(proc=processOrderBoundMsg),
        IN.COMPLETED_ORDER: HandleInfo(proc=processCompletedOrderMsg),
        IN.COMPLETED_ORDERS_END: HandleInfo(proc=processCompletedOrdersEndMsg),
        IN.REPLACE_FA_END: HandleInfo(proc=processReplaceFAEndMsg),
        IN.WSH_META_DATA: HandleInfo(proc=processWshMetaDataMsg),
        IN.WSH_EVENT_DATA: HandleInfo(proc=processWshEventDataMsg),
        IN.HISTORICAL_SCHEDULE: HandleInfo(proc=processHistoricalSchedule),
        IN.USER_INFO: HandleInfo(proc=processUserInfo),
        IN.HISTORICAL_DATA_END: HandleInfo(proc=processHistoricalDataEndMsg),
        IN.CURRENT_TIME_IN_MILLIS: HandleInfo(proc=processCurrentTimeInMillis),
    }

    msgId2handleInfoProtoBuf = {
        IN.ORDER_STATUS: HandleInfo(proc=processOrderStatusMsgProtoBuf),
        IN.ERR_MSG: HandleInfo(proc=processErrorMsgProtoBuf),
        IN.OPEN_ORDER: HandleInfo(proc=processOpenOrderMsgProtoBuf),
        IN.EXECUTION_DATA: HandleInfo(proc=processExecutionDataMsgProtoBuf),
        IN.OPEN_ORDER_END: HandleInfo(proc=processOpenOrdersEndMsgProtoBuf),
        IN.EXECUTION_DATA_END: HandleInfo(proc=processExecutionDataEndMsgProtoBuf),
        IN.COMPLETED_ORDER: HandleInfo(proc=processCompletedOrderMsgProtoBuf),
        IN.COMPLETED_ORDERS_END: HandleInfo(proc=processCompletedOrdersEndMsgProtoBuf),
        IN.ORDER_BOUND: HandleInfo(proc=processOrderBoundMsgProtoBuf),
        IN.CONTRACT_DATA: HandleInfo(proc=processContractDataMsgProtoBuf),
        IN.BOND_CONTRACT_DATA: HandleInfo(proc=processBondContractDataMsgProtoBuf),
        IN.CONTRACT_DATA_END: HandleInfo(proc=processContractDataEndMsgProtoBuf),
        IN.TICK_PRICE: HandleInfo(proc=processTickPriceMsgProtoBuf),
        IN.TICK_SIZE: HandleInfo(proc=processTickSizeMsgProtoBuf),
        IN.TICK_OPTION_COMPUTATION: HandleInfo(proc=processTickOptionComputationMsgProtoBuf),
        IN.TICK_GENERIC: HandleInfo(proc=processTickGenericMsgProtoBuf),
        IN.TICK_STRING: HandleInfo(proc=processTickStringMsgProtoBuf),
        IN.TICK_SNAPSHOT_END: HandleInfo(proc=processTickSnapshotEndMsgProtoBuf),
        IN.MARKET_DEPTH: HandleInfo(proc=processMarketDepthMsgProtoBuf),
        IN.MARKET_DEPTH_L2: HandleInfo(proc=processMarketDepthL2MsgProtoBuf),
        IN.MARKET_DATA_TYPE: HandleInfo(proc=processMarketDataTypeMsgProtoBuf),
        IN.TICK_REQ_PARAMS: HandleInfo(proc=processTickReqParamsMsgProtoBuf),
        IN.ACCT_VALUE: HandleInfo(proc=processAccountValueMsgProtoBuf),
        IN.PORTFOLIO_VALUE: HandleInfo(proc=processPortfolioValueMsgProtoBuf),
        IN.ACCT_UPDATE_TIME: HandleInfo(proc=processAcctUpdateTimeMsgProtoBuf),
        IN.ACCT_DOWNLOAD_END: HandleInfo(proc=processAccountDataEndMsgProtoBuf),
        IN.MANAGED_ACCTS: HandleInfo(proc=processManagedAccountsMsgProtoBuf),
        IN.POSITION_DATA: HandleInfo(proc=processPositionMsgProtoBuf),
        IN.POSITION_END: HandleInfo(proc=processPositionEndMsgProtoBuf),
        IN.ACCOUNT_SUMMARY: HandleInfo(proc=processAccountSummaryMsgProtoBuf),
        IN.ACCOUNT_SUMMARY_END: HandleInfo(proc=processAccountSummaryEndMsgProtoBuf),
        IN.POSITION_MULTI: HandleInfo(proc=processPositionMultiMsgProtoBuf),
        IN.POSITION_MULTI_END: HandleInfo(proc=processPositionMultiEndMsgProtoBuf),
        IN.ACCOUNT_UPDATE_MULTI: HandleInfo(proc=processAccountUpdateMultiMsgProtoBuf),
        IN.ACCOUNT_UPDATE_MULTI_END: HandleInfo(proc=processAccountUpdateMultiEndMsgProtoBuf),
        IN.HISTORICAL_DATA: HandleInfo(proc=processHistoricalDataMsgProtoBuf),
        IN.HISTORICAL_DATA_UPDATE: HandleInfo(proc=processHistoricalDataUpdateMsgProtoBuf),
        IN.HISTORICAL_DATA_END: HandleInfo(proc=processHistoricalDataEndMsgProtoBuf),
        IN.REAL_TIME_BARS: HandleInfo(proc=processRealTimeBarMsgProtoBuf),
        IN.HEAD_TIMESTAMP: HandleInfo(proc=processHeadTimestampMsgProtoBuf),
        IN.HISTOGRAM_DATA: HandleInfo(proc=processHistogramDataMsgProtoBuf),
        IN.HISTORICAL_TICKS: HandleInfo(proc=processHistoricalTicksMsgProtoBuf),
        IN.HISTORICAL_TICKS_BID_ASK: HandleInfo(proc=processHistoricalTicksBidAskMsgProtoBuf),
        IN.HISTORICAL_TICKS_LAST: HandleInfo(proc=processHistoricalTicksLastMsgProtoBuf),
        IN.TICK_BY_TICK: HandleInfo(proc=processTickByTickMsgProtoBuf),
        IN.NEWS_BULLETINS: HandleInfo(proc=processNewsBulletinMsgProtoBuf),
        IN.NEWS_ARTICLE: HandleInfo(proc=processNewsArticleMsgProtoBuf),
        IN.NEWS_PROVIDERS: HandleInfo(proc=processNewsProvidersMsgProtoBuf),
        IN.HISTORICAL_NEWS: HandleInfo(proc=processHistoricalNewsMsgProtoBuf),
        IN.HISTORICAL_NEWS_END: HandleInfo(proc=processHistoricalNewsEndMsgProtoBuf),
        IN.WSH_META_DATA: HandleInfo(proc=processWshMetaDataMsgProtoBuf),
        IN.WSH_EVENT_DATA: HandleInfo(proc=processWshEventDataMsgProtoBuf),
        IN.TICK_NEWS: HandleInfo(proc=processTickNewsMsgProtoBuf),
        IN.SCANNER_PARAMETERS: HandleInfo(proc=processScannerParametersMsgProtoBuf),
        IN.SCANNER_DATA: HandleInfo(proc=processScannerDataMsgProtoBuf),
        IN.FUNDAMENTAL_DATA: HandleInfo(proc=processFundamentalsDataMsgProtoBuf),
        IN.PNL: HandleInfo(proc=processPnLMsgProtoBuf),
        IN.PNL_SINGLE: HandleInfo(proc=processPnLSingleMsgProtoBuf),
        IN.RECEIVE_FA: HandleInfo(proc=processReceiveFAMsgProtoBuf),
        IN.REPLACE_FA_END: HandleInfo(proc=processReplaceFAEndMsgProtoBuf),
        IN.COMMISSION_AND_FEES_REPORT: HandleInfo(proc=processCommissionAndFeesReportMsgProtoBuf),
        IN.HISTORICAL_SCHEDULE: HandleInfo(proc=processHistoricalScheduleMsgProtoBuf),
        IN.REROUTE_MKT_DATA_REQ: HandleInfo(proc=processRerouteMktDataReqMsgProtoBuf),
        IN.REROUTE_MKT_DEPTH_REQ: HandleInfo(proc=processRerouteMktDepthReqMsgProtoBuf),
        IN.SECURITY_DEFINITION_OPTION_PARAMETER: HandleInfo(proc=processSecurityDefinitionOptionParameterMsgProtoBuf),
        IN.SECURITY_DEFINITION_OPTION_PARAMETER_END: HandleInfo(proc=processSecurityDefinitionOptionParameterEndMsgProtoBuf),
        IN.SOFT_DOLLAR_TIERS: HandleInfo(proc=processSoftDollarTiersMsgProtoBuf),
        IN.FAMILY_CODES: HandleInfo(proc=processFamilyCodesMsgProtoBuf),
        IN.SYMBOL_SAMPLES: HandleInfo(proc=processSymbolSamplesMsgProtoBuf),
        IN.SMART_COMPONENTS: HandleInfo(proc=processSmartComponentsMsgProtoBuf),
        IN.MARKET_RULE: HandleInfo(proc=processMarketRuleMsgProtoBuf),
        IN.USER_INFO: HandleInfo(proc=processUserInfoMsgProtoBuf),
        IN.NEXT_VALID_ID: HandleInfo(proc=processNextValidIdMsgProtoBuf),
        IN.CURRENT_TIME: HandleInfo(proc=processCurrentTimeMsgProtoBuf),
        IN.CURRENT_TIME_IN_MILLIS: HandleInfo(proc=processCurrentTimeInMillisMsgProtoBuf),
        IN.VERIFY_MESSAGE_API: HandleInfo(proc=processVerifyMessageApiMsgProtoBuf),
        IN.VERIFY_COMPLETED: HandleInfo(proc=processVerifyCompletedMsgProtoBuf),
        IN.DISPLAY_GROUP_LIST: HandleInfo(proc=processDisplayGroupListMsgProtoBuf),
        IN.DISPLAY_GROUP_UPDATED: HandleInfo(proc=processDisplayGroupUpdatedMsgProtoBuf),
        IN.MKT_DEPTH_EXCHANGES: HandleInfo(proc=processMktDepthExchangesMsgProtoBuf),
        IN.CONFIG_RESPONSE: HandleInfo(proc=processConfigResponseProtoBuf),
        IN.UPDATE_CONFIG_RESPONSE: HandleInfo(proc=processUpdateConfigResponseProtoBuf)
    }
