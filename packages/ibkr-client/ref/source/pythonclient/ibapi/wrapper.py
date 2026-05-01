"""
Copyright (C) 2025 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.

This is the interface that will need to be overloaded by the customer so
that their code can receive info from the TWS/IBGW.

NOTE: the methods use type annotations to describe the types of the arguments.
This is used by the Decoder to dynamically and automatically decode the
received message into the given EWrapper method. This method can only be
used for the most simple messages, but it's still huge helper.
Also this method currently automatically decode a 'version' field in the
message. However having a 'version' field is a legacy thing, newer
message use the 'unified version': the agreed up min version of both
server and client.

"""
import logging
from decimal import Decimal

from ibapi.common import (
    TickerId,
    TickAttrib,
    OrderId,
    FaDataType,
    BarData,
    SetOfString,
    SetOfFloat,
    ListOfFamilyCode,
    ListOfContractDescription,
    ListOfDepthExchanges,
    SmartComponentMap,
    ListOfNewsProviders,
    HistogramData,
    ListOfPriceIncrements,
    ListOfHistoricalTick,
    ListOfHistoricalTickBidAsk,
    ListOfHistoricalTickLast,
    TickAttribLast,
    TickAttribBidAsk,
    ListOfHistoricalSessions,
)

from ibapi.contract import Contract, ContractDetails, DeltaNeutralContract
from ibapi.order import Order
from ibapi.order_state import OrderState
from ibapi.execution import Execution

from ibapi.commission_and_fees_report import CommissionAndFeesReport
from ibapi.ticktype import TickType
from ibapi.utils import current_fn_name, log_

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


def logAnswer(fnName, fnParams):
    log_(fnName, fnParams, "ANSWER")


class EWrapper:
    def __init__(self):
        pass

    def error(
        self,
        reqId: TickerId,
        errorTime: int,
        errorCode: int,
        errorString: str,
        advancedOrderRejectJson="",
    ):
        """This event is called when there is an error with the
        communication or when TWS wants to send a message to the client."""

        logAnswer(current_fn_name(), vars())
        if advancedOrderRejectJson:
            logger.error(
                "ERROR %s %s %s %s %s",
                reqId,
                errorTime,
                errorCode,
                errorString,
                advancedOrderRejectJson,
            )
        else:
            logger.error("ERROR %s %s %s %s", reqId, errorTime, errorCode, errorString)

    def winError(self, text: str, lastError: int):
        logAnswer(current_fn_name(), vars())

    def connectAck(self):
        """callback signifying completion of successful connection"""
        logAnswer(current_fn_name(), vars())

    def marketDataType(self, reqId: TickerId, marketDataType: int):
        """TWS sends a marketDataType(type) callback to the API, where
        type is set to Frozen or RealTime, to announce that market data has been
        switched between frozen and real-time. This notification occurs only
        when market data switches between real-time and frozen. The
        marketDataType( ) callback accepts a reqId parameter and is sent per
        every subscription because different contracts can generally trade on a
        different schedule."""

        logAnswer(current_fn_name(), vars())

    def tickPrice(
        self, reqId: TickerId, tickType: TickType, price: float, attrib: TickAttrib
    ):
        """Market data tick price callback. Handles all price related ticks."""

        logAnswer(current_fn_name(), vars())

    def tickSize(self, reqId: TickerId, tickType: TickType, size: Decimal):
        """Market data tick size callback. Handles all size-related ticks."""

        logAnswer(current_fn_name(), vars())

    def tickSnapshotEnd(self, reqId: int):
        """When requesting market data snapshots, this market will indicate the
        snapshot reception is finished."""

        logAnswer(current_fn_name(), vars())

    def tickGeneric(self, reqId: TickerId, tickType: TickType, value: float):
        logAnswer(current_fn_name(), vars())

    def tickString(self, reqId: TickerId, tickType: TickType, value: str):
        logAnswer(current_fn_name(), vars())

    def tickEFP(
        self,
        reqId: TickerId,
        tickType: TickType,
        basisPoints: float,
        formattedBasisPoints: str,
        totalDividends: float,
        holdDays: int,
        futureLastTradeDate: str,
        dividendImpact: float,
        dividendsToLastTradeDate: float,
    ):
        logAnswer(current_fn_name(), vars())
        """ market data call back for Exchange for Physical
        tickerId -      The request's identifier.
        tickType -      The type of tick being received.
        basisPoints -   Annualized basis points, which is representative of
            the financing rate that can be directly compared to broker rates.
        formattedBasisPoints -  Annualized basis points as a formatted string
            that depicts them in percentage form.
        impliedFuture - The implied Futures price.
        holdDays -  The number of hold days until the lastTradeDate of the EFP.
        futureLastTradeDate -   The expiration date of the single stock future.
        dividendImpact - The dividend impact upon the annualized basis points
            interest rate.
        dividendsToLastTradeDate - The dividends expected until the expiration
            of the single stock future."""

        logAnswer(current_fn_name(), vars())

    def orderStatus(
        self,
        orderId: OrderId,
        status: str,
        filled: Decimal,
        remaining: Decimal,
        avgFillPrice: float,
        permId: int,
        parentId: int,
        lastFillPrice: float,
        clientId: int,
        whyHeld: str,
        mktCapPrice: float,
    ):
        """This event is called whenever the status of an order changes. It is
        also fired after reconnecting to TWS if the client has any open orders.

        orderId: OrderId - The order ID that was specified previously in the
            call to placeOrder()
        status:str - The order status. Possible values include:
            PendingSubmit - indicates that you have transmitted the order, but have not  yet received confirmation that it has been accepted by the order destination. NOTE: This order status is not sent by TWS and should be explicitly set by the API developer when an order is submitted.
            PendingCancel - indicates that you have sent a request to cancel the order but have not yet received cancel confirmation from the order destination. At this point, your order is not confirmed canceled. You may still receive an execution while your cancellation request is pending. NOTE: This order status is not sent by TWS and should be explicitly set by the API developer when an order is canceled.
            PreSubmitted - indicates that a simulated order type has been accepted by the IB system and that this order has yet to be elected. The order is held in the IB system until the election criteria are met. At that time the order is transmitted to the order destination as specified.
            Submitted - indicates that your order has been accepted at the order destination and is working.
            Cancelled - indicates that the balance of your order has been confirmed canceled by the IB system. This could occur unexpectedly when IB or the destination has rejected your order.
            Filled - indicates that the order has been completely filled.
            Inactive - indicates that the order has been accepted by the system (simulated orders) or an exchange (native orders) but that currently the order is inactive due to system, exchange or other issues.
        filled:int - Specifies the number of shares that have been executed.
            For more information about partial fills, see Order Status for Partial Fills.
        remaining:int -   Specifies the number of shares still outstanding.
        avgFillPrice:float - The average price of the shares that have been executed. This parameter is valid only if the filled parameter value is greater than zero. Otherwise, the price parameter will be zero.
        permId:int -  The TWS id used to identify orders. Remains the same over TWS sessions.
        parentId:int - The order ID of the parent order, used for bracket and auto trailing stop orders.
        lastFilledPrice:float - The last price of the shares that have been executed. This parameter is valid only if the filled parameter value is greater than zero. Otherwise, the price parameter will be zero.
        clientId:int - The ID of the client (or TWS) that placed the order. Note that TWS orders have a fixed clientId and orderId of 0 that distinguishes them from API orders.
        whyHeld:str - This field is used to identify an order held when TWS is trying to locate shares for a short sell. The value used to indicate this is 'locate'.

        """

        logAnswer(current_fn_name(), vars())

    def openOrder(
        self, orderId: OrderId, contract: Contract, order: Order, orderState: OrderState
    ):
        """This function is called to feed in open orders.

        orderID: OrderId - The order ID assigned by TWS. Use to cancel or
            update TWS order.
        contract: Contract - The Contract class attributes describe the contract.
        order: Order - The Order class gives the details of the open order.
        orderState: OrderState - The orderState class includes attributes Used
            for both pre and post trade margin and commission and fees data."""

        logAnswer(current_fn_name(), vars())

    def openOrderEnd(self):
        """This is called at the end of a given request for open orders."""

        logAnswer(current_fn_name(), vars())

    def connectionClosed(self):
        """This function is called when TWS closes the sockets
        connection with the ActiveX control, or when TWS is shut down."""

        logAnswer(current_fn_name(), vars())

    def updateAccountValue(self, key: str, val: str, currency: str, accountName: str):
        """This function is called only when ReqAccountUpdates on
        EEClientSocket object has been called."""

        logAnswer(current_fn_name(), vars())

    def updatePortfolio(
        self,
        contract: Contract,
        position: Decimal,
        marketPrice: float,
        marketValue: float,
        averageCost: float,
        unrealizedPNL: float,
        realizedPNL: float,
        accountName: str,
    ):
        """This function is called only when reqAccountUpdates on
        EEClientSocket object has been called."""

        logAnswer(current_fn_name(), vars())

    def updateAccountTime(self, timeStamp: str):
        logAnswer(current_fn_name(), vars())

    def accountDownloadEnd(self, accountName: str):
        """This is called after a batch updateAccountValue() and
        updatePortfolio() is sent."""

        logAnswer(current_fn_name(), vars())

    def nextValidId(self, orderId: int):
        """Receives next valid order id."""

        logAnswer(current_fn_name(), vars())

    def contractDetails(self, reqId: int, contractDetails: ContractDetails):
        """Receives the full contract's definitions. This method will return all
        contracts matching the requested via EEClientSocket::reqContractDetails.
        For example, one can obtain the whole option chain with it."""

        logAnswer(current_fn_name(), vars())

    def bondContractDetails(self, reqId: int, contractDetails: ContractDetails):
        """This function is called when reqContractDetails function
        has been called for bonds."""

        logAnswer(current_fn_name(), vars())

    def contractDetailsEnd(self, reqId: int):
        """This function is called once all contract details for a given
        request are received. This helps to define the end of an option
        chain."""

        logAnswer(current_fn_name(), vars())

    def execDetails(self, reqId: int, contract: Contract, execution: Execution):
        """This event is fired when the reqExecutions() functions is
        invoked, or when an order is filled."""

        logAnswer(current_fn_name(), vars())

    def execDetailsEnd(self, reqId: int):
        """This function is called once all executions have been sent to
        a client in response to reqExecutions()."""

        logAnswer(current_fn_name(), vars())

    def updateMktDepth(
        self,
        reqId: TickerId,
        position: int,
        operation: int,
        side: int,
        price: float,
        size: Decimal,
    ):
        """Returns the order book.

        tickerId -  the request's identifier
        position -  the order book's row being updated
        operation - how to refresh the row:
            0 = insert (insert this new order into the row identified by 'position')
            1 = update (update the existing order in the row identified by 'position')
            2 = delete (delete the existing order at the row identified by 'position').
        side -  0 for ask, 1 for bid
        price - the order's price
        size -  the order's size"""

        logAnswer(current_fn_name(), vars())

    def updateMktDepthL2(
        self,
        reqId: TickerId,
        position: int,
        marketMaker: str,
        operation: int,
        side: int,
        price: float,
        size: Decimal,
        isSmartDepth: bool,
    ):
        """Returns the order book.

        tickerId -  the request's identifier
        position -  the order book's row being updated
        marketMaker - the exchange holding the order
        operation - how to refresh the row:
            0 = insert (insert this new order into the row identified by 'position')
            1 = update (update the existing order in the row identified by 'position')
            2 = delete (delete the existing order at the row identified by 'position').
        side -  0 for ask, 1 for bid
        price - the order's price
        size -  the order's size
        isSmartDepth - is SMART Depth request"""

        logAnswer(current_fn_name(), vars())

    def updateNewsBulletin(
        self, msgId: int, msgType: int, newsMessage: str, originExch: str
    ):
        """provides IB's bulletins
        msgId - the bulletin's identifier
        msgType - one of: 1 - Regular news bulletin 2 - Exchange no longer
            available for trading 3 - Exchange is available for trading
        message - the message
        origExchange -    the exchange where the message comes from."""

        logAnswer(current_fn_name(), vars())

    def managedAccounts(self, accountsList: str):
        """Receives a comma-separated string with the managed account ids."""
        logAnswer(current_fn_name(), vars())

    def receiveFA(self, faData: FaDataType, cxml: str):
        """receives the Financial Advisor's configuration available in the TWS

        faDataType - one of:
            Groups: offer traders a way to create a group of accounts and apply
                 a single allocation method to all accounts in the group.
            Account Aliases: let you easily identify the accounts by meaningful
                 names rather than account numbers.
        faXmlData -  the xml-formatted configuration"""

        logAnswer(current_fn_name(), vars())

    def historicalData(self, reqId: int, bar: BarData):
        """returns the requested historical data bars

        reqId - the request's identifier
        date  - the bar's date and time (either as a yyyymmss hh:mm:ssformatted
             string or as system time according to the request)
        open  - the bar's open point
        high  - the bar's high point
        low   - the bar's low point
        close - the bar's closing point
        volume - the bar's traded volume if available
        count - the number of trades during the bar's timespan (only available
            for TRADES).
        WAP -   the bar's Weighted Average Price
        hasGaps  -indicates if the data has gaps or not."""

        logAnswer(current_fn_name(), vars())

    def historicalDataEnd(self, reqId: int, start: str, end: str):
        """Marks the ending of the historical bars reception."""
        logAnswer(current_fn_name(), vars())

    def scannerParameters(self, xml: str):
        """Provides the xml-formatted parameters available to create a market
        scanner.

        xml -   the xml-formatted string with the available parameters."""
        logAnswer(current_fn_name(), vars())

    def scannerData(
        self,
        reqId: int,
        rank: int,
        contractDetails: ContractDetails,
        distance: str,
        benchmark: str,
        projection: str,
        legsStr: str,
    ):
        """Provides the data resulting from the market scanner request.

        reqid - the request's identifier.
        rank -  the ranking within the response of this bar.
        contractDetails - the data's ContractDetails
        distance -      according to query.
        benchmark -     according to query.
        projection -    according to query.
        legStr - describes the combo legs when the scanner is returning EFP"""

        logAnswer(current_fn_name(), vars())

    def scannerDataEnd(self, reqId: int):
        """Indicates the scanner data reception has terminated.

        reqId - the request's identifier"""

        logAnswer(current_fn_name(), vars())

    def realtimeBar(
        self,
        reqId: TickerId,
        time: int,
        open_: float,
        high: float,
        low: float,
        close: float,
        volume: Decimal,
        wap: Decimal,
        count: int,
    ):
        """Updates the real time 5 seconds bars

        reqId - the request's identifier
        bar.time  - start of bar in unix (or 'epoch') time
        bar.endTime - for synthetic bars, the end time (requires TWS v964). Otherwise -1.
        bar.open_  - the bar's open value
        bar.high  - the bar's high value
        bar.low   - the bar's low value
        bar.close - the bar's closing value
        bar.volume - the bar's traded volume if available
        bar.WAP   - the bar's Weighted Average Price
        bar.count - the number of trades during the bar's timespan (only available
            for TRADES)."""

        logAnswer(current_fn_name(), vars())

    def currentTime(self, time: int):
        """Server's current time. This method will receive IB server's system
        time resulting after the invocation of reqCurrentTime."""

        logAnswer(current_fn_name(), vars())

    def fundamentalData(self, reqId: TickerId, data: str):
        """This function is called to receive fundamental
        market data. The appropriate market data subscription must be set
        up in Account Management before you can receive this data."""

        logAnswer(current_fn_name(), vars())

    def deltaNeutralValidation(
        self, reqId: int, deltaNeutralContract: DeltaNeutralContract
    ):
        """Upon accepting a Delta-Neutral RFQ(request for quote), the
        server sends a deltaNeutralValidation() message with the DeltaNeutralContract
        structure. If the delta and price fields are empty in the original
        request, the confirmation will contain the current values from the
        server. These values are locked when the RFQ is processed and remain
        locked until the RFQ is canceled."""

        logAnswer(current_fn_name(), vars())

    def commissionAndFeesReport(self, commissionAndFeesReport: CommissionAndFeesReport):
        """The commissionAndFeesReport() callback is triggered as follows:
        - immediately after a trade execution
        - by calling reqExecutions()."""

        logAnswer(current_fn_name(), vars())

    def position(
        self, account: str, contract: Contract, position: Decimal, avgCost: float
    ):
        """This event returns real-time positions for all accounts in
        response to the reqPositions() method."""

        logAnswer(current_fn_name(), vars())

    def positionEnd(self):
        """This is called once all position data for a given request are
        received and functions as an end marker for the position() data."""

        logAnswer(current_fn_name(), vars())

    def accountSummary(
        self, reqId: int, account: str, tag: str, value: str, currency: str
    ):
        """Returns the data from the TWS Account Window Summary tab in
        response to reqAccountSummary()."""

        logAnswer(current_fn_name(), vars())

    def accountSummaryEnd(self, reqId: int):
        """This method is called once all account summary data for a
        given request are received."""

        logAnswer(current_fn_name(), vars())

    def verifyMessageAPI(self, apiData: str):
        """Deprecated Function"""
        logAnswer(current_fn_name(), vars())

    def verifyCompleted(self, isSuccessful: bool, errorText: str):
        logAnswer(current_fn_name(), vars())

    def verifyAndAuthMessageAPI(self, apiData: str, xyzChallange: str):
        logAnswer(current_fn_name(), vars())

    def verifyAndAuthCompleted(self, isSuccessful: bool, errorText: str):
        logAnswer(current_fn_name(), vars())

    def displayGroupList(self, reqId: int, groups: str):
        """This callback is a one-time response to queryDisplayGroups().

        reqId - The requestId specified in queryDisplayGroups().
        groups - A list of integers representing visible group ID separated by
            the | character, and sorted by most used group first. This list will
             not change during TWS session (in other words, user cannot add a
            new group; sorting can change though)."""

        logAnswer(current_fn_name(), vars())

    def displayGroupUpdated(self, reqId: int, contractInfo: str):
        """This is sent by TWS to the API client once after receiving
        the subscription request subscribeToGroupEvents(), and will be sent
        again if the selected contract in the subscribed display group has
        changed.

        requestId - The requestId specified in subscribeToGroupEvents().
        contractInfo - The encoded value that uniquely represents the contract
            in IB. Possible values include:
            none = empty selection
            contractID@exchange = any non-combination contract.
                Examples: 8314@SMART for IBM SMART; 8314@ARCA for IBM @ARCA.
            combo = if any combo is selected."""

        logAnswer(current_fn_name(), vars())

    def positionMulti(
        self,
        reqId: int,
        account: str,
        modelCode: str,
        contract: Contract,
        pos: Decimal,
        avgCost: float,
    ):
        """same as position() except it can be for a certain
        account/model"""

        logAnswer(current_fn_name(), vars())

    def positionMultiEnd(self, reqId: int):
        """same as positionEnd() except it can be for a certain
        account/model"""

        logAnswer(current_fn_name(), vars())

    def accountUpdateMulti(
        self,
        reqId: int,
        account: str,
        modelCode: str,
        key: str,
        value: str,
        currency: str,
    ):
        """same as updateAccountValue() except it can be for a certain
        account/model"""

        logAnswer(current_fn_name(), vars())

    def accountUpdateMultiEnd(self, reqId: int):
        """same as accountDownloadEnd() except it can be for a certain
        account/model"""

        logAnswer(current_fn_name(), vars())

    def tickOptionComputation(
        self,
        reqId: TickerId,
        tickType: TickType,
        tickAttrib: int,
        impliedVol: float,
        delta: float,
        optPrice: float,
        pvDividend: float,
        gamma: float,
        vega: float,
        theta: float,
        undPrice: float,
    ):
        """This function is called when the market in an option or its
        underlier moves. TWS's option model volatilities, prices, and
        deltas, along with the present value of dividends expected on that
        options underlier are received."""

        logAnswer(current_fn_name(), vars())

    def securityDefinitionOptionParameter(
        self,
        reqId: int,
        exchange: str,
        underlyingConId: int,
        tradingClass: str,
        multiplier: str,
        expirations: SetOfString,
        strikes: SetOfFloat,
    ):
        """Returns the option chain for an underlying on an exchange
        specified in reqSecDefOptParams There will be multiple callbacks to
        securityDefinitionOptionParameter if multiple exchanges are specified
        in reqSecDefOptParams

        reqId - ID of the request initiating the callback
        underlyingConId - The conID of the underlying security
        tradingClass -  the option trading class
        multiplier -    the option multiplier
        expirations - a list of the expiries for the options of this underlying
             on this exchange
        strikes - a list of the possible strikes for options of this underlying
             on this exchange"""

        logAnswer(current_fn_name(), vars())

    def securityDefinitionOptionParameterEnd(self, reqId: int):
        """Called when all callbacks to securityDefinitionOptionParameter are
        complete

        reqId - the ID used in the call to securityDefinitionOptionParameter"""

        logAnswer(current_fn_name(), vars())

    def softDollarTiers(self, reqId: int, tiers: list):
        """Called when receives Soft Dollar Tier configuration information

        reqId - The request ID used in the call to EEClient::reqSoftDollarTiers
        tiers - Stores a list of SoftDollarTier that contains all Soft Dollar
            Tiers information"""

        logAnswer(current_fn_name(), vars())

    def familyCodes(self, familyCodes: ListOfFamilyCode):
        """returns array of family codes"""
        logAnswer(current_fn_name(), vars())

    def symbolSamples(
        self, reqId: int, contractDescriptions: ListOfContractDescription
    ):
        """returns array of sample contract descriptions"""
        logAnswer(current_fn_name(), vars())

    def mktDepthExchanges(self, depthMktDataDescriptions: ListOfDepthExchanges):
        """returns array of exchanges which return depth to UpdateMktDepthL2"""
        logAnswer(current_fn_name(), vars())

    def tickNews(
        self,
        tickerId: int,
        timeStamp: int,
        providerCode: str,
        articleId: str,
        headline: str,
        extraData: str,
    ):
        """returns news headlines"""
        logAnswer(current_fn_name(), vars())

    def smartComponents(self, reqId: int, smartComponentMap: SmartComponentMap):
        """returns exchange component mapping"""
        logAnswer(current_fn_name(), vars())

    def tickReqParams(
        self, tickerId: int, minTick: float, bboExchange: str, snapshotPermissions: int
    ):
        """returns exchange map of a particular contract"""
        logAnswer(current_fn_name(), vars())

    def newsProviders(self, newsProviders: ListOfNewsProviders):
        """returns available, subscribed API news providers"""
        logAnswer(current_fn_name(), vars())

    def newsArticle(self, requestId: int, articleType: int, articleText: str):
        """returns body of news article"""
        logAnswer(current_fn_name(), vars())

    def historicalNews(
        self,
        requestId: int,
        time: str,
        providerCode: str,
        articleId: str,
        headline: str,
    ):
        """returns historical news headlines"""
        logAnswer(current_fn_name(), vars())

    def historicalNewsEnd(self, requestId: int, hasMore: bool):
        """signals end of historical news"""
        logAnswer(current_fn_name(), vars())

    def headTimestamp(self, reqId: int, headTimestamp: str):
        """returns earliest available data of a type of data for a particular contract"""
        logAnswer(current_fn_name(), vars())

    def histogramData(self, reqId: int, items: HistogramData):
        """returns histogram data for a contract"""
        logAnswer(current_fn_name(), vars())

    def historicalDataUpdate(self, reqId: int, bar: BarData):
        """returns updates in real time when keepUpToDate is set to True"""
        logAnswer(current_fn_name(), vars())

    def rerouteMktDataReq(self, reqId: int, conId: int, exchange: str):
        """returns reroute CFD contract information for market data request"""
        logAnswer(current_fn_name(), vars())

    def rerouteMktDepthReq(self, reqId: int, conId: int, exchange: str):
        """returns reroute CFD contract information for market depth request"""
        logAnswer(current_fn_name(), vars())

    def marketRule(self, marketRuleId: int, priceIncrements: ListOfPriceIncrements):
        """returns minimum price increment structure for a particular market rule ID"""
        logAnswer(current_fn_name(), vars())

    def pnl(
        self, reqId: int, dailyPnL: float, unrealizedPnL: float, realizedPnL: float
    ):
        """returns the daily PnL for the account"""
        logAnswer(current_fn_name(), vars())

    def pnlSingle(
        self,
        reqId: int,
        pos: Decimal,
        dailyPnL: float,
        unrealizedPnL: float,
        realizedPnL: float,
        value: float,
    ):
        """returns the daily PnL for a single position in the account"""
        logAnswer(current_fn_name(), vars())

    def historicalTicks(self, reqId: int, ticks: ListOfHistoricalTick, done: bool):
        """returns historical tick data when whatToShow=MIDPOINT"""
        logAnswer(current_fn_name(), vars())

    def historicalTicksBidAsk(
        self, reqId: int, ticks: ListOfHistoricalTickBidAsk, done: bool
    ):
        """returns historical tick data when whatToShow=BID_ASK"""
        logAnswer(current_fn_name(), vars())

    def historicalTicksLast(
        self, reqId: int, ticks: ListOfHistoricalTickLast, done: bool
    ):
        """returns historical tick data when whatToShow=TRADES"""
        logAnswer(current_fn_name(), vars())

    def tickByTickAllLast(
        self,
        reqId: int,
        tickType: int,
        time: int,
        price: float,
        size: Decimal,
        tickAttribLast: TickAttribLast,
        exchange: str,
        specialConditions: str,
    ):
        """returns tick-by-tick data for tickType = "Last" or "AllLast" """
        logAnswer(current_fn_name(), vars())

    def tickByTickBidAsk(
        self,
        reqId: int,
        time: int,
        bidPrice: float,
        askPrice: float,
        bidSize: Decimal,
        askSize: Decimal,
        tickAttribBidAsk: TickAttribBidAsk,
    ):
        """returns tick-by-tick data for tickType = "BidAsk" """
        logAnswer(current_fn_name(), vars())

    def tickByTickMidPoint(self, reqId: int, time: int, midPoint: float):
        """returns tick-by-tick data for tickType = "MidPoint" """
        logAnswer(current_fn_name(), vars())

    def orderBound(self, permId: int, clientId: int, orderId: int):
        """returns orderBound notification"""
        logAnswer(current_fn_name(), vars())

    def completedOrder(self, contract: Contract, order: Order, orderState: OrderState):
        """This function is called to feed in completed orders.

        contract: Contract - The Contract class attributes describe the contract.
        order: Order - The Order class gives the details of the completed order.
        orderState: OrderState - The orderState class includes completed order status details.
        """

        logAnswer(current_fn_name(), vars())

    def completedOrdersEnd(self):
        """This is called at the end of a given request for completed orders."""

        logAnswer(current_fn_name(), vars())

    def replaceFAEnd(self, reqId: int, text: str):
        """This is called at the end of a replace FA."""

        logAnswer(current_fn_name(), vars())

    def wshMetaData(self, reqId: int, dataJson: str):
        logAnswer(current_fn_name(), vars())

    def wshEventData(self, reqId: int, dataJson: str):
        logAnswer(current_fn_name(), vars())

    def historicalSchedule(
        self,
        reqId: int,
        startDateTime: str,
        endDateTime: str,
        timeZone: str,
        sessions: ListOfHistoricalSessions,
    ):
        """returns historical schedule for historical data request with whatToShow=SCHEDULE"""
        logAnswer(current_fn_name(), vars())

    def userInfo(self, reqId: int, whiteBrandingId: str):
        """returns user info"""
        logAnswer(current_fn_name(), vars())

    def currentTimeInMillis(self, timeInMillis: int):
        """Server's current time in milliseconds. This method will receive IB server's system
        time in milliseconds resulting after the invocation of reqCurrentTimeInMillis."""
        logAnswer(current_fn_name(), vars())

    # Protobuf
    def orderStatusProtoBuf(self, orderStatusProto: OrderStatusProto):
        logAnswer(current_fn_name(), vars())

    def openOrderProtoBuf(self, openOrderProto: OpenOrderProto):
        logAnswer(current_fn_name(), vars())

    def openOrdersEndProtoBuf(self, openOrdersEndProto: OpenOrdersEndProto):
        logAnswer(current_fn_name(), vars())

    def errorProtoBuf(self, errorMessageProto: ErrorMessageProto):
        logAnswer(current_fn_name(), vars())

    def executionDetailsProtoBuf(self, executionDetailsProto: ExecutionDetailsProto):
        logAnswer(current_fn_name(), vars())

    def executionDetailsEndProtoBuf(self, executionDetailsProto: ExecutionDetailsProto):
        logAnswer(current_fn_name(), vars())

    def completedOrderProtoBuf(self, completedOrderProto: CompletedOrderProto):
        logAnswer(current_fn_name(), vars())

    def completedOrdersEndProtoBuf(self, completedOrdersEndProto: CompletedOrdersEndProto):
        logAnswer(current_fn_name(), vars())

    def orderBoundProtoBuf(self, orderBoundProto: OrderBoundProto):
        logAnswer(current_fn_name(), vars())

    def contractDataProtoBuf(self, contractDataProto: ContractDataProto):
        logAnswer(current_fn_name(), vars())

    def bondContractDataProtoBuf(self, contractDataProto: ContractDataProto):
        logAnswer(current_fn_name(), vars())

    def contractDataEndProtoBuf(self, contractDataEndProto: ContractDataEndProto):
        logAnswer(current_fn_name(), vars())

    def tickPriceProtoBuf(self, tickPriceProto: TickPriceProto):
        logAnswer(current_fn_name(), vars())

    def tickSizeProtoBuf(self, tickSizeProto: TickSizeProto):
        logAnswer(current_fn_name(), vars())

    def tickOptionComputationProtoBuf(self, tickOptionComputationProto: TickOptionComputationProto):
        logAnswer(current_fn_name(), vars())

    def tickGenericProtoBuf(self, tickGenericProto: TickGenericProto):
        logAnswer(current_fn_name(), vars())

    def tickStringProtoBuf(self, tickStringProto: TickStringProto):
        logAnswer(current_fn_name(), vars())

    def tickSnapshotEndProtoBuf(self, tickSnapshotEndProto: TickSnapshotEndProto):
        logAnswer(current_fn_name(), vars())

    def updateMarketDepthProtoBuf(self, marketDepthProto: MarketDepthProto):
        logAnswer(current_fn_name(), vars())

    def updateMarketDepthL2ProtoBuf(self, marketDepthL2Proto: MarketDepthL2Proto):
        logAnswer(current_fn_name(), vars())

    def updateMarketDataTypeProtoBuf(self, marketDataTypeProto: MarketDataTypeProto):
        logAnswer(current_fn_name(), vars())

    def tickReqParamsProtoBuf(self, tickReqParamsProto: TickReqParamsProto):
        logAnswer(current_fn_name(), vars())

    def updateAccountValueProtoBuf(self, accountValueProto: AccountValueProto):
        logAnswer(current_fn_name(), vars())

    def updatePortfolioProtoBuf(self, portfolioValueProto: PortfolioValueProto):
        logAnswer(current_fn_name(), vars())

    def updateAccountTimeProtoBuf(self, accountUpdateTimeProto: AccountUpdateTimeProto):
        logAnswer(current_fn_name(), vars())

    def accountDataEndProtoBuf(self, accountDataEndProto: AccountDataEndProto):
        logAnswer(current_fn_name(), vars())

    def managedAccountsProtoBuf(self, managedAccountsProto: ManagedAccountsProto):
        logAnswer(current_fn_name(), vars())

    def positionProtoBuf(self, positionProto: PositionProto):
        logAnswer(current_fn_name(), vars())

    def positionEndProtoBuf(self, positionEndProto: PositionEndProto):
        logAnswer(current_fn_name(), vars())

    def accountSummaryProtoBuf(self, accountSummaryProto: AccountSummaryProto):
        logAnswer(current_fn_name(), vars())

    def accountSummaryEndProtoBuf(self, accountSummaryEndProto: AccountSummaryEndProto):
        logAnswer(current_fn_name(), vars())

    def positionMultiProtoBuf(self, positionMultiProto: PositionMultiProto):
        logAnswer(current_fn_name(), vars())

    def positionMultiEndProtoBuf(self, positionMultiEndProto: PositionMultiEndProto):
        logAnswer(current_fn_name(), vars())

    def accountUpdateMultiProtoBuf(self, accountUpdateMultiProto: AccountUpdateMultiProto):
        logAnswer(current_fn_name(), vars())

    def accountUpdateMultiEndProtoBuf(self, accountUpdateMultiEndProto: AccountUpdateMultiEndProto):
        logAnswer(current_fn_name(), vars())

    def historicalDataProtoBuf(self, historicalDataProto: HistoricalDataProto):
        logAnswer(current_fn_name(), vars())

    def historicalDataUpdateProtoBuf(self, historicalDataUpdateProto: HistoricalDataUpdateProto):
        logAnswer(current_fn_name(), vars())

    def historicalDataEndProtoBuf(self, historicalDataEndProto: HistoricalDataEndProto):
        logAnswer(current_fn_name(), vars())

    def realTimeBarTickProtoBuf(self, realTimeBarTickProto: RealTimeBarTickProto):
        logAnswer(current_fn_name(), vars())

    def headTimestampProtoBuf(self, headTimestampProto: HeadTimestampProto):
        logAnswer(current_fn_name(), vars())

    def histogramDataProtoBuf(self, histogramDataProto: HistogramDataProto):
        logAnswer(current_fn_name(), vars())

    def historicalTicksProtoBuf(self, historicalTicksProto: HistoricalTicksProto):
        logAnswer(current_fn_name(), vars())

    def historicalTicksBidAskProtoBuf(self, historicalTicksBidAskProto: HistoricalTicksBidAskProto):
        logAnswer(current_fn_name(), vars())

    def historicalTicksLastProtoBuf(self, historicalTicksLastProto: HistoricalTicksLastProto):
        logAnswer(current_fn_name(), vars())

    def tickByTickDataProtoBuf(self, tickByTickDataProto: TickByTickDataProto):
        logAnswer(current_fn_name(), vars())

    def updateNewsBulletinProtoBuf(self, newsBulletinProto: NewsBulletinProto):
        logAnswer(current_fn_name(), vars())

    def newsArticleProtoBuf(self, newsArticleProto: NewsArticleProto):
        logAnswer(current_fn_name(), vars())

    def newsProvidersProtoBuf(self, newsProvidersProto: NewsProvidersProto):
        logAnswer(current_fn_name(), vars())

    def historicalNewsProtoBuf(self, historicalNewsProto: HistoricalNewsProto):
        logAnswer(current_fn_name(), vars())

    def historicalNewsEndProtoBuf(self, historicalNewsEndProto: HistoricalNewsEndProto):
        logAnswer(current_fn_name(), vars())

    def wshMetaDataProtoBuf(self, wshMetaDataProto: WshMetaDataProto):
        logAnswer(current_fn_name(), vars())

    def wshEventDataProtoBuf(self, wshEventDataProto: WshEventDataProto):
        logAnswer(current_fn_name(), vars())

    def tickNewsProtoBuf(self, tickNewsProto: TickNewsProto):
        logAnswer(current_fn_name(), vars())

    def scannerParametersProtoBuf(self, scannerParametersProto: ScannerParametersProto):
        logAnswer(current_fn_name(), vars())

    def scannerDataProtoBuf(self, scannerDataProto: ScannerDataProto):
        logAnswer(current_fn_name(), vars())

    def fundamentalsDataProtoBuf(self, fundamentalsDataProto: FundamentalsDataProto):
        logAnswer(current_fn_name(), vars())

    def pnlProtoBuf(self, pnlProto: PnLProto):
        logAnswer(current_fn_name(), vars())

    def pnlSingleProtoBuf(self, pnlSingleProto: PnLSingleProto):
        logAnswer(current_fn_name(), vars())

    def receiveFAProtoBuf(self, receiveFAProto: ReceiveFAProto):
        logAnswer(current_fn_name(), vars())

    def replaceFAEndProtoBuf(self, replaceFAEndProto: ReplaceFAEndProto):
        logAnswer(current_fn_name(), vars())

    def commissionAndFeesReportProtoBuf(self, commissionAndFeesReportProto: CommissionAndFeesReportProto):
        logAnswer(current_fn_name(), vars())

    def historicalScheduleProtoBuf(self, historicalScheduleProto: HistoricalScheduleProto):
        logAnswer(current_fn_name(), vars())

    def rerouteMarketDataRequestProtoBuf(self, rerouteMarketDataRequestProto: RerouteMarketDataRequestProto):
        logAnswer(current_fn_name(), vars())

    def rerouteMarketDepthRequestProtoBuf(self, rerouteMarketDepthRequestProto: RerouteMarketDepthRequestProto):
        logAnswer(current_fn_name(), vars())

    def secDefOptParameterProtoBuf(self, secDefOptParameterProto: SecDefOptParameterProto):
        logAnswer(current_fn_name(), vars())

    def secDefOptParameterEndProtoBuf(self, secDefOptParameterEndProto: SecDefOptParameterEndProto):
        logAnswer(current_fn_name(), vars())

    def softDollarTiersProtoBuf(self, softDollarTiersProto: SoftDollarTiersProto):
        logAnswer(current_fn_name(), vars())

    def familyCodesProtoBuf(self, familyCodesProto: FamilyCodesProto):
        logAnswer(current_fn_name(), vars())

    def symbolSamplesProtoBuf(self, symbolSamplesProto: SymbolSamplesProto):
        logAnswer(current_fn_name(), vars())

    def smartComponentsProtoBuf(self, smartComponentsProto: SmartComponentsProto):
        logAnswer(current_fn_name(), vars())

    def marketRuleProtoBuf(self, marketRuleProto: MarketRuleProto):
        logAnswer(current_fn_name(), vars())

    def userInfoProtoBuf(self, userInfoProto: UserInfoProto):
        logAnswer(current_fn_name(), vars())

    def nextValidIdProtoBuf(self, nextValidIdProto: NextValidIdProto):
        logAnswer(current_fn_name(), vars())

    def currentTimeProtoBuf(self, currentTimeProto: CurrentTimeProto):
        logAnswer(current_fn_name(), vars())

    def currentTimeInMillisProtoBuf(self, currentTimeInMillisProto: CurrentTimeInMillisProto):
        logAnswer(current_fn_name(), vars())

    def verifyMessageApiProtoBuf(self, verifyMessageApiProto: VerifyMessageApiProto):
        logAnswer(current_fn_name(), vars())

    def verifyCompletedProtoBuf(self, verifyCompletedProto: VerifyCompletedProto):
        logAnswer(current_fn_name(), vars())

    def displayGroupListProtoBuf(self, displayGroupListProto: DisplayGroupListProto):
        logAnswer(current_fn_name(), vars())

    def displayGroupUpdatedProtoBuf(self, displayGroupUpdatedProto: DisplayGroupUpdatedProto):
        logAnswer(current_fn_name(), vars())

    def marketDepthExchangesProtoBuf(self, marketDepthExchangesProto: MarketDepthExchangesProto):
        logAnswer(current_fn_name(), vars())

    def configResponseProtoBuf(self, configResponseProto: ConfigResponseProto):
        logAnswer(current_fn_name(), vars())

    def updateConfigResponseProtoBuf(self, updateConfigResponseProto: UpdateConfigResponseProto):
        logAnswer(current_fn_name(), vars())
