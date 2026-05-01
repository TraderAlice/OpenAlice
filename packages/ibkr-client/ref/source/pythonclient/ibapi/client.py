"""
Copyright (C) 2025 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.

The main class to use from API user's point of view.
It takes care of almost everything:
- implementing the requests
- creating the answer decoder
- creating the connection to TWS/IBGW
The user just needs to override EWrapper methods to receive the answers.
"""

import logging
import queue
import socket
import sys

from ibapi import decoder, reader, comm
from ibapi.comm import make_field, make_field_handle_empty
from ibapi.common import *  # @UnusedWildImport
from ibapi.connection import Connection
from ibapi.const import NO_VALID_ID, MAX_MSG_LEN, UNSET_DOUBLE
from ibapi.contract import Contract
from ibapi.errors import (
    NOT_CONNECTED,
    CONNECT_FAIL,
    BAD_LENGTH,
    UPDATE_TWS,
    FA_PROFILE_NOT_SUPPORTED,
    ALREADY_CONNECTED, FAIL_SEND_REQMKT, FAIL_SEND_CANMKT,
    FAIL_SEND_ACCT, FAIL_SEND_EXEC, FAIL_SEND_ORDER,
    FAIL_SEND_CORDER, FAIL_SEND_OORDER, FAIL_SEND_REQCONTRACT, FAIL_SEND_REQMKTDEPTH, FAIL_SEND_CANMKTDEPTH,
    FAIL_SEND_SERVER_LOG_LEVEL, FAIL_SEND_FA_REQUEST, FAIL_SEND_FA_REPLACE, FAIL_SEND_REQSCANNER, FAIL_SEND_CANSCANNER,
    FAIL_SEND_REQSCANNERPARAMETERS, FAIL_SEND_REQHISTDATA, FAIL_SEND_CANHISTDATA, FAIL_SEND_REQRTBARS,
    FAIL_SEND_CANRTBARS, FAIL_SEND_REQCURRTIME, FAIL_SEND_REQFUNDDATA, FAIL_SEND_CANFUNDDATA,
    FAIL_SEND_REQCALCIMPLIEDVOLAT, FAIL_SEND_REQCALCOPTIONPRICE, FAIL_SEND_CANCALCIMPLIEDVOLAT,
    FAIL_SEND_CANCALCOPTIONPRICE, FAIL_SEND_REQGLOBALCANCEL, FAIL_SEND_REQMARKETDATATYPE, FAIL_SEND_REQPOSITIONS,
    FAIL_SEND_CANPOSITIONS, FAIL_SEND_REQACCOUNTDATA, FAIL_SEND_CANACCOUNTDATA, FAIL_SEND_VERIFYREQUEST,
    FAIL_SEND_VERIFYMESSAGE, FAIL_SEND_QUERYDISPLAYGROUPS, FAIL_SEND_SUBSCRIBETOGROUPEVENTS,
    FAIL_SEND_UPDATEDISPLAYGROUP, FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS, FAIL_SEND_STARTAPI,
    FAIL_SEND_VERIFYANDAUTHREQUEST, FAIL_SEND_VERIFYANDAUTHMESSAGE, FAIL_SEND_REQPOSITIONSMULTI,
    FAIL_SEND_CANPOSITIONSMULTI, FAIL_SEND_REQACCOUNTUPDATESMULTI, FAIL_SEND_CANACCOUNTUPDATESMULTI,
    FAIL_SEND_REQSECDEFOPTPARAMS, FAIL_SEND_REQSOFTDOLLARTIERS, FAIL_SEND_REQFAMILYCODES, FAIL_SEND_REQMATCHINGSYMBOLS,
    FAIL_SEND_REQMKTDEPTHEXCHANGES, FAIL_SEND_REQSMARTCOMPONENTS, FAIL_SEND_REQNEWSPROVIDERS, FAIL_SEND_REQNEWSARTICLE,
    FAIL_SEND_REQHISTORICALNEWS, FAIL_SEND_REQHEADTIMESTAMP, FAIL_SEND_REQHISTOGRAMDATA, FAIL_SEND_CANCELHISTOGRAMDATA,
    FAIL_SEND_CANCELHEADTIMESTAMP, FAIL_SEND_REQMARKETRULE, FAIL_SEND_REQPNL,
    FAIL_SEND_CANCELPNL, FAIL_SEND_REQPNLSINGLE, FAIL_SEND_CANCELPNLSINGLE,
    FAIL_SEND_REQHISTORICALTICKS, FAIL_SEND_REQTICKBYTICKDATA, FAIL_SEND_CANCELTICKBYTICKDATA,
    FAIL_SEND_REQCOMPLETEDORDERS, FAIL_SEND_REQ_WSH_META_DATA, FAIL_SEND_CAN_WSH_META_DATA,
    FAIL_SEND_REQ_WSH_EVENT_DATA, FAIL_SEND_CAN_WSH_EVENT_DATA, FAIL_SEND_REQ_USER_INFO,
    FAIL_SEND_REQCURRTIMEINMILLIS, FAIL_SEND_CANCEL_CONTRACT_DATA, FAIL_SEND_CANCEL_HISTORICAL_TICKS,
    FAIL_SEND_REQCONFIG, FAIL_SEND_UPDATECONFIG
)
from ibapi.execution import ExecutionFilter
from ibapi.message import OUT
from ibapi.order import Order, COMPETE_AGAINST_BEST_OFFSET_UP_TO_MID
from ibapi.order_cancel import OrderCancel
from ibapi.scanner import ScannerSubscription
from ibapi.server_versions import (
    MIN_SERVER_VER_OPTIONAL_CAPABILITIES,
    MIN_CLIENT_VER,
    MAX_CLIENT_VER,
    MIN_SERVER_VER_DELTA_NEUTRAL,
    MIN_SERVER_VER_REQ_MKT_DATA_CONID,
    MIN_SERVER_VER_TRADING_CLASS,
    MIN_SERVER_VER_REQ_SMART_COMPONENTS,
    MIN_SERVER_VER_LINKING,
    MIN_SERVER_VER_REQ_MARKET_DATA_TYPE,
    MIN_SERVER_VER_MARKET_RULES,
    MIN_SERVER_VER_TICK_BY_TICK,
    MIN_SERVER_VER_TICK_BY_TICK_IGNORE_SIZE,
    MIN_SERVER_VER_REQ_CALC_IMPLIED_VOLAT,
    MIN_SERVER_VER_SCALE_ORDERS2,
    MIN_SERVER_VER_ALGO_ORDERS,
    MIN_SERVER_VER_NOT_HELD,
    MIN_SERVER_VER_SEC_ID_TYPE,
    MIN_SERVER_VER_PLACE_ORDER_CONID,
    MIN_SERVER_VER_SSHORTX,
    MIN_SERVER_VER_HEDGE_ORDERS,
    MIN_SERVER_VER_OPT_OUT_SMART_ROUTING,
    MIN_SERVER_VER_DELTA_NEUTRAL_CONID,
    MIN_SERVER_VER_DELTA_NEUTRAL_OPEN_CLOSE,
    MIN_SERVER_VER_SCALE_ORDERS3,
    MIN_SERVER_VER_ORDER_COMBO_LEGS_PRICE,
    MIN_SERVER_VER_TRAILING_PERCENT,
    MIN_SERVER_VER_SCALE_TABLE,
    MIN_SERVER_VER_ALGO_ID,
    MIN_SERVER_VER_ORDER_SOLICITED,
    MIN_SERVER_VER_MODELS_SUPPORT,
    MIN_SERVER_VER_EXT_OPERATOR,
    MIN_SERVER_VER_SOFT_DOLLAR_TIER,
    MIN_SERVER_VER_CASH_QTY,
    MIN_SERVER_VER_DECISION_MAKER,
    MIN_SERVER_VER_MIFID_EXECUTION,
    MIN_SERVER_VER_AUTO_PRICE_FOR_HEDGE,
    MIN_SERVER_VER_ORDER_CONTAINER,
    MIN_SERVER_VER_PRICE_MGMT_ALGO,
    MIN_SERVER_VER_DURATION,
    MIN_SERVER_VER_POST_TO_ATS,
    MIN_SERVER_VER_AUTO_CANCEL_PARENT,
    MIN_SERVER_VER_ADVANCED_ORDER_REJECT,
    MIN_SERVER_VER_MANUAL_ORDER_TIME,
    MIN_SERVER_VER_PEGBEST_PEGMID_OFFSETS,
    MIN_SERVER_VER_FRACTIONAL_POSITIONS,
    MIN_SERVER_VER_SSHORTX_OLD,
    MIN_SERVER_VER_SMART_COMBO_ROUTING_PARAMS,
    MIN_SERVER_VER_FA_PROFILE_DESUPPORT,
    MIN_SERVER_VER_PTA_ORDERS,
    MIN_SERVER_VER_RANDOMIZE_SIZE_AND_PRICE,
    MIN_SERVER_VER_PEGGED_TO_BENCHMARK,
    MIN_SERVER_VER_D_PEG_ORDERS,
    MIN_SERVER_VER_POSITIONS,
    MIN_SERVER_VER_PNL,
    MIN_SERVER_VER_EXECUTION_DATA_CHAIN,
    MIN_SERVER_VER_BOND_ISSUERID,
    MIN_SERVER_VER_CONTRACT_DATA_CHAIN,
    MIN_SERVER_VER_PRIMARYEXCH,
    MIN_SERVER_VER_REQ_MKT_DEPTH_EXCHANGES,
    MIN_SERVER_VER_SMART_DEPTH,
    MIN_SERVER_VER_MKT_DEPTH_PRIM_EXCHANGE,
    MIN_SERVER_VER_REPLACE_FA_END,
    MIN_SERVER_VER_HISTORICAL_SCHEDULE,
    MIN_SERVER_VER_SYNT_REALTIME_BARS,
    MIN_SERVER_VER_REQ_HEAD_TIMESTAMP,
    MIN_SERVER_VER_CANCEL_HEADTIMESTAMP,
    MIN_SERVER_VER_REQ_HISTOGRAM,
    MIN_SERVER_VER_HISTORICAL_TICKS,
    MIN_SERVER_VER_SCANNER_GENERIC_OPTS,
    MIN_SERVER_VER_FUNDAMENTAL_DATA,
    MIN_SERVER_VER_REQ_NEWS_PROVIDERS,
    MIN_SERVER_VER_REQ_NEWS_ARTICLE,
    MIN_SERVER_VER_NEWS_QUERY_ORIGINS,
    MIN_SERVER_VER_REQ_HISTORICAL_NEWS,
    MIN_SERVER_VER_SEC_DEF_OPT_PARAMS_REQ,
    MIN_SERVER_VER_REQ_FAMILY_CODES,
    MIN_SERVER_VER_REQ_MATCHING_SYMBOLS,
    MIN_SERVER_VER_WSHE_CALENDAR,
    MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS,
    MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS_DATE,
    MIN_SERVER_VER_USER_INFO,
    MIN_SERVER_VER_MANUAL_ORDER_TIME_EXERCISE_OPTIONS,
    MIN_SERVER_VER_CUSTOMER_ACCOUNT,
    MIN_SERVER_VER_PROFESSIONAL_CUSTOMER,
    MIN_SERVER_VER_RFQ_FIELDS,
    MIN_SERVER_VER_INCLUDE_OVERNIGHT,
    MIN_SERVER_VER_UNDO_RFQ_FIELDS,
    MIN_SERVER_VER_CME_TAGGING_FIELDS,
    MIN_SERVER_VER_CURRENT_TIME_IN_MILLIS,
    MIN_SERVER_VER_IMBALANCE_ONLY,
    MIN_SERVER_VER_PARAMETRIZED_DAYS_OF_EXECUTIONS,
    MIN_SERVER_VER_PROTOBUF,
    MIN_SERVER_VER_CANCEL_CONTRACT_DATA,
    MIN_SERVER_VER_ADDITIONAL_ORDER_PARAMS_1,
    MIN_SERVER_VER_ADDITIONAL_ORDER_PARAMS_2,
    MIN_SERVER_VER_ATTACHED_ORDERS,
    MIN_SERVER_VER_CONFIG,
    MIN_SERVER_VER_UPDATE_CONFIG
)

from ibapi.utils import ClientException, log_
from ibapi.utils import (
    current_fn_name,
    BadMessage,
    isPegBenchOrder,
    isPegMidOrder,
    isPegBestOrder,
    currentTimeMillis,
)
from ibapi.errors import INVALID_SYMBOL
from ibapi.utils import isAsciiPrintable
from ibapi.common import PROTOBUF_MSG_ID
from ibapi.client_utils import createExecutionRequestProto, createPlaceOrderRequestProto, createCancelOrderRequestProto, createGlobalCancelRequestProto
from ibapi.client_utils import createAllOpenOrdersRequestProto, createAutoOpenOrdersRequestProto, createOpenOrdersRequestProto, createCompletedOrdersRequestProto
from ibapi.client_utils import createContractDataRequestProto, createMarketDataTypeRequestProto
from ibapi.client_utils import createMarketDataRequestProto, createMarketDepthRequestProto, createCancelMarketDataProto, createCancelMarketDepthProto
from ibapi.client_utils import createAccountSummaryRequestProto, createCancelAccountSummaryRequestProto, createManagedAccountsRequestProto
from ibapi.client_utils import createAccountDataRequestProto, createPositionsRequestProto, createCancelPositionsRequestProto
from ibapi.client_utils import createPositionsMultiRequestProto, createCancelPositionsMultiRequestProto, createAccountUpdatesMultiRequestProto, createCancelAccountUpdatesMultiRequestProto
from ibapi.client_utils import createHistoricalDataRequestProto, createCancelHistoricalDataProto, createRealTimeBarsRequestProto, createCancelRealTimeBarsProto
from ibapi.client_utils import createHeadTimestampRequestProto, createCancelHeadTimestampProto, createHistogramDataRequestProto, createCancelHistogramDataProto
from ibapi.client_utils import createHistoricalTicksRequestProto, createTickByTickRequestProto, createCancelTickByTickProto
from ibapi.client_utils import createNewsBulletinsRequestProto, createCancelNewsBulletinsProto, createNewsArticleRequestProto, createNewsProvidersRequestProto
from ibapi.client_utils import createHistoricalNewsRequestProto, createWshMetaDataRequestProto, createCancelWshMetaDataProto, createWshEventDataRequestProto, createCancelWshEventDataProto
from ibapi.client_utils import createScannerParametersRequestProto, createScannerSubscriptionRequestProto, createCancelScannerSubscriptionProto
from ibapi.client_utils import createFundamentalsDataRequestProto, createCancelFundamentalsDataProto, createPnLRequestProto, createCancelPnLProto, createPnLSingleRequestProto, createCancelPnLSingleProto
from ibapi.client_utils import createFARequestProto, createFAReplaceProto, createExerciseOptionsRequestProto
from ibapi.client_utils import createCalculateImpliedVolatilityRequestProto, createCancelCalculateImpliedVolatilityProto, createCalculateOptionPriceRequestProto, createCancelCalculateOptionPriceProto
from ibapi.client_utils import createSecDefOptParamsRequestProto, createSoftDollarTiersRequestProto, createFamilyCodesRequestProto, createMatchingSymbolsRequestProto
from ibapi.client_utils import createSmartComponentsRequestProto, createMarketRuleRequestProto, createUserInfoRequestProto
from ibapi.client_utils import createIdsRequestProto, createCurrentTimeRequestProto, createCurrentTimeInMillisRequestProto, createStartApiRequestProto
from ibapi.client_utils import createSetServerLogLevelRequestProto, createVerifyRequestProto, createVerifyMessageRequestProto, createQueryDisplayGroupsRequestProto
from ibapi.client_utils import createSubscribeToGroupEventsRequestProto, createUpdateDisplayGroupRequestProto, createUnsubscribeFromGroupEventsRequestProto, createMarketDepthExchangesRequestProto
from ibapi.client_utils import createCancelContractDataProto, createCancelHistoricalTicksProto

from ibapi.protobuf.ComboLeg_pb2 import ComboLeg as ComboLegProto
from ibapi.protobuf.ExecutionFilter_pb2 import ExecutionFilter as ExecutionFilterProto
from ibapi.protobuf.ExecutionRequest_pb2 import ExecutionRequest as ExecutionRequestProto
from ibapi.protobuf.PlaceOrderRequest_pb2 import PlaceOrderRequest as PlaceOrderRequestProto
from ibapi.protobuf.CancelOrderRequest_pb2 import CancelOrderRequest as CancelOrderRequestProto
from ibapi.protobuf.GlobalCancelRequest_pb2 import GlobalCancelRequest as GlobalCancelRequestProto
from ibapi.protobuf.AllOpenOrdersRequest_pb2 import AllOpenOrdersRequest as AllOpenOrdersRequestProto
from ibapi.protobuf.AutoOpenOrdersRequest_pb2 import AutoOpenOrdersRequest as AutoOpenOrdersRequestProto
from ibapi.protobuf.OpenOrdersRequest_pb2 import OpenOrdersRequest as OpenOrdersRequestProto
from ibapi.protobuf.CompletedOrdersRequest_pb2 import CompletedOrdersRequest as CompletedOrdersRequestProto
from ibapi.protobuf.ContractDataRequest_pb2 import ContractDataRequest as ContractDataRequestProto
from ibapi.protobuf.MarketDataRequest_pb2 import MarketDataRequest as MarketDataRequestProto
from ibapi.protobuf.CancelMarketData_pb2 import CancelMarketData as CancelMarketDataProto
from ibapi.protobuf.MarketDepthRequest_pb2 import MarketDepthRequest as MarketDepthRequestProto
from ibapi.protobuf.CancelMarketDepth_pb2 import CancelMarketDepth as CancelMarketDepthProto
from ibapi.protobuf.MarketDataTypeRequest_pb2 import MarketDataTypeRequest as MarketDataTypeRequestProto
from ibapi.protobuf.AccountDataRequest_pb2 import AccountDataRequest as AccountDataRequestProto
from ibapi.protobuf.ManagedAccountsRequest_pb2 import ManagedAccountsRequest as ManagedAccountsRequestProto
from ibapi.protobuf.PositionsRequest_pb2 import PositionsRequest as PositionsRequestProto
from ibapi.protobuf.AccountSummaryRequest_pb2 import AccountSummaryRequest as AccountSummaryRequestProto
from ibapi.protobuf.CancelAccountSummary_pb2 import CancelAccountSummary as CancelAccountSummaryProto
from ibapi.protobuf.CancelPositions_pb2 import CancelPositions as CancelPositionsProto
from ibapi.protobuf.PositionsMultiRequest_pb2 import PositionsMultiRequest as PositionsMultiRequestProto
from ibapi.protobuf.CancelPositionsMulti_pb2 import CancelPositionsMulti as CancelPositionsMultiProto
from ibapi.protobuf.AccountUpdatesMultiRequest_pb2 import AccountUpdatesMultiRequest as AccountUpdatesMultiRequestProto
from ibapi.protobuf.CancelAccountUpdatesMulti_pb2 import CancelAccountUpdatesMulti as CancelAccountUpdatesMultiProto
from ibapi.protobuf.HistoricalDataRequest_pb2 import HistoricalDataRequest as HistoricalDataRequestProto
from ibapi.protobuf.RealTimeBarsRequest_pb2 import RealTimeBarsRequest as RealTimeBarsRequestProto
from ibapi.protobuf.HeadTimestampRequest_pb2 import HeadTimestampRequest as HeadTimestampRequestProto
from ibapi.protobuf.HistogramDataRequest_pb2 import HistogramDataRequest as HistogramDataRequestProto
from ibapi.protobuf.HistoricalTicksRequest_pb2 import HistoricalTicksRequest as HistoricalTicksRequestProto
from ibapi.protobuf.TickByTickRequest_pb2 import TickByTickRequest as TickByTickRequestProto
from ibapi.protobuf.CancelHistoricalData_pb2 import CancelHistoricalData as CancelHistoricalDataProto
from ibapi.protobuf.CancelRealTimeBars_pb2 import CancelRealTimeBars as CancelRealTimeBarsProto
from ibapi.protobuf.CancelHeadTimestamp_pb2 import CancelHeadTimestamp as CancelHeadTimestampProto
from ibapi.protobuf.CancelHistogramData_pb2 import CancelHistogramData as CancelHistogramDataProto
from ibapi.protobuf.CancelTickByTick_pb2 import CancelTickByTick as CancelTickByTickProto
from ibapi.protobuf.NewsBulletinsRequest_pb2 import NewsBulletinsRequest as NewsBulletinsRequestProto
from ibapi.protobuf.CancelNewsBulletins_pb2 import CancelNewsBulletins as CancelNewsBulletinsProto
from ibapi.protobuf.NewsArticleRequest_pb2 import NewsArticleRequest as NewsArticleRequestProto
from ibapi.protobuf.NewsProvidersRequest_pb2 import NewsProvidersRequest as NewsProvidersRequestProto
from ibapi.protobuf.HistoricalNewsRequest_pb2 import HistoricalNewsRequest as HistoricalNewsRequestProto
from ibapi.protobuf.WshMetaDataRequest_pb2 import WshMetaDataRequest as WshMetaDataRequestProto
from ibapi.protobuf.CancelWshMetaData_pb2 import CancelWshMetaData as CancelWshMetaDataProto
from ibapi.protobuf.WshEventDataRequest_pb2 import WshEventDataRequest as WshEventDataRequestProto
from ibapi.protobuf.CancelWshEventData_pb2 import CancelWshEventData as CancelWshEventDataProto
from ibapi.protobuf.ScannerParametersRequest_pb2 import ScannerParametersRequest as ScannerParametersRequestProto
from ibapi.protobuf.ScannerSubscriptionRequest_pb2 import ScannerSubscriptionRequest as ScannerSubscriptionRequestProto
from ibapi.protobuf.ScannerSubscription_pb2 import ScannerSubscription as ScannerSubscriptionProto
from ibapi.protobuf.FundamentalsDataRequest_pb2 import FundamentalsDataRequest as FundamentalsDataRequestProto
from ibapi.protobuf.PnLRequest_pb2 import PnLRequest as PnLRequestProto
from ibapi.protobuf.PnLSingleRequest_pb2 import PnLSingleRequest as PnLSingleRequestProto
from ibapi.protobuf.CancelScannerSubscription_pb2 import CancelScannerSubscription as CancelScannerSubscriptionProto
from ibapi.protobuf.CancelFundamentalsData_pb2 import CancelFundamentalsData as CancelFundamentalsDataProto
from ibapi.protobuf.CancelPnL_pb2 import CancelPnL as CancelPnLProto
from ibapi.protobuf.CancelPnLSingle_pb2 import CancelPnLSingle as CancelPnLSingleProto
from ibapi.protobuf.FARequest_pb2 import FARequest as FARequestProto
from ibapi.protobuf.FAReplace_pb2 import FAReplace as FAReplaceProto
from ibapi.protobuf.ExerciseOptionsRequest_pb2 import ExerciseOptionsRequest as ExerciseOptionsRequestProto
from ibapi.protobuf.CalculateImpliedVolatilityRequest_pb2 import CalculateImpliedVolatilityRequest as CalculateImpliedVolatilityRequestProto
from ibapi.protobuf.CancelCalculateImpliedVolatility_pb2 import CancelCalculateImpliedVolatility as CancelCalculateImpliedVolatilityProto
from ibapi.protobuf.CalculateOptionPriceRequest_pb2 import CalculateOptionPriceRequest as CalculateOptionPriceRequestProto
from ibapi.protobuf.CancelCalculateOptionPrice_pb2 import CancelCalculateOptionPrice as CancelCalculateOptionPriceProto
from ibapi.protobuf.SecDefOptParamsRequest_pb2 import SecDefOptParamsRequest as SecDefOptParamsRequestProto
from ibapi.protobuf.SoftDollarTiersRequest_pb2 import SoftDollarTiersRequest as SoftDollarTiersRequestProto
from ibapi.protobuf.FamilyCodesRequest_pb2 import FamilyCodesRequest as FamilyCodesRequestProto
from ibapi.protobuf.MatchingSymbolsRequest_pb2 import MatchingSymbolsRequest as MatchingSymbolsRequestProto
from ibapi.protobuf.SmartComponentsRequest_pb2 import SmartComponentsRequest as SmartComponentsRequestProto
from ibapi.protobuf.MarketRuleRequest_pb2 import MarketRuleRequest as MarketRuleRequestProto
from ibapi.protobuf.UserInfoRequest_pb2 import UserInfoRequest as UserInfoRequestProto
from ibapi.protobuf.IdsRequest_pb2 import IdsRequest as IdsRequestProto
from ibapi.protobuf.CurrentTimeRequest_pb2 import CurrentTimeRequest as CurrentTimeRequestProto
from ibapi.protobuf.CurrentTimeInMillisRequest_pb2 import CurrentTimeInMillisRequest as CurrentTimeInMillisRequestProto
from ibapi.protobuf.StartApiRequest_pb2 import StartApiRequest as StartApiRequestProto
from ibapi.protobuf.SetServerLogLevelRequest_pb2 import SetServerLogLevelRequest as SetServerLogLevelRequestProto
from ibapi.protobuf.VerifyRequest_pb2 import VerifyRequest as VerifyRequestProto
from ibapi.protobuf.VerifyMessageRequest_pb2 import VerifyMessageRequest as VerifyMessageRequestProto
from ibapi.protobuf.QueryDisplayGroupsRequest_pb2 import QueryDisplayGroupsRequest as QueryDisplayGroupsRequestProto
from ibapi.protobuf.SubscribeToGroupEventsRequest_pb2 import SubscribeToGroupEventsRequest as SubscribeToGroupEventsRequestProto
from ibapi.protobuf.UpdateDisplayGroupRequest_pb2 import UpdateDisplayGroupRequest as UpdateDisplayGroupRequestProto
from ibapi.protobuf.UnsubscribeFromGroupEventsRequest_pb2 import UnsubscribeFromGroupEventsRequest as UnsubscribeFromGroupEventsRequestProto
from ibapi.protobuf.MarketDepthExchangesRequest_pb2 import MarketDepthExchangesRequest as MarketDepthExchangesRequestProto
from ibapi.protobuf.AttachedOrders_pb2 import AttachedOrders as AttachedOrdersProto
from ibapi.protobuf.ConfigRequest_pb2 import ConfigRequest as ConfigRequestProto
from ibapi.protobuf.UpdateConfigRequest_pb2 import UpdateConfigRequest as UpdateConfigRequestProto

# TODO: use pylint

logger = logging.getLogger(__name__)


class EClient(object):
    (DISCONNECTED, CONNECTING, CONNECTED) = range(3)

    def __init__(self, wrapper):
        self.msg_queue = queue.Queue()
        self.wrapper = wrapper
        self.decoder = None
        self.nKeybIntHard = 0
        self.conn = None
        self.host = None
        self.port = None
        self.extraAuth = False
        self.clientId = None
        self.serverVersion_ = None
        self.connTime = None
        self.connState = None
        self.optCapab = None
        self.asynchronous = False
        self.reader = None
        self.decode = None
        self.setConnState(EClient.DISCONNECTED)
        self.connectOptions = None
        self.reset()

    def reset(self):
        self.nKeybIntHard = 0
        self.conn = None
        self.host = None
        self.port = None
        self.extraAuth = False
        self.clientId = None
        self.serverVersion_ = None
        self.connTime = None
        self.connState = None
        self.optCapab = None
        self.asynchronous = False
        self.reader = None
        self.decode = None
        self.setConnState(EClient.DISCONNECTED)
        self.connectOptions = None

    def setConnState(self, connState):
        _connState = self.connState
        self.connState = connState
        logger.debug(f"{id(self)} connState: {_connState} -> {self.connState}")

    def sendMsgProtoBuf(self, msgId: int, msg: bytes):
        full_msg = comm.make_msg_proto(msgId, msg)
        logger.info("%s %s %s", "SENDING", current_fn_name(1), full_msg)
        self.conn.sendMsg(full_msg)

    def sendMsg(self, msgId:int, msg: str):
        useRawIntMsgId = self.serverVersion() >= MIN_SERVER_VER_PROTOBUF
        full_msg = comm.make_msg(msgId, useRawIntMsgId, msg)
        logger.info("%s %s %s", "SENDING", current_fn_name(1), full_msg)
        self.conn.sendMsg(full_msg)

    def logRequest(self, fnName, fnParams):
        log_(fnName, fnParams, "REQUEST")

    def validateInvalidSymbols(self, host):
        if host is not None and not isAsciiPrintable(host):
            raise ClientException(
                INVALID_SYMBOL.code(),
                INVALID_SYMBOL.msg(),
                host.encode(sys.stdout.encoding, errors="ignore").decode(sys.stdout.encoding),
            )

        if self.connectOptions is not None and not isAsciiPrintable(self.connectOptions):
            raise ClientException(
                INVALID_SYMBOL.code(),
                INVALID_SYMBOL.msg(),
                self.connectOptions.encode(sys.stdout.encoding, errors="ignore").decode(sys.stdout.encoding),
            )

        if self.optCapab is not None and not isAsciiPrintable(self.optCapab):
            raise ClientException(
                INVALID_SYMBOL.code(),
                INVALID_SYMBOL.msg(),
                self.optCapab.encode(sys.stdout.encoding, errors="ignore").decode(sys.stdout.encoding),
            )

    def checkConnected(self):
        if self.isConnected() :
            raise ClientException(
                ALREADY_CONNECTED.code(),
                ALREADY_CONNECTED.msg(),
                ""
            )

    def useProtoBuf(self, msgId: int) -> bool:
        unifiedVersion = PROTOBUF_MSG_IDS.get(msgId)
        return unifiedVersion is not None and unifiedVersion <= self.serverVersion()

    def startApi(self):
        """Initiates the message exchange between the client application and
        the TWS/IB Gateway."""
        if (self.useProtoBuf(OUT.START_API)):
            startApiRequestProto = createStartApiRequestProto(self.clientId, self.optCapab)
            self.startApiProtoBuf(startApiRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 2

            msg = f"{make_field(VERSION)}{make_field(self.clientId)}"

            if self.serverVersion() >= MIN_SERVER_VER_OPTIONAL_CAPABILITIES:
                msg += make_field(self.optCapab if self.optCapab is not None else "")

            self.sendMsg(OUT.START_API, msg)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_STARTAPI.code(), FAIL_SEND_STARTAPI.msg() + str(ex))
            return

    def startApiProtoBuf(self, startApiRequestProto: StartApiRequestProto):
        if startApiRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = startApiRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.START_API + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_STARTAPI.code(), FAIL_SEND_STARTAPI.msg() + str(ex))
            return

    def connect(self, host, port, clientId):
        """This function must be called before any other. There is no
        feedback for a successful connection, but a subsequent attempt to
        connect will return the message \"Already connected.\"

        host:str - The host name or IP address of the machine where TWS is
            running. Leave blank to connect to the local host.
        port:int - Must match the port specified in TWS on the
            Configure>API>Socket Port field.
        clientId:int - A number used to identify this client connection. All
            orders placed/modified from this client will be associated with
            this client identifier.

            Note: Each client MUST connect with a unique clientId."""

        try:
            self.validateInvalidSymbols(host)
        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return

        try:
            self.checkConnected()
        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg)
            return

        try:
            self.host = host
            self.port = port
            self.clientId = clientId
            logger.debug(
                "Connecting to %s:%d w/ id:%d", self.host, self.port, self.clientId
            )

            self.conn = Connection(self.host, self.port)

            self.conn.connect()
            self.setConnState(EClient.CONNECTING)

            # TODO: support async mode

            v100prefix = "API\0"
            v100version = "v%d..%d" % (MIN_CLIENT_VER, MAX_CLIENT_VER)

            if self.connectOptions:
                v100version = v100version + " " + self.connectOptions

            # v100version = "v%d..%d" % (MIN_CLIENT_VER, 101)
            msg = comm.make_initial_msg(v100version)
            logger.debug("msg %s", msg)
            msg2 = str.encode(v100prefix, "ascii") + msg
            logger.debug("REQUEST %s", msg2)
            self.conn.sendMsg(msg2)

            self.decoder = decoder.Decoder(self.wrapper, self.serverVersion())
            fields = []

            # sometimes I get news before the server version, thus the loop
            while len(fields) != 2:
                self.decoder.interpret(fields, 0)
                buf = self.conn.recvMsg()
                if not self.conn.isConnected():
                    # recvMsg() triggers disconnect() where there's a socket.error or 0 length buffer
                    # if we don't then drop out of the while loop it infinitely loops
                    logger.warning("Disconnected; resetting connection")
                    self.reset()
                    return
                logger.debug("ANSWER %s", buf)
                if len(buf) > 0:
                    (size, msg, rest) = comm.read_msg(buf)
                    logger.debug("size:%d msg:%s rest:%s|", size, msg, rest)
                    fields = comm.read_fields(msg)
                    logger.debug("fields %s", fields)
                else:
                    fields = []

            (server_version, conn_time) = fields
            server_version = int(server_version)
            logger.debug("ANSWER Version:%d time:%s", server_version, conn_time)
            self.connTime = conn_time
            self.serverVersion_ = server_version
            self.decoder.serverVersion = self.serverVersion()

            self.setConnState(EClient.CONNECTED)

            self.reader = reader.EReader(self.conn, self.msg_queue)
            self.reader.start()  # start thread
            logger.info("sent startApi")
            self.startApi()
            self.wrapper.connectAck()
        except socket.error:
            if self.wrapper:
                self.wrapper.error(NO_VALID_ID, currentTimeMillis(), CONNECT_FAIL.code(), CONNECT_FAIL.msg())
            logger.info("could not connect")
            self.disconnect()

    def disconnect(self):
        """Call this function to terminate the connections with TWS.
        Calling this function does not cancel orders that have already been
        sent."""

        self.setConnState(EClient.DISCONNECTED)
        if self.conn is not None:
            logger.info("disconnecting")
            self.conn.disconnect()
            self.wrapper.connectionClosed()
            self.reset()

    def isConnected(self):
        """Call this function to check if there is a connection with TWS"""

        connConnected = self.conn and self.conn.isConnected()
        logger.debug(
            f"{id(self)} isConn: {self.connState}, connConnected: {str(connConnected)}"
        )
        return EClient.CONNECTED == self.connState and connConnected

    def keyboardInterrupt(self):
        # intended to be overloaded
        pass

    def keyboardInterruptHard(self):
        self.nKeybIntHard += 1
        if self.nKeybIntHard > 5:
            raise SystemExit()

    def setConnectOptions(self, opts):
        self.connectOptions = opts

    def setOptionalCapabilities(self, optCapab):
        self.optCapab = optCapab

    def msgLoopTmo(self):
        # intended to be overloaded
        pass

    def msgLoopRec(self):
        # intended to be overloaded
        pass

    def run(self):
        """This is the function that has the message loop."""

        try:
            while self.isConnected() or not self.msg_queue.empty():
                try:
                    try:
                        text = self.msg_queue.get(block=True, timeout=0.2)
                        if len(text) > MAX_MSG_LEN:
                            self.wrapper.error(
                                NO_VALID_ID,
                                currentTimeMillis(),
                                BAD_LENGTH.code(),
                                f"{BAD_LENGTH.msg()}:{len(text)}:{text}",
                            )
                            break
                    except queue.Empty:
                        logger.debug("queue.get: empty")
                        self.msgLoopTmo()
                    else:

                        if self.serverVersion() >= MIN_SERVER_VER_PROTOBUF:
                            sMsgId = text[:4]
                            msgId = int.from_bytes(sMsgId, 'big')  
                            text = text[4:]
                        else:
                            sMsgId = text[:text.index(b"\0")]
                            text = text[text.index(b"\0") + len(b"\0"):]
                            msgId = int(sMsgId)

                        if msgId > PROTOBUF_MSG_ID:
                            msgId -= PROTOBUF_MSG_ID
                            logger.debug("msgId: %d, protobuf: %s", msgId, text)
                            self.decoder.processProtoBuf(text, msgId)
                        else:
                            fields = comm.read_fields(text)
                            logger.debug("msgId: %d, fields: %s", msgId, fields)
                            self.decoder.interpret(fields, msgId)

                        self.msgLoopRec()
                except (KeyboardInterrupt, SystemExit):
                    logger.info("detected KeyboardInterrupt, SystemExit")
                    self.keyboardInterrupt()
                    self.keyboardInterruptHard()
                except BadMessage:
                    logger.info("BadMessage")

                logger.debug(
                    "conn:%d queue.sz:%d", self.isConnected(), self.msg_queue.qsize()
                )
        finally:
            self.disconnect()

    def reqCurrentTime(self):
        """Asks the current system time on the server side."""

        if (self.useProtoBuf(OUT.REQ_CURRENT_TIME)):
            currentTimeRequestProto = createCurrentTimeRequestProto()
            self.reqCurrentTimeProtoBuf(currentTimeRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = f"{make_field(VERSION)}"

            self.sendMsg(OUT.REQ_CURRENT_TIME, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQCURRTIME.code(), FAIL_SEND_REQCURRTIME.msg() + str(ex))
            return

    def reqCurrentTimeProtoBuf(self, currentTimeRequestProto: CurrentTimeRequestProto):
        if currentTimeRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = currentTimeRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_CURRENT_TIME + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQCURRTIME.code(), FAIL_SEND_REQCURRTIME.msg() + str(ex))
            return

    def serverVersion(self):
        """Returns the version of the TWS instance to which the API application is connected."""

        return self.serverVersion_

    def setServerLogLevel(self, logLevel: int):
        """The default detail level is ERROR. For more details, see API
        Logging."""
        if (self.useProtoBuf(OUT.SET_SERVER_LOGLEVEL)):
            setServerLogLevelRequestProto = createSetServerLogLevelRequestProto(logLevel)
            self.setServerLogLevelProtoBuf(setServerLogLevelRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = f"{make_field(VERSION)}{make_field(logLevel)}"
            self.sendMsg(OUT.SET_SERVER_LOGLEVEL, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_SERVER_LOG_LEVEL.code(), FAIL_SEND_SERVER_LOG_LEVEL.msg() + str(ex))
            return

    def setServerLogLevelProtoBuf(self, setServerLogLevelRequestProto: SetServerLogLevelRequestProto):
        if setServerLogLevelRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = setServerLogLevelRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.SET_SERVER_LOGLEVEL + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_SERVER_LOG_LEVEL.code(), FAIL_SEND_SERVER_LOG_LEVEL.msg() + str(ex))
            return

    def twsConnectionTime(self):
        """Returns the time the API application made a connection to TWS."""

        return self.connTime

    ##########################################################################
    # Market Data
    ##########################################################################

    def reqMktData(
        self,
        reqId: TickerId,
        contract: Contract,
        genericTickList: str,
        snapshot: bool,
        regulatorySnapshot: bool,
        mktDataOptions: TagValueList,
    ):
        """Call this function to request market data. The market data
        will be returned by the tickPrice and tickSize events.

        reqId: TickerId - The ticker id. Must be a unique value. When the
            market data returns, it will be identified by this tag. This is
            also used when canceling the market data.
        contract:Contract - This structure contains a description of the
            Contractt for which market data is being requested.
        genericTickList:str - A comma delimited list of generic tick types.
            Tick types can be found in the Generic Tick Types page.
            Prefixing w/ 'mdoff' indicates that top mkt data shouldn't tick.
            You can specify the news source by postfixing w/ ':<source>.
            Example: "mdoff,292:FLY+BRF"
        snapshot:bool - Check to return a single snapshot of Market data and
            have the market data subscription cancel. Do not enter any
            genericTicklist values if you use snapshots.
        regulatorySnapshot: bool - With the US Value Snapshot Bundle for stocks,
            regulatory snapshots are available for 0.01 USD each.
        mktDataOptions:TagValueList - For internal use only.
            Use default value XYZ."""

        if (self.useProtoBuf(OUT.REQ_MKT_DATA)):
            marketDataRequestProto = createMarketDataRequestProto(reqId, contract, genericTickList, snapshot, regulatorySnapshot, mktDataOptions)
            self.reqMarketDataProtoBuf(marketDataRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_DELTA_NEUTRAL:
            if contract.deltaNeutralContract:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support delta-neutral orders.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_REQ_MKT_DATA_CONID:
            if contract.conId > 0:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support conId parameter.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support tradingClass parameter in reqMktData.",
                )
                return

        try:
            VERSION = 11

            # send req mkt data msg
            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
            ]

            # send contract fields
            if self.serverVersion() >= MIN_SERVER_VER_REQ_MKT_DATA_CONID:
                flds += [
                    make_field(contract.conId),
                ]

            flds += [
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),  # srv v15 and above
                make_field(contract.exchange),
                make_field(contract.primaryExchange),  # srv v14 and above
                make_field(contract.currency),
                make_field(contract.localSymbol),
            ]  # srv v2 and above

            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.tradingClass),
                ]

            # Send combo legs for BAG requests (srv v8 and above)
            if contract.secType == "BAG":
                comboLegsCount = len(contract.comboLegs) if contract.comboLegs else 0
                flds += [
                    make_field(comboLegsCount),
                ]
                for comboLeg in contract.comboLegs:
                    flds += [
                        make_field(comboLeg.conId),
                        make_field(comboLeg.ratio),
                        make_field(comboLeg.action),
                        make_field(comboLeg.exchange),
                    ]

            if self.serverVersion() >= MIN_SERVER_VER_DELTA_NEUTRAL:
                if contract.deltaNeutralContract:
                    flds += [
                        make_field(True),
                        make_field(contract.deltaNeutralContract.conId),
                        make_field(contract.deltaNeutralContract.delta),
                        make_field(contract.deltaNeutralContract.price),
                    ]
                else:
                    flds += [
                        make_field(False),
                    ]

            flds += [
                make_field(genericTickList),  # srv v31 and above
                make_field(snapshot),
            ]  # srv v35 and above

            if self.serverVersion() >= MIN_SERVER_VER_REQ_SMART_COMPONENTS:
                flds += [
                    make_field(regulatorySnapshot),
                ]

            # send mktDataOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                # current doc says this part if for "internal use only" -> won't support it
                if mktDataOptions:
                    raise NotImplementedError("not supported")
                mktDataOptionsStr = ""
                flds += [
                    make_field(mktDataOptionsStr),
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_MKT_DATA, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQMKT.code(), FAIL_SEND_REQMKT.msg() + str(ex))
            return

    def reqMarketDataProtoBuf(self, marketDataRequestProto: MarketDataRequestProto):
        if marketDataRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = marketDataRequestProto.reqId if marketDataRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = marketDataRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_MKT_DATA + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQMKT.code(), FAIL_SEND_REQMKT.msg() + str(ex))
            return

    def cancelMktData(self, reqId: TickerId):
        """After calling this function, market data for the specified id
        will stop flowing.

        reqId: TickerId - The ID that was specified in the call to
            reqMktData()."""

        if (self.useProtoBuf(OUT.CANCEL_MKT_DATA)):
            cancelMarketDataProto = createCancelMarketDataProto(reqId)
            self.cancelMarketDataProtoBuf(cancelMarketDataProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 2

            # send req mkt data msg
            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
            ]

            msg = "".join(flds)
            self.sendMsg(OUT.CANCEL_MKT_DATA, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANMKT.code(), FAIL_SEND_CANMKT.msg() + str(ex))
            return


    def cancelMarketDataProtoBuf(self, cancelMarketDataProto: CancelMarketDataProto):
        if cancelMarketDataProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelMarketDataProto.reqId if cancelMarketDataProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelMarketDataProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_MKT_DATA + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANMKT.code(), FAIL_SEND_CANMKT.msg() + str(ex))
            return

    def reqMarketDataType(self, marketDataType: int):
        """The API can receive frozen market data from Trader
        Workstation. Frozen market data is the last data recorded in our system.
        During normal trading hours, the API receives real-time market data. If
        you use this function, you are telling TWS to automatically switch to
        frozen market data after the close. Then, before the opening of the next
        trading day, market data will automatically switch back to real-time
        market data.

        marketDataType:int - 1 for real-time streaming market data or 2 for
            frozen market data"""

        if (self.useProtoBuf(OUT.REQ_MARKET_DATA_TYPE)):
            marketDataTypeRequestProto = createMarketDataTypeRequestProto(marketDataType)
            self.reqMarketDataTypeProtoBuf(marketDataTypeRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_MARKET_DATA_TYPE:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support market data type requests.",
            )
            return

        try:
            VERSION = 1

            # send req mkt data msg
            flds = []
            flds += [
                make_field(VERSION),
                make_field(marketDataType),
            ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_MARKET_DATA_TYPE, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQMARKETDATATYPE.code(), FAIL_SEND_REQMARKETDATATYPE.msg() + str(ex))
            return

    def reqMarketDataTypeProtoBuf(self, marketDataTypeRequestProto: MarketDataTypeRequestProto):
        if marketDataTypeRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = marketDataTypeRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_MARKET_DATA_TYPE + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQMARKETDATATYPE.code(), FAIL_SEND_REQMARKETDATATYPE.msg() + str(ex))
            return

    def reqSmartComponents(self, reqId: int, bboExchange: str):
        if self.useProtoBuf(OUT.REQ_SMART_COMPONENTS):
            self.reqSmartComponentsProtoBuf(createSmartComponentsRequestProto(reqId, bboExchange))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_SMART_COMPONENTS:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support smart components request.",
            )
            return

        try:
            msg = (
                make_field(reqId)
                + make_field(bboExchange)
            )
            self.sendMsg(OUT.REQ_SMART_COMPONENTS, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQSMARTCOMPONENTS.code(), FAIL_SEND_REQSMARTCOMPONENTS.msg() + str(ex))
            return

    def reqSmartComponentsProtoBuf(self, smartComponentsRequestProto: SmartComponentsRequestProto):
        if smartComponentsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = smartComponentsRequestProto.reqId if smartComponentsRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = smartComponentsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_SMART_COMPONENTS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQSMARTCOMPONENTS.code(), FAIL_SEND_REQSMARTCOMPONENTS.msg() + str(ex))
            return

    def reqMarketRule(self, marketRuleId: int):
        if self.useProtoBuf(OUT.REQ_MARKET_RULE):
            self.reqMarketRuleProtoBuf(createMarketRuleRequestProto(marketRuleId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_MARKET_RULES:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support market rule requests.",
            )
            return

        try:
            msg = make_field(marketRuleId)
            self.sendMsg(OUT.REQ_MARKET_RULE, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQMARKETRULE.code(), FAIL_SEND_REQMARKETRULE.msg() + str(ex))
            return

    def reqMarketRuleProtoBuf(self, marketRuleRequestProto: MarketRuleRequestProto):
        if marketRuleRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = marketRuleRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_MARKET_RULE + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQMARKETRULE.code(), FAIL_SEND_REQMARKETRULE.msg() + str(ex))
            return

    def reqTickByTickData(
        self,
        reqId: int,
        contract: Contract,
        tickType: str,
        numberOfTicks: int,
        ignoreSize: bool,
    ):
        if self.useProtoBuf(OUT.REQ_TICK_BY_TICK_DATA):
            tickByTickRequestProto = createTickByTickRequestProto(reqId, contract, tickType, numberOfTicks, ignoreSize)
            self.reqTickByTickDataProtoBuf(tickByTickRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_TICK_BY_TICK:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support tick-by-tick data requests.",
            )
            return

        if self.serverVersion() < MIN_SERVER_VER_TICK_BY_TICK_IGNORE_SIZE:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + " It does not support ignoreSize and numberOfTicks parameters "
                "in tick-by-tick data requests.",
            )
            return

        try:
            msg = (
                make_field(reqId)
                + make_field(contract.conId)
                + make_field(contract.symbol)
                + make_field(contract.secType)
                + make_field(contract.lastTradeDateOrContractMonth)
                + make_field_handle_empty(contract.strike)
                + make_field(contract.right)
                + make_field(contract.multiplier)
                + make_field(contract.exchange)
                + make_field(contract.primaryExchange)
                + make_field(contract.currency)
                + make_field(contract.localSymbol)
                + make_field(contract.tradingClass)
                + make_field(tickType)
            )

            if self.serverVersion() >= MIN_SERVER_VER_TICK_BY_TICK_IGNORE_SIZE:
                msg += make_field(numberOfTicks) + make_field(ignoreSize)
            self.sendMsg(OUT.REQ_TICK_BY_TICK_DATA, msg)
        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQTICKBYTICKDATA.code(), FAIL_SEND_REQTICKBYTICKDATA.msg() + str(ex))
            return

    def reqTickByTickDataProtoBuf(self, tickByTickRequestProto: TickByTickRequestProto):
        if tickByTickRequestProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = tickByTickRequestProto.reqId if tickByTickRequestProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = tickByTickRequestProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.REQ_TICK_BY_TICK_DATA + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQTICKBYTICKDATA.code(), FAIL_SEND_REQTICKBYTICKDATA.msg() + str(ex))
            return

    def cancelTickByTickData(self, reqId: int):
        if self.useProtoBuf(OUT.CANCEL_TICK_BY_TICK_DATA):
            cancelTickByTickProto = createCancelTickByTickProto(reqId)
            self.cancelTickByTickProtoBuf(cancelTickByTickProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_TICK_BY_TICK:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support tick-by-tick data requests.",
            )
            return

        try:
            msg = make_field(reqId)
            self.sendMsg(OUT.CANCEL_TICK_BY_TICK_DATA, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCELTICKBYTICKDATA.code(), FAIL_SEND_CANCELTICKBYTICKDATA.msg() + str(ex))
            return

    def cancelTickByTickProtoBuf(self, cancelTickByTickProto: CancelTickByTickProto):
        if cancelTickByTickProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = cancelTickByTickProto.reqId if cancelTickByTickProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = cancelTickByTickProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.CANCEL_TICK_BY_TICK_DATA + PROTOBUF_MSG_ID, serializedString)
        
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCELTICKBYTICKDATA.code(), FAIL_SEND_CANCELTICKBYTICKDATA.msg() + str(ex))
            return

    ##########################################################################
    # Options
    ##########################################################################

    def calculateImpliedVolatility(
        self,
        reqId: TickerId,
        contract: Contract,
        optionPrice: float,
        underPrice: float,
        implVolOptions: TagValueList,
    ):
        """Call this function to calculate volatility for a supplied
        option price and underlying price. Result will be delivered
        via EWrapper.tickOptionComputation()

        reqId:TickerId -  The request id.
        contract:Contract -  Describes the contract.
        optionPrice:double - The price of the option.
        underPrice:double - Price of the underlying."""

        if (self.useProtoBuf(OUT.REQ_CALC_IMPLIED_VOLAT)):
            calculateImpliedVolatilityRequestProto = createCalculateImpliedVolatilityRequestProto(reqId, contract, optionPrice, underPrice, implVolOptions)
            self.calculateImpliedVolatilityProtoBuf(calculateImpliedVolatilityRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_CALC_IMPLIED_VOLAT:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support calculateImpliedVolatility req.",
            )
            return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support tradingClass parameter in calculateImpliedVolatility.",
                )
                return

        try:
            VERSION = 3

            # send req mkt data msg
            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
                # send contract fields
                make_field(contract.conId),
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
                make_field(contract.exchange),
                make_field(contract.primaryExchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
            ]
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.tradingClass),
                ]
            flds += [make_field(optionPrice), make_field(underPrice)]

            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                implVolOptStr = ""
                if implVolOptions:
                    raise NotImplementedError("not supported")
                flds += [
                    make_field(implVolOptStr)
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_CALC_IMPLIED_VOLAT, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQCALCIMPLIEDVOLAT.code(), FAIL_SEND_REQCALCIMPLIEDVOLAT.msg() + str(ex))
            return

    def calculateImpliedVolatilityProtoBuf(self, calculateImpliedVolatilityRequestProto: CalculateImpliedVolatilityRequestProto):
        if calculateImpliedVolatilityRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = calculateImpliedVolatilityRequestProto.reqId if calculateImpliedVolatilityRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = calculateImpliedVolatilityRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_CALC_IMPLIED_VOLAT + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQCALCIMPLIEDVOLAT.code(), FAIL_SEND_REQCALCIMPLIEDVOLAT.msg() + str(ex))
            return

    def cancelCalculateImpliedVolatility(self, reqId: TickerId):
        """Call this function to cancel a request to calculate
        volatility for a supplied option price and underlying price.

        reqId:TickerId - The request ID."""

        if (self.useProtoBuf(OUT.CANCEL_CALC_IMPLIED_VOLAT)):
            cancelCalculateImpliedVolatilityProto = createCancelCalculateImpliedVolatilityProto(reqId)
            self.cancelCalculateImpliedVolatilityProtoBuf(cancelCalculateImpliedVolatilityProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_CALC_IMPLIED_VOLAT:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support calculateImpliedVolatility req.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )
            self.sendMsg(OUT.CANCEL_CALC_IMPLIED_VOLAT, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCALCIMPLIEDVOLAT.code(), FAIL_SEND_CANCALCIMPLIEDVOLAT.msg() + str(ex))
            return

    def cancelCalculateImpliedVolatilityProtoBuf(self, cancelCalculateImpliedVolatilityProto: CancelCalculateImpliedVolatilityProto):
        if cancelCalculateImpliedVolatilityProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelCalculateImpliedVolatilityProto.reqId if cancelCalculateImpliedVolatilityProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelCalculateImpliedVolatilityProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_CALC_IMPLIED_VOLAT + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCALCIMPLIEDVOLAT.code(), FAIL_SEND_CANCALCIMPLIEDVOLAT.msg() + str(ex))
            return

    def calculateOptionPrice(
        self,
        reqId: TickerId,
        contract: Contract,
        volatility: float,
        underPrice: float,
        optPrcOptions: TagValueList,
    ):
        """Call this function to calculate option price and greek values
        for a supplied volatility and underlying price.

        reqId:TickerId -    The ticker ID.
        contract:Contract - Describes the contract.
        volatility:double - The volatility.
        underPrice:double - Price of the underlying."""

        if (self.useProtoBuf(OUT.REQ_CALC_OPTION_PRICE)):
            calculateOptionPriceRequestProto = createCalculateOptionPriceRequestProto(reqId, contract, volatility, underPrice, optPrcOptions)
            self.calculateOptionPriceProtoBuf(calculateOptionPriceRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_CALC_IMPLIED_VOLAT:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support calculateImpliedVolatility req.",
            )
            return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support tradingClass parameter in calculateImpliedVolatility.",
                )
                return

        try:
            VERSION = 3

            # send req mkt data msg
            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
                # send contract fields
                make_field(contract.conId),
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
                make_field(contract.exchange),
                make_field(contract.primaryExchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
            ]
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.tradingClass),
                ]
            flds += [make_field(volatility), make_field(underPrice)]

            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                optPrcOptStr = ""
                if optPrcOptions:
                    raise NotImplementedError("not supported")
                flds += [
                    make_field(optPrcOptStr)
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_CALC_OPTION_PRICE, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQCALCOPTIONPRICE.code(), FAIL_SEND_REQCALCOPTIONPRICE.msg() + str(ex))
            return

    def calculateOptionPriceProtoBuf(self, calculateOptionPriceRequestProto: CalculateOptionPriceRequestProto):
        if calculateOptionPriceRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = calculateOptionPriceRequestProto.reqId if calculateOptionPriceRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = calculateOptionPriceRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_CALC_OPTION_PRICE + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQCALCOPTIONPRICE.code(), FAIL_SEND_REQCALCOPTIONPRICE.msg() + str(ex))
            return

    def cancelCalculateOptionPrice(self, reqId: TickerId):
        """Call this function to cancel a request to calculate the option
        price and greek values for a supplied volatility and underlying price.

        reqId:TickerId - The request ID."""

        if (self.useProtoBuf(OUT.CANCEL_CALC_OPTION_PRICE)):
            cancelCalculateOptionPriceProto = createCancelCalculateOptionPriceProto(reqId)
            self.cancelCalculateOptionPriceProtoBuf(cancelCalculateOptionPriceProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_CALC_IMPLIED_VOLAT:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support calculateImpliedVolatility req.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )
            self.sendMsg(OUT.CANCEL_CALC_OPTION_PRICE, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCALCOPTIONPRICE.code(), FAIL_SEND_CANCALCOPTIONPRICE.msg() + str(ex))
            return

    def cancelCalculateOptionPriceProtoBuf(self, cancelCalculateOptionPriceProto: CancelCalculateOptionPriceProto):
        if cancelCalculateOptionPriceProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelCalculateOptionPriceProto.reqId if cancelCalculateOptionPriceProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelCalculateOptionPriceProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_CALC_OPTION_PRICE + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCALCOPTIONPRICE.code(), FAIL_SEND_CANCALCOPTIONPRICE.msg() + str(ex))
            return

    def exerciseOptions(
        self,
        reqId: TickerId,
        contract: Contract,
        exerciseAction: int,
        exerciseQuantity: int,
        account: str,
        override: int,
        manualOrderTime: str,
        customerAccount: str,
        professionalCustomer: bool
    ):
        """reqId:TickerId - The ticker id. multipleust be a unique value.
        contract:Contract - This structure contains a description of the
            contract to be exercised
        exerciseAction:int - Specifies whether you want the option to lapse
            or be exercised.
            Values are 1 = exercise, 2 = lapse.
        exerciseQuantity:int - The quantity you want to exercise.
        account:str - destination account
        override:int - Specifies whether your setting will override the system's
            natural action. For example, if your action is "exercise" and the
            option is not in-the-money, by natural action the option would not
            exercise. If you have override set to "yes" the natural action would
             be overridden and the out-of-the money option would be exercised.
            Values are: 0 = no, 1 = yes.
        manualOrderTime:str - manual order time
        customerAccount:str - customer account
        professionalCustomer:bool - professional customer"""

        if (self.useProtoBuf(OUT.EXERCISE_OPTIONS)):
            exerciseOptionsRequestProto = createExerciseOptionsRequestProto(reqId, contract, exerciseAction, exerciseQuantity, account, override != 0, manualOrderTime, customerAccount, professionalCustomer)
            self.exerciseOptionsProtoBuf(exerciseOptionsRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass or contract.conId > 0:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support conId and tradingClass parameters in exerciseOptions.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_MANUAL_ORDER_TIME_EXERCISE_OPTIONS and manualOrderTime:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support manual order time parameter in exerciseOptions.",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_CUSTOMER_ACCOUNT
            and customerAccount
        ):
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support customer account parameter in exerciseOptions.",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_PROFESSIONAL_CUSTOMER
            and professionalCustomer
        ):
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support professional customer parameter in exerciseOptions.",
            )
            return

        try:
            VERSION = 2

            # send req mkt data msg
            fields = []
            fields += [
                make_field(VERSION),
                make_field(reqId),
            ]
            # send contract fields
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                fields += [
                    make_field(contract.conId),
                ]
            fields += [
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
                make_field(contract.exchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
            ]
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                fields += [
                    make_field(contract.tradingClass),
                ]
            fields += [
                make_field(exerciseAction),
                make_field(exerciseQuantity),
                make_field(account),
                make_field(override),
            ]
            if self.serverVersion() >= MIN_SERVER_VER_MANUAL_ORDER_TIME_EXERCISE_OPTIONS:
                fields += [
                    make_field(manualOrderTime),
                ]
            if self.serverVersion() >= MIN_SERVER_VER_CUSTOMER_ACCOUNT:
                fields += [
                    make_field(customerAccount),
                ]
            if self.serverVersion() >= MIN_SERVER_VER_PROFESSIONAL_CUSTOMER:
                fields += [
                    make_field(professionalCustomer),
                ]

            msg = "".join(fields)
            self.sendMsg(OUT.EXERCISE_OPTIONS, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQMKT.code(), FAIL_SEND_REQMKT.msg() + str(ex))
            return

    def exerciseOptionsProtoBuf(self, exerciseOptionsRequestProto: ExerciseOptionsRequestProto):
        if exerciseOptionsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        orderId = exerciseOptionsRequestProto.orderId if exerciseOptionsRequestProto.HasField('orderId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(orderId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = exerciseOptionsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.EXERCISE_OPTIONS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(orderId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(orderId, currentTimeMillis(), FAIL_SEND_REQMKT.code(), FAIL_SEND_REQMKT.msg() + str(ex))
            return

    #########################################################################
    # Orders
    ########################################################################

    def placeOrder(self, orderId: OrderId, contract: Contract, order: Order):
        """Call this function to place an order. The order status will
        be returned by the orderStatus event.

        orderId:OrderId - The order id. You must specify a unique value. When the
            order START_APItus returns, it will be identified by this tag.
            This tag is also used when canceling the order.
        contract:Contract - This structure contains a description of the
            contract which is being traded.
        order:Order - This structure contains the details of tradedhe order.
            Note: Each client MUST connect with a unique clientId."""

        if (self.useProtoBuf(OUT.PLACE_ORDER)):
            placeOrderRequestProto = createPlaceOrderRequestProto(orderId, contract, order)
            self.placeOrderProtoBuf(placeOrderRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(orderId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_DELTA_NEUTRAL:
            if contract.deltaNeutralContract:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support delta-neutral orders.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_SCALE_ORDERS2:
            if order.scaleSubsLevelSize != UNSET_INTEGER:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(), 
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support Subsequent Level Size for Scale orders.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_ALGO_ORDERS:
            if order.algoStrategy:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(), 
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support algo orders.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_NOT_HELD:
            if order.notHeld:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(), 
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support notHeld parameter.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_SEC_ID_TYPE:
            if contract.secIdType or contract.secId:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support secIdType and secId parameters.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_PLACE_ORDER_CONID:
            if contract.conId and contract.conId > 0:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support conId parameter.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_SSHORTX:
            if order.exemptCode != -1:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support exemptCode parameter.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_SSHORTX:
            if contract.comboLegs:
                for comboLeg in contract.comboLegs:
                    if comboLeg.exemptCode != -1:
                        self.wrapper.error(
                            orderId,
                            currentTimeMillis(),
                            UPDATE_TWS.code(),
                            UPDATE_TWS.msg()
                            + "  It does not support exemptCode parameter.",
                        )
                        return

        if self.serverVersion() < MIN_SERVER_VER_HEDGE_ORDERS:
            if order.hedgeType:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support hedge orders.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_OPT_OUT_SMART_ROUTING:
            if order.optOutSmartRouting:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support optOutSmartRouting parameter.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_DELTA_NEUTRAL_CONID:
            if (
                order.deltaNeutralConId > 0
                or order.deltaNeutralSettlingFirm
                or order.deltaNeutralClearingAccount
                or order.deltaNeutralClearingIntent
            ):
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support deltaNeutral parameters: "
                    + "ConId, SettlingFirm, ClearingAccount, ClearingIntent.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_DELTA_NEUTRAL_OPEN_CLOSE:
            if (
                order.deltaNeutralOpenClose
                or order.deltaNeutralShortSale
                or order.deltaNeutralShortSaleSlot > 0
                or order.deltaNeutralDesignatedLocation
            ):
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support deltaNeutral parameters: "
                    "OpenClose, ShortSale, ShortSaleSlot, DesignatedLocation.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_SCALE_ORDERS3:
            if (
                order.scalePriceIncrement > 0
                and order.scalePriceIncrement != UNSET_DOUBLE
            ):
                if (
                    order.scalePriceAdjustValue != UNSET_DOUBLE
                    or order.scalePriceAdjustInterval != UNSET_INTEGER
                    or order.scaleProfitOffset != UNSET_DOUBLE
                    or order.scaleAutoReset
                    or order.scaleInitPosition != UNSET_INTEGER
                    or order.scaleInitFillQty != UNSET_INTEGER
                    or order.scaleRandomPercent
                ):
                    self.wrapper.error(
                        orderId,
                        currentTimeMillis(),
                        UPDATE_TWS.code(),
                        UPDATE_TWS.msg()
                        + "  It does not support Scale order parameters: PriceAdjustValue, PriceAdjustInterval, "
                        + "ProfitOffset, AutoReset, InitPosition, InitFillQty and RandomPercent",
                    )
                    return

        if (
            self.serverVersion() < MIN_SERVER_VER_ORDER_COMBO_LEGS_PRICE
            and contract.secType == "BAG"
        ):
            if order.orderComboLegs:
                for orderComboLeg in order.orderComboLegs:
                    if orderComboLeg.price != UNSET_DOUBLE:
                        self.wrapper.error(
                            orderId,
                            currentTimeMillis(),
                            UPDATE_TWS.code(),
                            UPDATE_TWS.msg()
                            + "  It does not support per-leg prices for order combo legs.",
                        )
                        return

        if self.serverVersion() < MIN_SERVER_VER_TRAILING_PERCENT:
            if order.trailingPercent != UNSET_DOUBLE:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support trailing percent parameter",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support tradingClass parameter in placeOrder.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_SCALE_TABLE:
            if order.scaleTable or order.activeStartTime or order.activeStopTime:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support scaleTable, activeStartTime and activeStopTime parameters",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_ALGO_ID:
            if order.algoId:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support algoId parameter",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_ORDER_SOLICITED:
            if order.solicited:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support order solicited parameter.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_MODELS_SUPPORT:
            if order.modelCode:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support model code parameter.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_EXT_OPERATOR:
            if order.extOperator:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + "  It does not support ext operator parameter",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_SOFT_DOLLAR_TIER:
            if order.softDollarTier.name or order.softDollarTier.val:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + " It does not support soft dollar tier",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_CASH_QTY:
            if order.cashQty:
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + " It does not support cash quantity parameter",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_DECISION_MAKER and (
            order.mifid2DecisionMaker != "" or order.mifid2DecisionAlgo != ""
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + " It does not support MIFID II decision maker parameters",
            )
            return

        if self.serverVersion() < MIN_SERVER_VER_MIFID_EXECUTION and (
            order.mifid2ExecutionTrader != "" or order.mifid2ExecutionAlgo != ""
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support MIFID II execution parameters",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_AUTO_PRICE_FOR_HEDGE
            and order.dontUseAutoPriceForHedge
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + " It does not support dontUseAutoPriceForHedge parameter",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_ORDER_CONTAINER
            and order.isOmsContainer
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support oms container parameter",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_PRICE_MGMT_ALGO
            and order.usePriceMgmtAlgo
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + " It does not support Use price management algo requests",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_DURATION
            and order.duration != UNSET_INTEGER
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support duration attribute",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_POST_TO_ATS
            and order.postToAts != UNSET_INTEGER
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support postToAts attribute",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_AUTO_CANCEL_PARENT
            and order.autoCancelParent
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support autoCancelParent attribute",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_ADVANCED_ORDER_REJECT
            and order.advancedErrorOverride
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support advanced error override attribute",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_MANUAL_ORDER_TIME
            and order.manualOrderTime
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support manual order time attribute",
            )
            return

        if self.serverVersion() < MIN_SERVER_VER_PEGBEST_PEGMID_OFFSETS:
            if (
                order.minTradeQty != UNSET_INTEGER
                or order.minCompeteSize != UNSET_INTEGER
                or order.competeAgainstBestOffset != UNSET_DOUBLE
                or order.midOffsetAtWhole != UNSET_DOUBLE
                or order.midOffsetAtHalf != UNSET_DOUBLE
            ):
                self.wrapper.error(
                    orderId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support PEG BEST / PEG MID order parameters: minTradeQty, minCompeteSize, "
                    + "competeAgainstBestOffset, midOffsetAtWhole and midOffsetAtHalf",
                )
                return

        if (
            self.serverVersion() < MIN_SERVER_VER_CUSTOMER_ACCOUNT
            and order.customerAccount
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support customer account parameter",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_PROFESSIONAL_CUSTOMER
            and order.professionalCustomer
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support professional customer parameter",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_INCLUDE_OVERNIGHT
            and order.includeOvernight
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support include overnight parameter",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_CME_TAGGING_FIELDS 
            and order.manualOrderIndicator != UNSET_INTEGER
        ):
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support manual order indicator parameters",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_IMBALANCE_ONLY
            and order.imbalanceOnly
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support imbalance only parameter",
            )
            return

        try:
            VERSION = 27 if (self.serverVersion() < MIN_SERVER_VER_NOT_HELD) else 45

            # send place order msg
            flds = []

            if self.serverVersion() < MIN_SERVER_VER_ORDER_CONTAINER:
                flds += [make_field(VERSION)]

            flds += [make_field(orderId)]

            # send contract fields
            if self.serverVersion() >= MIN_SERVER_VER_PLACE_ORDER_CONID:
                flds.append(make_field(contract.conId))
            flds += [
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),  # srv v15 and above
                make_field(contract.exchange),
                make_field(contract.primaryExchange),  # srv v14 and above
                make_field(contract.currency),
                make_field(contract.localSymbol),
            ]  # srv v2 and above
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds.append(make_field(contract.tradingClass))

            if self.serverVersion() >= MIN_SERVER_VER_SEC_ID_TYPE:
                flds += [make_field(contract.secIdType), make_field(contract.secId)]

            # send main order fields
            flds.append(make_field(order.action))

            if self.serverVersion() >= MIN_SERVER_VER_FRACTIONAL_POSITIONS:
                flds.append(make_field(order.totalQuantity))
            else:
                flds.append(make_field(int(order.totalQuantity)))

            flds.append(make_field(order.orderType))
            if self.serverVersion() < MIN_SERVER_VER_ORDER_COMBO_LEGS_PRICE:
                flds.append(
                    make_field(order.lmtPrice if order.lmtPrice != UNSET_DOUBLE else 0)
                )
            else:
                flds.append(make_field_handle_empty(order.lmtPrice))
            if self.serverVersion() < MIN_SERVER_VER_TRAILING_PERCENT:
                flds.append(
                    make_field(order.auxPrice if order.auxPrice != UNSET_DOUBLE else 0)
                )
            else:
                flds.append(make_field_handle_empty(order.auxPrice))

                # send extended order fields
                flds += [
                    make_field(order.tif),
                    make_field(order.ocaGroup),
                    make_field(order.account),
                    make_field(order.openClose),
                    make_field(order.origin),
                    make_field(order.orderRef),
                    make_field(order.transmit),
                    make_field(order.parentId),  # srv v4 and above
                    make_field(order.blockOrder),  # srv v5 and above
                    make_field(order.sweepToFill),  # srv v5 and above
                    make_field(order.displaySize),  # srv v5 and above
                    make_field(order.triggerMethod),  # srv v5 and above
                    make_field(order.outsideRth),  # srv v5 and above
                    make_field(order.hidden),
                ]  # srv v7 and above

            # Send combo legs for BAG requests (srv v8 and above)
            if contract.secType == "BAG":
                comboLegsCount = len(contract.comboLegs) if contract.comboLegs else 0
                flds.append(make_field(comboLegsCount))
                if comboLegsCount > 0:
                    for comboLeg in contract.comboLegs:
                        assert comboLeg
                        flds += [
                            make_field(comboLeg.conId),
                            make_field(comboLeg.ratio),
                            make_field(comboLeg.action),
                            make_field(comboLeg.exchange),
                            make_field(comboLeg.openClose),
                            make_field(comboLeg.shortSaleSlot),  # srv v35 and above
                            make_field(comboLeg.designatedLocation),
                        ]  # srv v35 and above
                        if self.serverVersion() >= MIN_SERVER_VER_SSHORTX_OLD:
                            flds.append(make_field(comboLeg.exemptCode))

            # Send order combo legs for BAG requests
            if (
                self.serverVersion() >= MIN_SERVER_VER_ORDER_COMBO_LEGS_PRICE
                and contract.secType == "BAG"
            ):
                orderComboLegsCount = (
                    len(order.orderComboLegs) if order.orderComboLegs else 0
                )
                flds.append(make_field(orderComboLegsCount))
                if orderComboLegsCount:
                    for orderComboLeg in order.orderComboLegs:
                        assert orderComboLeg
                        flds.append(make_field_handle_empty(orderComboLeg.price))

            if (
                self.serverVersion() >= MIN_SERVER_VER_SMART_COMBO_ROUTING_PARAMS
                and contract.secType == "BAG"
            ):
                smartComboRoutingParamsCount = (
                    len(order.smartComboRoutingParams)
                    if order.smartComboRoutingParams
                    else 0
                )
                flds.append(make_field(smartComboRoutingParamsCount))
                if smartComboRoutingParamsCount > 0:
                    for tagValue in order.smartComboRoutingParams:
                        flds += [make_field(tagValue.tag), make_field(tagValue.value)]

            ######################################################################
            # Send the shares allocation.
            #
            # This specifies the number of order shares allocated to each Financial
            # Advisor managed account. The format of the allocation string is as
            # follows:
            #                      <account_code1>/<number_shares1>,<account_code2>/<number_shares2>,...N
            # E.g.
            #              To allocate 20 shares of a 100 share order to account 'U101' and the
            #      residual 80 to account 'U203' enter the following share allocation string:
            #          U101/20,U203/80
            #####################################################################
            # send deprecated sharesAllocation field
            flds += [
                make_field(""),  # srv v9 and above
                make_field(order.discretionaryAmt),  # srv v10 and above
                make_field(order.goodAfterTime),  # srv v11 and above
                make_field(order.goodTillDate),  # srv v12 and above
                make_field(order.faGroup),  # srv v13 and above
                make_field(order.faMethod),  # srv v13 and above
                make_field(order.faPercentage),
            ]  # srv v13 and above
            if self.serverVersion() < MIN_SERVER_VER_FA_PROFILE_DESUPPORT:
                flds.append(make_field(""))  # send deprecated faProfile field

            if self.serverVersion() >= MIN_SERVER_VER_MODELS_SUPPORT:
                flds.append(make_field(order.modelCode))

            # institutional short saleslot data (srv v18 and above)
            flds += [
                make_field(
                    order.shortSaleSlot
                ),  # 0 for retail, 1 or 2 for institutions
                make_field(order.designatedLocation),
            ]  # populate only when shortSaleSlot = 2.
            if self.serverVersion() >= MIN_SERVER_VER_SSHORTX_OLD:
                flds.append(make_field(order.exemptCode))

            # srv v19 and above fields
            flds.append(make_field(order.ocaType))
            # if( self.serverVersion() < 38) {
            # will never happen
            #      send( /* order.rthOnly */ false)
            # }
            flds += [
                make_field(order.rule80A),
                make_field(order.settlingFirm),
                make_field(order.allOrNone),
                make_field_handle_empty(order.minQty),
                make_field_handle_empty(order.percentOffset),
                make_field(False),
                make_field(False),
                make_field_handle_empty(UNSET_DOUBLE),
                make_field(
                    order.auctionStrategy
                ),  # AUCTION_MATCH, AUCTION_IMPROVEMENT, AUCTION_TRANSPARENT
                make_field_handle_empty(order.startingPrice),
                make_field_handle_empty(order.stockRefPrice),
                make_field_handle_empty(order.delta),
                make_field_handle_empty(order.stockRangeLower),
                make_field_handle_empty(order.stockRangeUpper),
                make_field(order.overridePercentageConstraints),  # srv v22 and above
                # Volatility orders (srv v26 and above)
                make_field_handle_empty(order.volatility),
                make_field_handle_empty(order.volatilityType),
                make_field(order.deltaNeutralOrderType),  # srv v28 and above
                make_field_handle_empty(order.deltaNeutralAuxPrice),
            ]  # srv v28 and above

            if (
                self.serverVersion() >= MIN_SERVER_VER_DELTA_NEUTRAL_CONID
                and order.deltaNeutralOrderType
            ):
                flds += [
                    make_field(order.deltaNeutralConId),
                    make_field(order.deltaNeutralSettlingFirm),
                    make_field(order.deltaNeutralClearingAccount),
                    make_field(order.deltaNeutralClearingIntent),
                ]

            if (
                self.serverVersion() >= MIN_SERVER_VER_DELTA_NEUTRAL_OPEN_CLOSE
                and order.deltaNeutralOrderType
            ):
                flds += [
                    make_field(order.deltaNeutralOpenClose),
                    make_field(order.deltaNeutralShortSale),
                    make_field(order.deltaNeutralShortSaleSlot),
                    make_field(order.deltaNeutralDesignatedLocation),
                ]

            flds += [
                make_field(order.continuousUpdate),
                make_field_handle_empty(order.referencePriceType),
                make_field_handle_empty(order.trailStopPrice),
            ]  # srv v30 and above

            if self.serverVersion() >= MIN_SERVER_VER_TRAILING_PERCENT:
                flds.append(make_field_handle_empty(order.trailingPercent))

            # SCALE orders
            if self.serverVersion() >= MIN_SERVER_VER_SCALE_ORDERS2:
                flds += [
                    make_field_handle_empty(order.scaleInitLevelSize),
                    make_field_handle_empty(order.scaleSubsLevelSize),
                ]
            else:
                # srv v35 and above)
                flds += [
                    make_field(""),  # for not supported scaleNumComponents
                    make_field_handle_empty(order.scaleInitLevelSize),
                ]  # for scaleComponentSize

            flds.append(make_field_handle_empty(order.scalePriceIncrement))

            if (
                self.serverVersion() >= MIN_SERVER_VER_SCALE_ORDERS3
                and order.scalePriceIncrement != UNSET_DOUBLE
                and order.scalePriceIncrement > 0.0
            ):
                flds += [
                    make_field_handle_empty(order.scalePriceAdjustValue),
                    make_field_handle_empty(order.scalePriceAdjustInterval),
                    make_field_handle_empty(order.scaleProfitOffset),
                    make_field(order.scaleAutoReset),
                    make_field_handle_empty(order.scaleInitPosition),
                    make_field_handle_empty(order.scaleInitFillQty),
                    make_field(order.scaleRandomPercent),
                ]

            if self.serverVersion() >= MIN_SERVER_VER_SCALE_TABLE:
                flds += [
                    make_field(order.scaleTable),
                    make_field(order.activeStartTime),
                    make_field(order.activeStopTime),
                ]

            # HEDGE orders
            if self.serverVersion() >= MIN_SERVER_VER_HEDGE_ORDERS:
                flds.append(make_field(order.hedgeType))
                if order.hedgeType:
                    flds.append(make_field(order.hedgeParam))

            if self.serverVersion() >= MIN_SERVER_VER_OPT_OUT_SMART_ROUTING:
                flds.append(make_field(order.optOutSmartRouting))

            if self.serverVersion() >= MIN_SERVER_VER_PTA_ORDERS:
                flds += [
                    make_field(order.clearingAccount),
                    make_field(order.clearingIntent),
                ]

            if self.serverVersion() >= MIN_SERVER_VER_NOT_HELD:
                flds.append(make_field(order.notHeld))

            if self.serverVersion() >= MIN_SERVER_VER_DELTA_NEUTRAL:
                if contract.deltaNeutralContract:
                    flds += [
                        make_field(True),
                        make_field(contract.deltaNeutralContract.conId),
                        make_field(contract.deltaNeutralContract.delta),
                        make_field(contract.deltaNeutralContract.price),
                    ]
                else:
                    flds.append(make_field(False))

            if self.serverVersion() >= MIN_SERVER_VER_ALGO_ORDERS:
                flds.append(make_field(order.algoStrategy))
                if order.algoStrategy:
                    algoParamsCount = len(order.algoParams) if order.algoParams else 0
                    flds.append(make_field(algoParamsCount))
                    if algoParamsCount > 0:
                        for algoParam in order.algoParams:
                            flds += [
                                make_field(algoParam.tag),
                                make_field(algoParam.value),
                            ]

            if self.serverVersion() >= MIN_SERVER_VER_ALGO_ID:
                flds.append(make_field(order.algoId))

            flds.append(make_field(order.whatIf))  # srv v36 and above

            # send miscOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                miscOptionsStr = ""
                if order.orderMiscOptions:
                    for tagValue in order.orderMiscOptions:
                        miscOptionsStr += str(tagValue)
                flds.append(make_field(miscOptionsStr))

            if self.serverVersion() >= MIN_SERVER_VER_ORDER_SOLICITED:
                flds.append(make_field(order.solicited))

            if self.serverVersion() >= MIN_SERVER_VER_RANDOMIZE_SIZE_AND_PRICE:
                flds += [
                    make_field(order.randomizeSize),
                    make_field(order.randomizePrice),
                ]

            if self.serverVersion() >= MIN_SERVER_VER_PEGGED_TO_BENCHMARK:
                if isPegBenchOrder(order.orderType):
                    flds += [
                        make_field(order.referenceContractId),
                        make_field(order.isPeggedChangeAmountDecrease),
                        make_field(order.peggedChangeAmount),
                        make_field(order.referenceChangeAmount),
                        make_field(order.referenceExchangeId),
                    ]

                flds.append(make_field(len(order.conditions)))

                if len(order.conditions) > 0:
                    for cond in order.conditions:
                        flds.append(make_field(cond.type()))
                        flds += cond.make_fields()

                    flds += [
                        make_field(order.conditionsIgnoreRth),
                        make_field(order.conditionsCancelOrder),
                    ]

                flds += [
                    make_field(order.adjustedOrderType),
                    make_field(order.triggerPrice),
                    make_field(order.lmtPriceOffset),
                    make_field(order.adjustedStopPrice),
                    make_field(order.adjustedStopLimitPrice),
                    make_field(order.adjustedTrailingAmount),
                    make_field(order.adjustableTrailingUnit),
                ]

            if self.serverVersion() >= MIN_SERVER_VER_EXT_OPERATOR:
                flds.append(make_field(order.extOperator))

            if self.serverVersion() >= MIN_SERVER_VER_SOFT_DOLLAR_TIER:
                flds += [
                    make_field(order.softDollarTier.name),
                    make_field(order.softDollarTier.val),
                ]

            if self.serverVersion() >= MIN_SERVER_VER_CASH_QTY:
                flds.append(make_field(order.cashQty))

            if self.serverVersion() >= MIN_SERVER_VER_DECISION_MAKER:
                flds.append(make_field(order.mifid2DecisionMaker))
                flds.append(make_field(order.mifid2DecisionAlgo))

            if self.serverVersion() >= MIN_SERVER_VER_MIFID_EXECUTION:
                flds.append(make_field(order.mifid2ExecutionTrader))
                flds.append(make_field(order.mifid2ExecutionAlgo))

            if self.serverVersion() >= MIN_SERVER_VER_AUTO_PRICE_FOR_HEDGE:
                flds.append(make_field(order.dontUseAutoPriceForHedge))

            if self.serverVersion() >= MIN_SERVER_VER_ORDER_CONTAINER:
                flds.append(make_field(order.isOmsContainer))

            if self.serverVersion() >= MIN_SERVER_VER_D_PEG_ORDERS:
                flds.append(make_field(order.discretionaryUpToLimitPrice))

            if self.serverVersion() >= MIN_SERVER_VER_PRICE_MGMT_ALGO:
                flds.append(
                    make_field_handle_empty(
                        UNSET_INTEGER
                        if order.usePriceMgmtAlgo is None
                        else 1
                        if order.usePriceMgmtAlgo
                        else 0
                    )
                )

            if self.serverVersion() >= MIN_SERVER_VER_DURATION:
                flds.append(make_field(order.duration))

            if self.serverVersion() >= MIN_SERVER_VER_POST_TO_ATS:
                flds.append(make_field(order.postToAts))

            if self.serverVersion() >= MIN_SERVER_VER_AUTO_CANCEL_PARENT:
                flds.append(make_field(order.autoCancelParent))

            if self.serverVersion() >= MIN_SERVER_VER_ADVANCED_ORDER_REJECT:
                flds.append(make_field(order.advancedErrorOverride))

            if self.serverVersion() >= MIN_SERVER_VER_MANUAL_ORDER_TIME:
                flds.append(make_field(order.manualOrderTime))

            if self.serverVersion() >= MIN_SERVER_VER_PEGBEST_PEGMID_OFFSETS:
                sendMidOffsets = False
                if contract.exchange == "IBKRATS":
                    flds.append(make_field_handle_empty(order.minTradeQty))
                if isPegBestOrder(order.orderType):
                    flds.append(make_field_handle_empty(order.minCompeteSize))
                    flds.append(make_field_handle_empty(order.competeAgainstBestOffset))
                    if (
                        order.competeAgainstBestOffset
                        == COMPETE_AGAINST_BEST_OFFSET_UP_TO_MID
                    ):
                        sendMidOffsets = True
                elif isPegMidOrder(order.orderType):
                    sendMidOffsets = True
                if sendMidOffsets:
                    flds.append(make_field_handle_empty(order.midOffsetAtWhole))
                    flds.append(make_field_handle_empty(order.midOffsetAtHalf))

            if self.serverVersion() >= MIN_SERVER_VER_CUSTOMER_ACCOUNT:
                flds.append(make_field(order.customerAccount))

            if self.serverVersion() >= MIN_SERVER_VER_PROFESSIONAL_CUSTOMER:
                flds.append(make_field(order.professionalCustomer))

            if self.serverVersion() >= MIN_SERVER_VER_RFQ_FIELDS and self.serverVersion() < MIN_SERVER_VER_UNDO_RFQ_FIELDS:
                flds.append(make_field(""))
                flds.append(make_field(UNSET_INTEGER))

            if self.serverVersion() >= MIN_SERVER_VER_INCLUDE_OVERNIGHT:
                flds.append(make_field(order.includeOvernight))

            if self.serverVersion() >= MIN_SERVER_VER_CME_TAGGING_FIELDS:
                flds.append(make_field(order.manualOrderIndicator))

            if self.serverVersion() >= MIN_SERVER_VER_IMBALANCE_ONLY:
                flds.append(make_field(order.imbalanceOnly))

            msg = "".join(flds)
            self.sendMsg(OUT.PLACE_ORDER, msg)

        except ClientException as ex:
            self.wrapper.error(orderId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(orderId, currentTimeMillis(), FAIL_SEND_ORDER.code(), FAIL_SEND_ORDER.msg() + str(ex))
            return

    def placeOrderProtoBuf(self, placeOrderRequestProto: PlaceOrderRequestProto):
        if placeOrderRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        orderId = placeOrderRequestProto.orderId if placeOrderRequestProto.HasField('orderId') else 0

        if not self.isConnected():
            self.wrapper.error(orderId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if placeOrderRequestProto.HasField('order'):
            wrongParam = self.validateOrderParameters(placeOrderRequestProto.order)
            if wrongParam is not None:
                self.wrapper.error(orderId, currentTimeMillis(),
                                   UPDATE_TWS.code(), UPDATE_TWS.msg() + " The following order parameter is not supported by your TWS version - " + wrongParam)
                return

        if placeOrderRequestProto.HasField('attachedOrders'):
            wrongParam = self.validateAttachedOrdersParameters(placeOrderRequestProto.attachedOrders)
            if wrongParam is not None:
                self.wrapper.error(orderId, currentTimeMillis(),
                                   UPDATE_TWS.code(), UPDATE_TWS.msg() + " The following attached orders parameter is not supported by your TWS version - " + wrongParam)
                return

        try:
            serializedString = placeOrderRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.PLACE_ORDER + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(orderId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(orderId, currentTimeMillis(), FAIL_SEND_ORDER.code(), FAIL_SEND_ORDER.msg() + str(ex))
            return

    def validateOrderParameters(self, order) -> str | None:
        if self.serverVersion() < MIN_SERVER_VER_ADDITIONAL_ORDER_PARAMS_1:
            if order.HasField('deactivate'):
                return "deactivate"

            if order.HasField('postOnly'):
                return "postOnly"

            if order.HasField('allowPreOpen'):
                return "allowPreOpen"

            if order.HasField('ignoreOpenAuction'):
                return "ignoreOpenAuction"

        if self.serverVersion() < MIN_SERVER_VER_ADDITIONAL_ORDER_PARAMS_2:
            if order.HasField('routeMarketableToBbo'):
                return "routeMarketableToBbo"

            if order.HasField('seekPriceImprovement'):
                return "seekPriceImprovement"

            if order.HasField('whatIfType'):
                return "whatIfType"
        return None

    def validateAttachedOrdersParameters(self, attachedOrders: AttachedOrdersProto) -> str | None:
        if self.serverVersion() < MIN_SERVER_VER_ATTACHED_ORDERS:
            if attachedOrders.HasField('slOrderId'):
                return "slOrderId"
            if attachedOrders.HasField('slOrderType'):
                return "slOrderType"
            if attachedOrders.HasField('ptOrderId'):
                return "ptOrderId"
            if attachedOrders.HasField('ptOrderType'):
                return "ptOrderType"
        return None

    def cancelOrder(self, orderId: OrderId, orderCancel: OrderCancel):
        """Call this function to cancel an order.

        orderId:OrderId - The order ID that was specified previously in the call
            to placeOrder()"""

        if (self.useProtoBuf(OUT.CANCEL_ORDER)):
            cancelOrderRequestProto = createCancelOrderRequestProto(orderId, orderCancel)
            self.cancelOrderProtoBuf(cancelOrderRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_MANUAL_ORDER_TIME
            and orderCancel.manualOrderCancelTime
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support manual order cancel time attribute",
            )
            return

        if self.serverVersion() < MIN_SERVER_VER_CME_TAGGING_FIELDS and (
            orderCancel.extOperator != "" or orderCancel.manualOrderIndicator != UNSET_INTEGER
        ):
            self.wrapper.error(
                orderId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support ext operator and manual order indicator parameters",
            )
            return

        try:
            VERSION = 1

            flds = []
            if self.serverVersion() < MIN_SERVER_VER_CME_TAGGING_FIELDS:
                flds += [make_field(VERSION)]
            flds += [make_field(orderId)]

            if self.serverVersion() >= MIN_SERVER_VER_MANUAL_ORDER_TIME:
                flds += [make_field(orderCancel.manualOrderCancelTime)]

            if self.serverVersion() >= MIN_SERVER_VER_RFQ_FIELDS and self.serverVersion() < MIN_SERVER_VER_UNDO_RFQ_FIELDS:
                flds += [make_field("")]
                flds += [make_field("")]
                flds += [make_field(UNSET_INTEGER)]

            if self.serverVersion() >= MIN_SERVER_VER_CME_TAGGING_FIELDS:
                flds += [make_field(orderCancel.extOperator)]
                flds += [make_field(orderCancel.manualOrderIndicator)]

            msg = "".join(flds)
            self.sendMsg(OUT.CANCEL_ORDER, msg)

        except ClientException as ex:
            self.wrapper.error(orderId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(orderId, currentTimeMillis(), FAIL_SEND_CORDER.code(), FAIL_SEND_CORDER.msg() + str(ex))
            return

    def cancelOrderProtoBuf(self, cancelOrderRequestProto: CancelOrderRequestProto):
        if cancelOrderRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        orderId = cancelOrderRequestProto.orderId if cancelOrderRequestProto.HasField('orderId') else 0

        if not self.isConnected():
            self.wrapper.error(orderId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelOrderRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_ORDER + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(orderId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(orderId, currentTimeMillis(), FAIL_SEND_CORDER.code(), FAIL_SEND_CORDER.msg() + str(ex))
            return

    def reqOpenOrders(self):
        """Call this function to request the open orders that were
        placed from this client. Each open order will be fed back through the
        openOrder() and orderStatus() functions on the EWrapper.

        Note:  The client with a clientId of 0 will also receive the TWS-owned
        open orders. These orders will be associated with the client and a new
        orderId will be generated. This association will persist over multiple
        API and TWS sessions."""

        if (self.useProtoBuf(OUT.REQ_OPEN_ORDERS)):
            openOrdersRequestProto = createOpenOrdersRequestProto()
            self.reqOpenOrdersProtoBuf(openOrdersRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = make_field(VERSION)

            self.sendMsg(OUT.REQ_OPEN_ORDERS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_OORDER.code(), FAIL_SEND_OORDER.msg() + str(ex))
            return

    def reqOpenOrdersProtoBuf(self, openOrdersRequestProto: OpenOrdersRequestProto):
        if openOrdersRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = openOrdersRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_OPEN_ORDERS + PROTOBUF_MSG_ID, serializedString)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_OORDER.code(), FAIL_SEND_OORDER.msg() + str(ex))
            return

    def reqAutoOpenOrders(self, bAutoBind: bool):
        """Call this function to request that newly created TWS orders
        be implicitly associated with the client. When a new TWS order is
        created, the order will be associated with the client, and fed back
        through the openOrder() and orderStatus() functions on the EWrapper.

        Note:  This request can only be made from a client with clientId of 0.

        bAutoBind: If set to TRUE, newly created TWS orders will be implicitly
        associated with the client. If set to FALSE, no association will be
        made."""

        if (self.useProtoBuf(OUT.REQ_AUTO_OPEN_ORDERS)):
            autoOpenOrdersRequestProto = createAutoOpenOrdersRequestProto(bAutoBind)
            self.reqAutoOpenOrdersProtoBuf(autoOpenOrdersRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(bAutoBind)
            )
            self.sendMsg(OUT.REQ_AUTO_OPEN_ORDERS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_OORDER.code(), FAIL_SEND_OORDER.msg() + str(ex))
            return

    def reqAutoOpenOrdersProtoBuf(self, autoOpenOrdersRequestProto: AutoOpenOrdersRequestProto):
        if autoOpenOrdersRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = autoOpenOrdersRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_AUTO_OPEN_ORDERS + PROTOBUF_MSG_ID, serializedString)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_OORDER.code(), FAIL_SEND_OORDER.msg() + str(ex))
            return

    def reqAllOpenOrders(self):
        """Call this function to request the open orders placed from all
        clients and also from TWS. Each open order will be fed back through the
        openOrder() and orderStatus() functions on the EWrapper.

        Note:  No association is made between the returned orders and the
        requesting client."""

        if (self.useProtoBuf(OUT.REQ_ALL_OPEN_ORDERS)):
            allOpenOrdersRequestProto = createAllOpenOrdersRequestProto()
            self.reqAllOpenOrdersProtoBuf(allOpenOrdersRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = make_field(VERSION)
            self.sendMsg(OUT.REQ_ALL_OPEN_ORDERS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_OORDER.code(), FAIL_SEND_OORDER.msg() + str(ex))
            return

    def reqAllOpenOrdersProtoBuf(self, allOpenOrdersRequestProto: AllOpenOrdersRequestProto):
        if allOpenOrdersRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = allOpenOrdersRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_ALL_OPEN_ORDERS + PROTOBUF_MSG_ID, serializedString)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_OORDER.code(), FAIL_SEND_OORDER.msg() + str(ex))
            return

    def reqGlobalCancel(self, orderCancel: OrderCancel):
        """Use this function to cancel all open orders globally. It
        cancels both API and TWS open orders.

        If the order was created in TWS, it also gets canceled. If the order
        was initiated in the API, it also gets canceled."""

        if (self.useProtoBuf(OUT.REQ_GLOBAL_CANCEL)):
            globalCancelRequestProto = createGlobalCancelRequestProto(orderCancel)
            self.reqGlobalCancelProtoBuf(globalCancelRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_CME_TAGGING_FIELDS and (
            orderCancel.extOperator != "" or orderCancel.manualOrderIndicator != UNSET_INTEGER
        ):
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support ext operator and manual order indicator parameters",
            )
            return

        try:
            VERSION = 1

            flds = []
            if self.serverVersion() < MIN_SERVER_VER_CME_TAGGING_FIELDS:
                flds += [make_field(VERSION)]

            if self.serverVersion() >= MIN_SERVER_VER_CME_TAGGING_FIELDS:
                flds += [make_field(orderCancel.extOperator)]
                flds += [make_field(orderCancel.manualOrderIndicator)]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_GLOBAL_CANCEL, msg)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQGLOBALCANCEL.code(), FAIL_SEND_REQGLOBALCANCEL.msg() + str(ex))
            return

    def reqGlobalCancelProtoBuf(self, globalCancelRequestProto: GlobalCancelRequestProto):
        if globalCancelRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = globalCancelRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_GLOBAL_CANCEL + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQGLOBALCANCEL.code(), FAIL_SEND_REQGLOBALCANCEL.msg() + str(ex))
            return

    def reqIds(self, numIds: int):
        """Call this function to request from TWS the next valid ID that
        can be used when placing an order.  After calling this function, the
        nextValidId() event will be triggered, and the id returned is that next
        valid ID. That ID will reflect any autobinding that has occurred (which
        generates new IDs and increments the next valid ID therein).

        numIds:int - deprecated"""

        if (self.useProtoBuf(OUT.REQ_IDS)):
            idsRequestProto = createIdsRequestProto(numIds)
            self.reqIdsProtoBuf(idsRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = make_field(VERSION) + make_field(numIds)
            self.sendMsg(OUT.REQ_IDS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CORDER.code(), FAIL_SEND_CORDER.msg() + str(ex))
            return

    def reqIdsProtoBuf(self, idsRequestProto: IdsRequestProto):
        if idsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = idsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_IDS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CORDER.code(), FAIL_SEND_CORDER.msg() + str(ex))
            return

    #########################################################################
    # Account and Portfolio
    ########################################################################

    def reqAccountUpdates(self, subscribe: bool, acctCode: str):
        """Call this function to start getting account values, portfolio,
        and last update time information via EWrapper.updateAccountValue(),
        EWrapperi.updatePortfolio() and Wrapper.updateAccountTime().

        subscribe:bool - If set to TRUE, the client will start receiving account
            and Portfoliolio updates. If set to FALSE, the client will stop
            receiving this information.
        acctCode:str -The account code for which to receive account and
            portfolio updates."""

        if self.useProtoBuf(OUT.REQ_ACCT_DATA):
            self.reqAccountUpdatesProtoBuf(createAccountDataRequestProto(subscribe, acctCode))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 2

            flds = []
            flds += [
                make_field(VERSION),
                make_field(subscribe),  # TRUE = subscribe, FALSE = unsubscribe.
                make_field(acctCode),
            ]  # srv v9 and above, the account code. This will only be used for FA clients

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_ACCT_DATA, msg)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_ACCT.code(), FAIL_SEND_ACCT.msg() + str(ex))
            return

    def reqAccountUpdatesProtoBuf(self, accountDataRequestProto: AccountDataRequestProto):
        if accountDataRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = accountDataRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_ACCT_DATA + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_ACCT.code(), FAIL_SEND_ACCT.msg() + str(ex))
            return

    def reqAccountSummary(self, reqId: int, groupName: str, tags: str):
        """Call this method to request and keep up to date the data that appears
        on the TWS Account Window Summary tab. The data is returned by
        accountSummary().

        Note:   This request is designed for an FA managed account but can be
        used for any multi-account structure.

        reqId:int - The ID of the data request. Ensures that responses are matched
            to requests If several requests are in process.
        groupName:str - Set to All to returnrn account summary data for all
            accounts, or set to a specific Advisor Account Group name that has
            already been created in TWS Global Configuration.
        tags:str - A comma-separated list of account tags.  Available tags are:
            accountountType
            NetLiquidation,
            TotalCashValue - Total cash including futures pnl
            SettledCash - For cash accounts, this is the same as
            TotalCashValue
            AccruedCash - Net accrued interest
            BuyingPower - The maximum amount of marginable US stocks the
                account can buy
            EquityWithLoanValue - Cash + stocks + bonds + mutual funds
            PreviousDayEquityWithLoanValue,
            GrossPositionValue - The sum of the absolute value of all stock
                and equity option positions
            RegTEquity,
            RegTMargin,
            SMA - Special Memorandum Account
            InitMarginReq,
            MaintMarginReq,
            AvailableFunds,
            ExcessLiquidity,
            Cushion - Excess liquidity as a percentage of net liquidation value
            FullInitMarginReq,
            FullMaintMarginReq,
            FullAvailableFunds,
            FullExcessLiquidity,
            LookAheadNextChange - Time when look-ahead values take effect
            LookAheadInitMarginReq,
            LookAheadMaintMarginReq,
            LookAheadAvailableFunds,
            LookAheadExcessLiquidity,
            HighestSeverity - A measure of how close the account is to liquidation
            DayTradesRemaining - The Number of Open/Close trades a user
                could put on before Pattern Day Trading is detected. A value of "-1"
                means that the user can put on unlimited day trades.
            Leverage - GrossPositionValue / NetLiquidation
            $LEDGER - Single flag to relay all cash balance tags*, only in base
                currency.
            $LEDGER:CURRENCY - Single flag to relay all cash balance tags*, only in
                the specified currency.
            $LEDGER:ALL - Single flag to relay all cash balance tags* in all
            currencies."""

        if self.useProtoBuf(OUT.REQ_ACCOUNT_SUMMARY):
            self.reqAccountSummaryProtoBuf(createAccountSummaryRequestProto(reqId, groupName, tags))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
                + make_field(groupName)
                + make_field(tags)
            )
            self.sendMsg(OUT.REQ_ACCOUNT_SUMMARY, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQACCOUNTDATA.code(), FAIL_SEND_REQACCOUNTDATA.msg() + str(ex))
            return

    def reqAccountSummaryProtoBuf(self, accountSummaryRequestProto: AccountSummaryRequestProto):
        if accountSummaryRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = accountSummaryRequestProto.reqId if accountSummaryRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = accountSummaryRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_ACCOUNT_SUMMARY + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQACCOUNTDATA.code(), FAIL_SEND_REQACCOUNTDATA.msg() + str(ex))
            return

    def cancelAccountSummary(self, reqId: int):
        """Cancels the request for Account Window Summary tab data.

        reqId:int - The ID of the data request being canceled."""

        if self.useProtoBuf(OUT.CANCEL_ACCOUNT_SUMMARY):
            self.cancelAccountSummaryProtoBuf(createCancelAccountSummaryRequestProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )
            self.sendMsg(OUT.CANCEL_ACCOUNT_SUMMARY, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANACCOUNTDATA.code(), FAIL_SEND_CANACCOUNTDATA.msg() + str(ex))
            return

    def cancelAccountSummaryProtoBuf(self, cancelAccountSummaryProto: CancelAccountSummaryProto):
        if cancelAccountSummaryProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelAccountSummaryProto.reqId if cancelAccountSummaryProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelAccountSummaryProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_ACCOUNT_SUMMARY + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANACCOUNTDATA.code(), FAIL_SEND_CANACCOUNTDATA.msg() + str(ex))
            return

    def reqPositions(self):
        """Requests real-time position data for all accounts."""

        if self.useProtoBuf(OUT.REQ_POSITIONS):
            self.reqPositionsProtoBuf(createPositionsRequestProto())
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_POSITIONS:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support positions request.",
            )
            return

        try:
            VERSION = 1

            msg = make_field(VERSION)
            self.sendMsg(OUT.REQ_POSITIONS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQPOSITIONS.code(), FAIL_SEND_REQPOSITIONS.msg() + str(ex))
            return

    def reqPositionsProtoBuf(self, positionsRequestProto: PositionsRequestProto):
        if positionsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = positionsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_POSITIONS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQPOSITIONS.code(), FAIL_SEND_REQPOSITIONS.msg() + str(ex))
            return

    def cancelPositions(self):
        """Cancels real-time position updates."""

        if self.useProtoBuf(OUT.CANCEL_POSITIONS):
            self.cancelPositionsProtoBuf(createCancelPositionsRequestProto())
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_POSITIONS:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support positions request.",
            )
            return

        try:
            VERSION = 1

            msg = make_field(VERSION)

            self.sendMsg(OUT.CANCEL_POSITIONS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CANPOSITIONS.code(), FAIL_SEND_CANPOSITIONS.msg() + str(ex))
            return

    def cancelPositionsProtoBuf(self, cancelPositionsProto: CancelPositionsProto):
        if cancelPositionsProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelPositionsProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_POSITIONS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CANPOSITIONS.code(), FAIL_SEND_CANPOSITIONS.msg() + str(ex))
            return

    def reqPositionsMulti(self, reqId: int, account: str, modelCode: str):
        """Requests positions for account and/or model.
        Results are delivered via EWrapper.positionMulti() and
        EWrapper.positionMultiEnd()"""

        if self.useProtoBuf(OUT.REQ_POSITIONS_MULTI):
            self.reqPositionsMultiProtoBuf(createPositionsMultiRequestProto(reqId, account, modelCode))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_MODELS_SUPPORT:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support positions multi request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
                + make_field(account)
                + make_field(modelCode)
            )
            self.sendMsg(OUT.REQ_POSITIONS_MULTI, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQPOSITIONSMULTI.code(), FAIL_SEND_REQPOSITIONSMULTI.msg() + str(ex))
            return

    def reqPositionsMultiProtoBuf(self, positionsMultiRequestProto: PositionsMultiRequestProto):
        if positionsMultiRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = positionsMultiRequestProto.reqId if positionsMultiRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = positionsMultiRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_POSITIONS_MULTI + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQPOSITIONSMULTI.code(), FAIL_SEND_REQPOSITIONSMULTI.msg() + str(ex))
            return

    def cancelPositionsMulti(self, reqId: int):
        if self.useProtoBuf(OUT.CANCEL_POSITIONS_MULTI):
            self.cancelPositionsMultiProtoBuf(createCancelPositionsMultiRequestProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_MODELS_SUPPORT:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support cancel positions multi request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )
            self.sendMsg(OUT.CANCEL_POSITIONS_MULTI, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANPOSITIONSMULTI.code(), FAIL_SEND_CANPOSITIONSMULTI.msg() + str(ex))
            return

    def cancelPositionsMultiProtoBuf(self, cancelPositionsMultiProto: CancelPositionsMultiProto):
        if cancelPositionsMultiProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelPositionsMultiProto.reqId if cancelPositionsMultiProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelPositionsMultiProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_POSITIONS_MULTI + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANPOSITIONSMULTI.code(), FAIL_SEND_CANPOSITIONSMULTI.msg() + str(ex))
            return

    def reqAccountUpdatesMulti(
        self, reqId: int, account: str, modelCode: str, ledgerAndNLV: bool
    ):
        """Requests account updates for account and/or model."""

        if self.useProtoBuf(OUT.REQ_ACCOUNT_UPDATES_MULTI):
            self.reqAccountUpdatesMultiProtoBuf(createAccountUpdatesMultiRequestProto(reqId, account, modelCode, ledgerAndNLV))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_MODELS_SUPPORT:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support account updates multi request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
                + make_field(account)
                + make_field(modelCode)
                + make_field(ledgerAndNLV)
            )
            self.sendMsg(OUT.REQ_ACCOUNT_UPDATES_MULTI, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQACCOUNTUPDATESMULTI.code(), FAIL_SEND_REQACCOUNTUPDATESMULTI.msg() + str(ex))
            return

    def reqAccountUpdatesMultiProtoBuf(self, accountUpdatesMultiRequestProto: AccountUpdatesMultiRequestProto):
        if accountUpdatesMultiRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = accountUpdatesMultiRequestProto.reqId if accountUpdatesMultiRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = accountUpdatesMultiRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_ACCOUNT_UPDATES_MULTI + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQACCOUNTUPDATESMULTI.code(), FAIL_SEND_REQACCOUNTUPDATESMULTI.msg() + str(ex))
            return

    def cancelAccountUpdatesMulti(self, reqId: int):

        if self.useProtoBuf(OUT.CANCEL_ACCOUNT_UPDATES_MULTI):
            self.cancelAccountUpdatesMultiProtoBuf(createCancelAccountUpdatesMultiRequestProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_MODELS_SUPPORT:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support cancel account updates multi request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )
            self.sendMsg(OUT.CANCEL_ACCOUNT_UPDATES_MULTI, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANACCOUNTUPDATESMULTI.code(), FAIL_SEND_CANACCOUNTUPDATESMULTI.msg() + str(ex))
            return

    def cancelAccountUpdatesMultiProtoBuf(self, cancelAccountUpdatesMultiProto: CancelAccountUpdatesMultiProto):
        if cancelAccountUpdatesMultiProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelAccountUpdatesMultiProto.reqId if cancelAccountUpdatesMultiProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelAccountUpdatesMultiProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_ACCOUNT_UPDATES_MULTI + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANACCOUNTUPDATESMULTI.code(), FAIL_SEND_CANACCOUNTUPDATESMULTI.msg() + str(ex))
            return

    #########################################################################
    # Daily PnL
    #########################################################################

    def reqPnL(self, reqId: int, account: str, modelCode: str):
        if self.useProtoBuf(OUT.REQ_PNL):
            self.reqPnLProtoBuf(createPnLRequestProto(reqId, account, modelCode))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_PNL:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support PnL request.",
            )
            return

        try:
            msg = (
                make_field(reqId)
                + make_field(account)
                + make_field(modelCode)
            )
            self.sendMsg(OUT.REQ_PNL, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQPNL.code(), FAIL_SEND_REQPNL.msg() + str(ex))
            return

    def reqPnLProtoBuf(self, pnlRequestProto: PnLRequestProto):
        if pnlRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = pnlRequestProto.reqId if pnlRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = pnlRequestProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.REQ_PNL + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQPNL.code(), FAIL_SEND_REQPNL.msg() + str(ex))
            return

    def cancelPnL(self, reqId: int):
        if self.useProtoBuf(OUT.CANCEL_PNL):
            self.cancelPnLProtoBuf(createCancelPnLProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_PNL:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support PnL request.",
            )
            return

        try:
            msg = make_field(reqId)

            self.sendMsg(OUT.CANCEL_PNL, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCELPNL.code(), FAIL_SEND_CANCELPNL.msg() + str(ex))
            return

    def cancelPnLProtoBuf(self, cancelPnLProto: CancelPnLProto):
        if cancelPnLProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelPnLProto.reqId if cancelPnLProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelPnLProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.CANCEL_PNL + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCELPNL.code(), FAIL_SEND_CANCELPNL.msg() + str(ex))
            return

    def reqPnLSingle(self, reqId: int, account: str, modelCode: str, conid: int):
        if self.useProtoBuf(OUT.REQ_PNL_SINGLE):
            self.reqPnLSingleProtoBuf(createPnLSingleRequestProto(reqId, account, modelCode, conid))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_PNL:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support PnL request.",
            )
            return

        try:
            msg = (
                make_field(reqId)
                + make_field(account)
                + make_field(modelCode)
                + make_field(conid)
            )
            self.sendMsg(OUT.REQ_PNL_SINGLE, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQPNLSINGLE.code(), FAIL_SEND_REQPNLSINGLE.msg() + str(ex))
            return

    def reqPnLSingleProtoBuf(self, pnlSingleRequestProto: PnLSingleRequestProto):
        if pnlSingleRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = pnlSingleRequestProto.reqId if pnlSingleRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = pnlSingleRequestProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.REQ_PNL_SINGLE + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQPNLSINGLE.code(), FAIL_SEND_REQPNLSINGLE.msg() + str(ex))
            return

    def cancelPnLSingle(self, reqId: int):
        if self.useProtoBuf(OUT.CANCEL_PNL_SINGLE):
            self.cancelPnLSingleProtoBuf(createCancelPnLSingleProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_PNL:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support PnL request.",
            )
            return

        try:
            msg = make_field(reqId)
            self.sendMsg(OUT.CANCEL_PNL_SINGLE, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCELPNLSINGLE.code(), FAIL_SEND_CANCELPNLSINGLE.msg() + str(ex))
            return

    def cancelPnLSingleProtoBuf(self, cancelPnLSingleProto: CancelPnLSingleProto):
        if cancelPnLSingleProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelPnLSingleProto.reqId if cancelPnLSingleProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelPnLSingleProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.CANCEL_PNL_SINGLE + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCELPNLSINGLE.code(), FAIL_SEND_CANCELPNLSINGLE.msg() + str(ex))
            return

    #########################################################################
    # Executions
    #########################################################################

    def reqExecutions(self, reqId: int, execFilter: ExecutionFilter):
        """When this function is called, the execution reports that meet the
        filter criteria are downloaded to the client via the execDetails()
        function. To view executions beyond the past 24 hours, open the
        Trade Log in TWS and, while the Trade Log is displayed, request
        the executions again from the API.

        reqId:int - The ID of the data request. Ensures that responses are
            matched to requests if several requests are in process.
        execFilter:ExecutionFilter - This object contains attributes that
            describe the filter criteria used to determine which execution
            reports are returned.

        NOTE: Time format must be 'yyyymmdd-hh:mm:ss' Eg: '20030702-14:55'"""
        if (self.useProtoBuf(OUT.REQ_EXECUTIONS)):
            executionRequestProto = createExecutionRequestProto(reqId, execFilter)
            self.reqExecutionsProtoBuf(executionRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        
        if self.serverVersion() < MIN_SERVER_VER_PARAMETRIZED_DAYS_OF_EXECUTIONS:
            if (
                execFilter.lastNDays != UNSET_INTEGER
                or execFilter.specificDates is not None 
            ):
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support last N days and specific dates parameters",
                )
                return

        try:
            VERSION = 3

            # send req open orders msg
            flds = []
            flds += [make_field(VERSION)]

            if self.serverVersion() >= MIN_SERVER_VER_EXECUTION_DATA_CHAIN:
                flds += [
                    make_field(reqId),
                ]

            # Send the execution rpt filter data (srv v9 and above)
            flds += [
                make_field(execFilter.clientId),
                make_field(execFilter.acctCode),
                make_field(execFilter.time),
                make_field(execFilter.symbol),
                make_field(execFilter.secType),
                make_field(execFilter.exchange),
                make_field(execFilter.side),
            ]
            
            if self.serverVersion() >= MIN_SERVER_VER_PARAMETRIZED_DAYS_OF_EXECUTIONS:
                flds += [
                    make_field(execFilter.lastNDays),
                ]
                if execFilter.specificDates is not None :
                    flds += [
                        make_field(len(execFilter.specificDates)),
                    ]
                    for specificDate in execFilter.specificDates:
                        flds += [
                            make_field(specificDate),
                        ]
                else:
                    flds += [
                        make_field(0),
                    ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_EXECUTIONS, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_EXEC.code(), FAIL_SEND_EXEC.msg() + str(ex))
            return

    def reqExecutionsProtoBuf(self, executionRequestProto: ExecutionRequestProto):
        if executionRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = executionRequestProto.reqId if executionRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = executionRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_EXECUTIONS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_EXEC.code(), FAIL_SEND_EXEC.msg() + str(ex))
            return

    #########################################################################
    # Contract Details
    #########################################################################

    def reqContractDetails(self, reqId: int, contract: Contract):
        """Call this function to download all details for a particular
        underlying. The contract details will be received via the contractDetails()
        function on the EWrapper.

        reqId:int - The ID of the data request. Ensures that responses are
            make_fieldatched to requests if several requests are in process.
        contract:Contract - The summary description of the contract being looked
            up."""

        if (self.useProtoBuf(OUT.REQ_CONTRACT_DATA)):
            contractDataRequestProto = createContractDataRequestProto(reqId, contract)
            self.reqContractDataProtoBuf(contractDataRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_SEC_ID_TYPE:
            if contract.secIdType or contract.secId:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support secIdType and secId parameters.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support tradingClass parameter in reqContractDetails.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            if contract.primaryExchange:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support primaryExchange parameter in reqContractDetails.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_BOND_ISSUERID:
            if contract.issuerId:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support issuerId parameter in reqContractDetails.",
                )
                return

        try:
            VERSION = 8

            # send req mkt data msg
            flds = []
            flds += [make_field(VERSION)]

            if self.serverVersion() >= MIN_SERVER_VER_CONTRACT_DATA_CHAIN:
                flds += [
                    make_field(reqId),
                ]

            # send contract fields
            flds += [
                make_field(contract.conId),  # srv v37 and above
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
            ]  # srv v15 and above

            if self.serverVersion() >= MIN_SERVER_VER_PRIMARYEXCH:
                flds += [
                    make_field(contract.exchange),
                    make_field(contract.primaryExchange),
                ]
            elif self.serverVersion() >= MIN_SERVER_VER_LINKING:
                if contract.primaryExchange and (
                    contract.exchange == "BEST" or contract.exchange == "SMART"
                ):
                    flds += [
                        make_field(contract.exchange + ":" + contract.primaryExchange),
                    ]
                else:
                    flds += [
                        make_field(contract.exchange),
                    ]

            flds += [make_field(contract.currency), make_field(contract.localSymbol)]
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.tradingClass),
                ]
            flds += [
                make_field(contract.includeExpired),
            ]  # srv v31 and above

            if self.serverVersion() >= MIN_SERVER_VER_SEC_ID_TYPE:
                flds += [make_field(contract.secIdType), make_field(contract.secId)]

            if self.serverVersion() >= MIN_SERVER_VER_BOND_ISSUERID:
                flds += [
                    make_field(contract.issuerId),
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_CONTRACT_DATA, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQCONTRACT.code(), FAIL_SEND_REQCONTRACT.msg() + str(ex))
            return

    def reqContractDataProtoBuf(self, contractDataRequestProto: ContractDataRequestProto):
        if contractDataRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = contractDataRequestProto.reqId if contractDataRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = contractDataRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_CONTRACT_DATA + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQCONTRACT.code(), FAIL_SEND_REQCONTRACT.msg() + str(ex))
            return

    #########################################################################
    # Market Depth
    #########################################################################

    def reqMktDepthExchanges(self):
        if (self.useProtoBuf(OUT.REQ_MKT_DEPTH_EXCHANGES)):
            marketDepthExchangesRequestProto = createMarketDepthExchangesRequestProto()
            self.reqMarketDepthExchangesProtoBuf(marketDepthExchangesRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_MKT_DEPTH_EXCHANGES:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support market depth exchanges request.",
            )
            return

        try:
            self.sendMsg(OUT.REQ_MKT_DEPTH_EXCHANGES, "")
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQMKTDEPTHEXCHANGES.code(), FAIL_SEND_REQMKTDEPTHEXCHANGES.msg() + str(ex))
            return

    def reqMarketDepthExchangesProtoBuf(self, marketDepthExchangesRequestProto: MarketDepthExchangesRequestProto):
        if marketDepthExchangesRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = marketDepthExchangesRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_MKT_DEPTH_EXCHANGES + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQMKTDEPTHEXCHANGES.code(), FAIL_SEND_REQMKTDEPTHEXCHANGES.msg() + str(ex))
            return

    def reqMktDepth(
        self,
        reqId: TickerId,
        contract: Contract,
        numRows: int,
        isSmartDepth: bool,
        mktDepthOptions: TagValueList,
    ):
        """Call this function to request market depth for a specific
        contract. The market depth will be returned by the updateMktDepth() and
        updateMktDepthL2() events.

        Requests the contract's market depth (order book). Note this request must be
        direct-routed to an exchange and not smart-routed. The number of simultaneous
        market depth requests allowed in an account is calculated based on a formula
        that looks at an accounts' equity, commission and fees, and quote booster packs.

        reqId:TickerId - The ticker id. Must be a unique value. When the market
            depth data returns, it will be identified by this tag. This is
            also used when canceling the market depth
        contract:Contact - This structure contains a description of the contract
            for which market depth data is being requested.
        numRows:int - Specifies the numRowsumber of market depth rows to display.
        isSmartDepth:bool - specifies SMART depth request
        mktDepthOptions:TagValueList - For internal use only. Use default value
            XYZ."""

        if (self.useProtoBuf(OUT.REQ_MKT_DEPTH)):
            marketDepthRequestProto = createMarketDepthRequestProto(reqId, contract, numRows, isSmartDepth, mktDepthOptions)
            self.reqMarketDepthProtoBuf(marketDepthRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass or contract.conId > 0:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support conId and tradingClass parameters in reqMktDepth.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_SMART_DEPTH and isSmartDepth:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support SMART depth request.",
            )
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_MKT_DEPTH_PRIM_EXCHANGE
            and contract.primaryExchange
        ):
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + " It does not support primaryExchange parameter in reqMktDepth.",
            )
            return

        try:
            VERSION = 5

            # send req mkt depth msg
            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
            ]

            # send contract fields
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.conId),
                ]
            flds += [
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),  # srv v15 and above
                make_field(contract.exchange),
            ]
            if self.serverVersion() >= MIN_SERVER_VER_MKT_DEPTH_PRIM_EXCHANGE:
                flds += [
                    make_field(contract.primaryExchange),
                ]
            flds += [make_field(contract.currency), make_field(contract.localSymbol)]
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.tradingClass),
                ]

            flds += [
                make_field(numRows),
            ]  # srv v19 and above

            if self.serverVersion() >= MIN_SERVER_VER_SMART_DEPTH:
                flds += [
                    make_field(isSmartDepth),
                ]

            # send mktDepthOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                # current doc says this part if for "internal use only" -> won't support it
                if mktDepthOptions:
                    raise NotImplementedError("not supported")
                mktDataOptionsStr = ""
                flds += [
                    make_field(mktDataOptionsStr),
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_MKT_DEPTH, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQMKTDEPTH.code(), FAIL_SEND_REQMKTDEPTH.msg() + str(ex))
            return

    def reqMarketDepthProtoBuf(self, marketDepthRequestProto: MarketDepthRequestProto):
        if marketDepthRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = marketDepthRequestProto.reqId if marketDepthRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = marketDepthRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_MKT_DEPTH + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQMKTDEPTH.code(), FAIL_SEND_REQMKTDEPTH.msg() + str(ex))
            return

    def cancelMktDepth(self, reqId: TickerId, isSmartDepth: bool):
        """After calling this function, market depth data for the specified id
        will stop flowing.

        reqId:TickerId - The ID that was specified in the call to
            reqMktDepth().
        isSmartDepth:bool - specifies SMART depth request"""

        if (self.useProtoBuf(OUT.CANCEL_MKT_DEPTH)):
            cancelMarketDepthProto = createCancelMarketDepthProto(reqId, isSmartDepth)
            self.cancelMarketDepthProtoBuf(cancelMarketDepthProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_SMART_DEPTH and isSmartDepth:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support SMART depth cancel.",
            )
            return

        try:
            VERSION = 1

            # send cancel mkt depth msg
            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
            ]

            if self.serverVersion() >= MIN_SERVER_VER_SMART_DEPTH:
                flds += [make_field(isSmartDepth)]

            msg = "".join(flds)
            self.sendMsg(OUT.CANCEL_MKT_DEPTH, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANMKTDEPTH.code(), FAIL_SEND_CANMKTDEPTH.msg() + str(ex))
            return

    def cancelMarketDepthProtoBuf(self, cancelMarketDepthProto: CancelMarketDepthProto):
        if cancelMarketDepthProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelMarketDepthProto.reqId if cancelMarketDepthProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelMarketDepthProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_MKT_DEPTH + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANMKTDEPTH.code(), FAIL_SEND_CANMKTDEPTH.msg() + str(ex))
            return

    #########################################################################
    # News Bulletins
    #########################################################################

    def reqNewsBulletins(self, allMsgs: bool):
        """Call this function to start receiving news bulletins. Each bulletin
        will be returned by the updateNewsBulletin() event.

        allMsgs:bool - If set to TRUE, returns all the existing bulletins for
        the currencyent day and any new ones. If set to FALSE, will only
        return new bulletins."""

        if self.useProtoBuf(OUT.REQ_NEWS_BULLETINS):
            self.reqNewsBulletinsProtoBuf(createNewsBulletinsRequestProto(allMsgs))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(allMsgs)
            )

            self.sendMsg(OUT.REQ_NEWS_BULLETINS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CORDER.code(), FAIL_SEND_CORDER.msg() + str(ex))
            return

    def reqNewsBulletinsProtoBuf(self, newsBulletinsRequestProto: NewsBulletinsRequestProto):
        if newsBulletinsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = newsBulletinsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_NEWS_BULLETINS + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CORDER.code(), FAIL_SEND_CORDER.msg() + str(ex))
            return

    def cancelNewsBulletins(self):
        """Call this function to stop receiving news bulletins."""

        if self.useProtoBuf(OUT.CANCEL_NEWS_BULLETINS):
            self.cancelNewsBulletinsProtoBuf(createCancelNewsBulletinsProto())
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = make_field(VERSION)
            self.sendMsg(OUT.CANCEL_NEWS_BULLETINS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CORDER.code(), FAIL_SEND_CORDER.msg() + str(ex))
            return

    def cancelNewsBulletinsProtoBuf(self, cancelNewsBulletinsProto: CancelNewsBulletinsProto):
        if cancelNewsBulletinsProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelNewsBulletinsProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_NEWS_BULLETINS + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CORDER.code(), FAIL_SEND_CORDER.msg() + str(ex))
            return

    #########################################################################
    # Financial Advisors
    #########################################################################

    def reqManagedAccts(self):
        """Call this function to request the list of managed accounts. The list
        will be returned by the managedAccounts() function on the EWrapper.

        Note:  This request can only be made when connected to a FA managed account."""

        if self.useProtoBuf(OUT.REQ_MANAGED_ACCTS):
            self.reqManagedAcctsProtoBuf(createManagedAccountsRequestProto())
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = make_field(VERSION)
            return self.sendMsg(OUT.REQ_MANAGED_ACCTS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_OORDER.code(), FAIL_SEND_OORDER.msg() + str(ex))
            return

    def reqManagedAcctsProtoBuf(self, managedAccountsRequestProto: ManagedAccountsRequestProto):
        if managedAccountsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = managedAccountsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_MANAGED_ACCTS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_ACCT.code(), FAIL_SEND_ACCT.msg() + str(ex))
            return

    def requestFA(self, faData: FaDataType):
        """Call this function to request FA configuration information from TWS.
        The data returns in an XML string via a "receiveFA" ActiveX event.

        faData:FaDataType - Specifies the type of Financial Advisor
            configuration data beingingg requested. Valid values include:
            1 = GROUPS
            3 = ACCOUNT ALIASES"""

        if (self.useProtoBuf(OUT.REQ_FA)):
            faRequestProto = createFARequestProto(int(faData))
            self.reqFAProtoBuf(faRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() >= MIN_SERVER_VER_FA_PROFILE_DESUPPORT and faData == 2:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                FA_PROFILE_NOT_SUPPORTED.code(),
                FA_PROFILE_NOT_SUPPORTED.msg(),
            )
            return

        try:
            VERSION = 1

            msg = make_field(VERSION) + make_field(int(faData))
            return self.sendMsg(OUT.REQ_FA, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_FA_REQUEST.code(), FAIL_SEND_FA_REQUEST.msg() + str(ex))
            return

    def reqFAProtoBuf(self, faRequestProto: FARequestProto):
        if faRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = faRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_FA + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_FA_REQUEST.code(), FAIL_SEND_FA_REQUEST.msg() + str(ex))
            return

    def replaceFA(self, reqId: TickerId, faData: FaDataType, cxml: str):
        """Call this function to modify FA configuration information from the
        API. Note that this can also be done manually in TWS itself.

        reqId:TickerId - request id
        faData:FaDataType - Specifies the type of Financial Advisor
            configuration data beingingg requested. Valid values include:
            1 = GROUPS
            3 = ACCOUNT ALIASES
        cxml: str - The XML string containing the new FA configuration
            information."""

        if (self.useProtoBuf(OUT.REPLACE_FA)):
            faReplaceProto = createFAReplaceProto(reqId, int(faData), cxml)
            self.replaceFAProtoBuf(faReplaceProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() >= MIN_SERVER_VER_FA_PROFILE_DESUPPORT and faData == 2:
            self.wrapper.error(reqId, currentTimeMillis(), FA_PROFILE_NOT_SUPPORTED.code(), FA_PROFILE_NOT_SUPPORTED.msg())
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(int(faData))
                + make_field(cxml)
            )

            if self.serverVersion() >= MIN_SERVER_VER_REPLACE_FA_END:
                msg += make_field(reqId)
            return self.sendMsg(OUT.REPLACE_FA, msg)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_FA_REPLACE.code(), FAIL_SEND_FA_REPLACE.msg() + str(ex))
            return

    def replaceFAProtoBuf(self, faReplaceProto: FAReplaceProto):
        if faReplaceProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = faReplaceProto.reqId if faReplaceProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = faReplaceProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REPLACE_FA + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_FA_REPLACE.code(), FAIL_SEND_FA_REPLACE.msg() + str(ex))
            return

    #########################################################################
    # Historical Data
    #########################################################################

    def reqHistoricalData(
        self,
        reqId: TickerId,
        contract: Contract,
        endDateTime: str,
        durationStr: str,
        barSizeSetting: str,
        whatToShow: str,
        useRTH: int,
        formatDate: int,
        keepUpToDate: bool,
        chartOptions: TagValueList,
    ):
        """Requests contracts' historical data. When requesting historical data, a
        finishing time and date is required along with a duration string. The
        resulting bars will be returned in EWrapper.historicalData()

        reqId:TickerId - The id of the request. Must be a unique value. When the
            market data returns, it whatToShowill be identified by this tag. This is also
            used when canceling the market data.
        contract:Contract - This object contains a description of the contract for which
            market data is being requested.
        endDateTime:str - Defines a query end date and time at any point during the past 6 mos.
            Valid values include any date/time within the past six months in the format:
            yyyymmdd HH:mm:ss ttt

            where "ttt" is the optional time zone.
        durationStr:str - Set the query duration up to one week, using a time unit
            of seconds, days or weeks. Valid values include any integer followed by a space
            and then S (seconds), D (days) or W (week). If no unit is specified, seconds is used.
        barSizeSetting:str - Specifies the size of the bars that will be returned (within IB/TWS listimits).
            Valid values include:
            1 sec
            5 secs
            15 secs
            30 secs
            1 min
            2 mins
            3 mins
            4 mins
            5 mins
            15 mins
            30 mins
            1 hour
            1 day
        whatToShow:str - Determines the nature of data beinging extracted. Valid values include:

            TRADES
            MIDPOINT
            BID
            ASK
            BID_ASK
            HISTORICAL_VOLATILITY
            OPTION_IMPLIED_VOLATILITY
            SCHEDULE
        useRTH:int - Determines whether to return all data available during the requested time span,
            or only data that falls within regular trading hours. Valid values include:

            0 - all data is returned even where the market in question was outside its
            regular trading hours.
            1 - only data within the regular trading hours is returned, even if the
            requested time span falls partially or completely outside the RTH.
        formatDate: int - Determines the date format applied to returned bars. validd values include:

            1 - dates applying to bars returned in the format: yyyymmdd{space}{space}hh:mm:dd
            2 - dates are returned as a long integer specifying the number of seconds since
                1/1/1970 GMT.
        chartOptions:TagValueList - For internal use only. Use default value XYZ."""

        if self.useProtoBuf(OUT.REQ_HISTORICAL_DATA):
            historicalDataRequestProto = createHistoricalDataRequestProto(reqId, contract, endDateTime, durationStr, barSizeSetting, whatToShow, useRTH != 0, formatDate, keepUpToDate, chartOptions)
            self.reqHistoricalDataProtoBuf(historicalDataRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass or contract.conId > 0:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support conId and tradingClass parameters in reqHistoricalData.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_HISTORICAL_SCHEDULE:
            if whatToShow == "SCHEDULE":
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support requesting of historical schedule.",
                )
                return

        try:
            VERSION = 6

            # send req mkt data msg
            flds = []

            if self.serverVersion() < MIN_SERVER_VER_SYNT_REALTIME_BARS:
                flds += [
                    make_field(VERSION),
                ]

            flds += [
                make_field(reqId),
            ]

            # send contract fields
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.conId),
                ]
            flds += [
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
                make_field(contract.exchange),
                make_field(contract.primaryExchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
            ]
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.tradingClass),
                ]
            flds += [
                make_field(contract.includeExpired),  # srv v31 and above
                make_field(endDateTime),  # srv v20 and above
                make_field(barSizeSetting),  # srv v20 and above
                make_field(durationStr),
                make_field(useRTH),
                make_field(whatToShow),
                make_field(formatDate),
            ]  # srv v16 and above

            # Send combo legs for BAG requests
            if contract.secType == "BAG":
                flds += [
                    make_field(len(contract.comboLegs)),
                ]
                for comboLeg in contract.comboLegs:
                    flds += [
                        make_field(comboLeg.conId),
                        make_field(comboLeg.ratio),
                        make_field(comboLeg.action),
                        make_field(comboLeg.exchange),
                    ]

            if self.serverVersion() >= MIN_SERVER_VER_SYNT_REALTIME_BARS:
                flds += [
                    make_field(keepUpToDate),
                ]

            # send chartOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                chartOptionsStr = ""
                if chartOptions:
                    for tagValue in chartOptions:
                        chartOptionsStr += str(tagValue)
                flds += [
                    make_field(chartOptionsStr),
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_HISTORICAL_DATA, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQHISTDATA.code(), FAIL_SEND_REQHISTDATA.msg() + str(ex))
            return

    def reqHistoricalDataProtoBuf(self, historicalDataRequestProto: HistoricalDataRequestProto):
        if historicalDataRequestProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = historicalDataRequestProto.reqId if historicalDataRequestProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = historicalDataRequestProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.REQ_HISTORICAL_DATA + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQHISTDATA.code(), FAIL_SEND_REQHISTDATA.msg() + str(ex))
            return

    def cancelHistoricalData(self, reqId: TickerId):
        """Used if an internet disconnect has occurred or the results of a query
        are otherwise delayed and the application is no longer interested in receiving
        the data.

        reqId:TickerId - The ticker ID. Must be a unique value."""

        if self.useProtoBuf(OUT.CANCEL_HISTORICAL_DATA):
            cancelHistoricalDataProto = createCancelHistoricalDataProto(reqId)
            self.cancelHistoricalDataProtoBuf(cancelHistoricalDataProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )
            self.sendMsg(OUT.CANCEL_HISTORICAL_DATA, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANHISTDATA.code(), FAIL_SEND_CANHISTDATA.msg() + str(ex))
            return

    def cancelHistoricalDataProtoBuf(self, cancelHistoricalDataProto: CancelHistoricalDataProto):
        if cancelHistoricalDataProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = cancelHistoricalDataProto.reqId if cancelHistoricalDataProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = cancelHistoricalDataProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.CANCEL_HISTORICAL_DATA + PROTOBUF_MSG_ID, serializedString)
        
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANHISTDATA.code(), FAIL_SEND_CANHISTDATA.msg() + str(ex))
            return

    # Note that formatData parameter affects intraday bars only
    # 1-day bars always return with date in YYYYMMDD format

    def reqHeadTimeStamp(
        self,
        reqId: TickerId,
        contract: Contract,
        whatToShow: str,
        useRTH: int,
        formatDate: int,
    ):
        if self.useProtoBuf(OUT.REQ_HEAD_TIMESTAMP):
            headTimestampRequestProto = createHeadTimestampRequestProto(reqId, contract, whatToShow, useRTH != 0, formatDate)
            self.reqHeadTimestampProtoBuf(headTimestampRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_HEAD_TIMESTAMP:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support head time stamp requests.",
            )
            return

        try:
            flds = []
            flds += [
                make_field(reqId),
                make_field(contract.conId),
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
                make_field(contract.exchange),
                make_field(contract.primaryExchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
                make_field(contract.tradingClass),
                make_field(contract.includeExpired),
                make_field(useRTH),
                make_field(whatToShow),
                make_field(formatDate),
            ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_HEAD_TIMESTAMP, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQHEADTIMESTAMP.code(), FAIL_SEND_REQHEADTIMESTAMP.msg() + str(ex))
            return

    def reqHeadTimestampProtoBuf(self, headTimestampRequestProto: HeadTimestampRequestProto):
        if headTimestampRequestProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = headTimestampRequestProto.reqId if headTimestampRequestProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = headTimestampRequestProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.REQ_HEAD_TIMESTAMP + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQHEADTIMESTAMP.code(), FAIL_SEND_REQHEADTIMESTAMP.msg() + str(ex))
            return

    def cancelHeadTimeStamp(self, reqId: TickerId):
        if self.useProtoBuf(OUT.CANCEL_HEAD_TIMESTAMP):
            cancelHeadTimestampProto = createCancelHeadTimestampProto(reqId)
            self.cancelHeadTimestampProtoBuf(cancelHeadTimestampProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_CANCEL_HEADTIMESTAMP:
            self.wrapper.error(
                reqId,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support head time stamp requests.",
            )
            return

        flds = []
        try:
            flds += [make_field(reqId)]

            msg = "".join(flds)
            self.sendMsg(OUT.CANCEL_HEAD_TIMESTAMP, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_CANCELHEADTIMESTAMP.code(), FAIL_SEND_CANCELHEADTIMESTAMP.msg() + str(ex))
            return

    def cancelHeadTimestampProtoBuf(self, cancelHeadTimestampProto: CancelHeadTimestampProto):
        if cancelHeadTimestampProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = cancelHeadTimestampProto.reqId if cancelHeadTimestampProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = cancelHeadTimestampProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.CANCEL_HEAD_TIMESTAMP + PROTOBUF_MSG_ID, serializedString)
        
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCELHEADTIMESTAMP.code(), FAIL_SEND_CANCELHEADTIMESTAMP.msg() + str(ex))
            return

    def reqHistogramData(
        self, tickerId: int, contract: Contract, useRTH: bool, timePeriod: str
    ):
        if self.useProtoBuf(OUT.REQ_HISTOGRAM_DATA):
            histogramDataRequestProto = createHistogramDataRequestProto(tickerId, contract, useRTH, timePeriod)
            self.reqHistogramDataProtoBuf(histogramDataRequestProto )
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_HISTOGRAM:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support histogram requests..",
            )
            return

        try:
            flds = []
            flds += [
                make_field(tickerId),
                make_field(contract.conId),
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
                make_field(contract.exchange),
                make_field(contract.primaryExchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
                make_field(contract.tradingClass),
                make_field(contract.includeExpired),
                make_field(useRTH),
                make_field(timePeriod),
            ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_HISTOGRAM_DATA, msg)

        except ClientException as ex:
            self.wrapper.error(tickerId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(tickerId, currentTimeMillis(), FAIL_SEND_REQHISTOGRAMDATA.code(), FAIL_SEND_REQHISTOGRAMDATA.msg() + str(ex))
            return

    def reqHistogramDataProtoBuf(self, histogramDataRequestProto: HistogramDataRequestProto):
        if histogramDataRequestProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = histogramDataRequestProto.reqId if histogramDataRequestProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = histogramDataRequestProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.REQ_HISTOGRAM_DATA + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQHISTOGRAMDATA.code(), FAIL_SEND_REQHISTOGRAMDATA.msg() + str(ex))
            return

    def cancelHistogramData(self, tickerId: int):
        if self.useProtoBuf(OUT.CANCEL_HISTOGRAM_DATA):
            cancelHistogramDataProto = createCancelHistogramDataProto(tickerId)
            self.cancelHistogramDataProtoBuf(cancelHistogramDataProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_HISTOGRAM:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support histogram requests..",
            )
            return

        msg = make_field(tickerId)

        try:
            self.sendMsg(OUT.CANCEL_HISTOGRAM_DATA, msg)
        except Exception as ex:
            self.wrapper.error(tickerId, currentTimeMillis(), FAIL_SEND_CANCELHISTOGRAMDATA.code(), FAIL_SEND_CANCELHISTOGRAMDATA.msg() + str(ex))
            return

    def cancelHistogramDataProtoBuf(self, cancelHistogramDataProto: CancelHistogramDataProto):
        if cancelHistogramDataProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = cancelHistogramDataProto.reqId if cancelHistogramDataProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = cancelHistogramDataProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.CANCEL_HISTOGRAM_DATA + PROTOBUF_MSG_ID, serializedString)
        
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCELHISTOGRAMDATA.code(), FAIL_SEND_CANCELHISTOGRAMDATA.msg() + str(ex))
            return

    def reqHistoricalTicks(
        self,
        reqId: int,
        contract: Contract,
        startDateTime: str,
        endDateTime: str,
        numberOfTicks: int,
        whatToShow: str,
        useRth: int,
        ignoreSize: bool,
        miscOptions: TagValueList,
    ):
        if self.useProtoBuf(OUT.REQ_HISTORICAL_TICKS):
            historicalTicksRequestProto = createHistoricalTicksRequestProto(reqId, contract, startDateTime, endDateTime, numberOfTicks, whatToShow, useRth != 0, ignoreSize, miscOptions)
            self.reqHistoricalTicksProtoBuf(historicalTicksRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_HISTORICAL_TICKS:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support historical ticks requests..",
            )
            return

        try:
            flds = []
            flds += [
                make_field(reqId),
                make_field(contract.conId),
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
                make_field(contract.exchange),
                make_field(contract.primaryExchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
                make_field(contract.tradingClass),
                make_field(contract.includeExpired),
                make_field(startDateTime),
                make_field(endDateTime),
                make_field(numberOfTicks),
                make_field(whatToShow),
                make_field(useRth),
                make_field(ignoreSize),
            ]

            miscOptionsString = ""
            if miscOptions:
                for tagValue in miscOptions:
                    miscOptionsString += str(tagValue)
            flds += [
                make_field(miscOptionsString),
            ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_HISTORICAL_TICKS, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQHISTORICALTICKS.code(), FAIL_SEND_REQHISTORICALTICKS.msg() + str(ex))
            return

    def reqHistoricalTicksProtoBuf(self, historicalTicksRequestProto: HistoricalTicksRequestProto):
        if historicalTicksRequestProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = historicalTicksRequestProto.reqId if historicalTicksRequestProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = historicalTicksRequestProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.REQ_HISTORICAL_TICKS + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQHISTORICALTICKS.code(), FAIL_SEND_REQHISTORICALTICKS.msg() + str(ex))
            return

    #########################################################################
    # Market Scanners
    #########################################################################

    def reqScannerParameters(self):
        """Requests an XML string that describes all possible scanner queries."""
        if self.useProtoBuf(OUT.REQ_SCANNER_PARAMETERS):
            self.reqScannerParametersProtoBuf(createScannerParametersRequestProto())
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = make_field(VERSION)

            self.sendMsg(OUT.REQ_SCANNER_PARAMETERS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQSCANNERPARAMETERS.code(), FAIL_SEND_REQSCANNERPARAMETERS.msg() + str(ex))
            return

    def reqScannerParametersProtoBuf(self, scannerParametersRequestProto: ScannerParametersRequestProto):
        if scannerParametersRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = scannerParametersRequestProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.REQ_SCANNER_PARAMETERS + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQSCANNERPARAMETERS.code(), FAIL_SEND_REQSCANNERPARAMETERS.msg() + str(ex))
            return

    def reqScannerSubscription(
        self,
        reqId: int,
        subscription: ScannerSubscription,
        scannerSubscriptionOptions: TagValueList,
        scannerSubscriptionFilterOptions: TagValueList,
    ):
        """reqId:int - The ticker ID. Must be a unique value.
        scannerSubscription:ScannerSubscription - This structure contains
            possible parameters used to filter results.
        scannerSubscriptionOptions:TagValueList - For internal use only.
            Use default value XYZ."""

        if self.useProtoBuf(OUT.REQ_SCANNER_SUBSCRIPTION):
            self.reqScannerSubscriptionProtoBuf(createScannerSubscriptionRequestProto(reqId, subscription, scannerSubscriptionOptions, scannerSubscriptionFilterOptions))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if (
            self.serverVersion() < MIN_SERVER_VER_SCANNER_GENERIC_OPTS
            and scannerSubscriptionFilterOptions is not None
        ):
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + " It does not support API scanner subscription generic filter options",
            )
            return

        try:
            VERSION = 4

            flds = []

            if self.serverVersion() < MIN_SERVER_VER_SCANNER_GENERIC_OPTS:
                flds += [make_field(VERSION)]

            flds += [
                make_field(reqId),
                make_field_handle_empty(subscription.numberOfRows),
                make_field(subscription.instrument),
                make_field(subscription.locationCode),
                make_field(subscription.scanCode),
                make_field_handle_empty(subscription.abovePrice),
                make_field_handle_empty(subscription.belowPrice),
                make_field_handle_empty(subscription.aboveVolume),
                make_field_handle_empty(subscription.marketCapAbove),
                make_field_handle_empty(subscription.marketCapBelow),
                make_field(subscription.moodyRatingAbove),
                make_field(subscription.moodyRatingBelow),
                make_field(subscription.spRatingAbove),
                make_field(subscription.spRatingBelow),
                make_field(subscription.maturityDateAbove),
                make_field(subscription.maturityDateBelow),
                make_field_handle_empty(subscription.couponRateAbove),
                make_field_handle_empty(subscription.couponRateBelow),
                make_field(subscription.excludeConvertible),
                make_field_handle_empty(
                    subscription.averageOptionVolumeAbove
                ),  # srv v25 and above
                make_field(subscription.scannerSettingPairs),  # srv v25 and above
                make_field(subscription.stockTypeFilter),
            ]  # srv v27 and above

            # send scannerSubscriptionFilterOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_SCANNER_GENERIC_OPTS:
                scannerSubscriptionFilterOptionsStr = ""
                if scannerSubscriptionFilterOptions:
                    for tagValueOpt in scannerSubscriptionFilterOptions:
                        scannerSubscriptionFilterOptionsStr += str(tagValueOpt)
                flds += [make_field(scannerSubscriptionFilterOptionsStr)]

            # send scannerSubscriptionOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                scannerSubscriptionOptionsStr = ""
                if scannerSubscriptionOptions:
                    for tagValueOpt in scannerSubscriptionOptions:
                        scannerSubscriptionOptionsStr += str(tagValueOpt)
                flds += [
                    make_field(scannerSubscriptionOptionsStr),
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_SCANNER_SUBSCRIPTION, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQSCANNER.code(), FAIL_SEND_REQSCANNER.msg() + str(ex))
            return

    def reqScannerSubscriptionProtoBuf(self, scannerSubscriptionRequestProto: ScannerSubscriptionRequestProto):
        if scannerSubscriptionRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = scannerSubscriptionRequestProto.reqId if scannerSubscriptionRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = scannerSubscriptionRequestProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.REQ_SCANNER_SUBSCRIPTION + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQSCANNER.code(), FAIL_SEND_REQSCANNER.msg() + str(ex))
            return

    def cancelScannerSubscription(self, reqId: int):
        """reqId:int - The ticker ID. Must be a unique value."""

        if self.useProtoBuf(OUT.CANCEL_SCANNER_SUBSCRIPTION):
            self.cancelScannerSubscriptionProtoBuf(createCancelScannerSubscriptionProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )

            self.sendMsg(OUT.CANCEL_SCANNER_SUBSCRIPTION, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANSCANNER.code(), FAIL_SEND_CANSCANNER.msg() + str(ex))
            return

    def cancelScannerSubscriptionProtoBuf(self, cancelScannerSubscriptionProto: CancelScannerSubscriptionProto):
        if cancelScannerSubscriptionProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelScannerSubscriptionProto.reqId if cancelScannerSubscriptionProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelScannerSubscriptionProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.CANCEL_SCANNER_SUBSCRIPTION + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANSCANNER.code(), FAIL_SEND_CANSCANNER.msg() + str(ex))
            return

    #########################################################################
    # Real Time Bars
    #########################################################################

    def reqRealTimeBars(
        self,
        reqId: TickerId,
        contract: Contract,
        barSize: int,
        whatToShow: str,
        useRTH: bool,
        realTimeBarsOptions: TagValueList,
    ):
        """Call the reqRealTimeBars() function to start receiving real time bar
        results through the realtimeBar() EWrapper function.

        reqId:TickerId - The id for the request. Must be a unique value. When the
            data is received, it will be identified by this id. This is also
            used when canceling the request.
        contract:Contract - This object contains a description of the contract
            for which real time bars are being requested
        barSize:int - Currently only 5 second bars are supported, if any other
            value is used, an exception will be thrown.
        whatToShow:str - Determines the nature of the data extracted. Valid
            values include:
            TRADES
            BID
            ASK
            MIDPOINT
        useRTH:bool - Regular Trading Hours only. Valid values include:
            0 = all data available during the time span requested is returned,
                including time intervals when the market in question was
                outside of regular trading hours.
            1 = only data within the regular trading hours for the product
                requested is returned, even if the time span falls
                partially or completely outside.
        realTimeBarOptions:TagValueList - For internal use only. Use default value XYZ.
        """
        if self.useProtoBuf(OUT.REQ_REAL_TIME_BARS):
            realTimeBarsRequestProto = createRealTimeBarsRequestProto(reqId, contract, barSize, whatToShow, useRTH, realTimeBarsOptions)
            self.reqRealTimeBarsProtoBuf(realTimeBarsRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
            if contract.tradingClass:
                self.wrapper.error(
                    reqId,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support conId and tradingClass parameter in reqRealTimeBars.",
                )
                return

        try:
            VERSION = 3

            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
            ]

            # send contract fields
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.conId),
                ]
            flds += [
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.lastTradeDateOrContractMonth),
                make_field_handle_empty(contract.strike),
                make_field(contract.right),
                make_field(contract.multiplier),
                make_field(contract.exchange),
                make_field(contract.primaryExchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
            ]
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.tradingClass),
                ]
            flds += [make_field(barSize), make_field(whatToShow), make_field(useRTH)]

            # send realTimeBarsOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                realTimeBarsOptionsStr = ""
                if realTimeBarsOptions:
                    for tagValueOpt in realTimeBarsOptions:
                        realTimeBarsOptionsStr += str(tagValueOpt)
                flds += [
                    make_field(realTimeBarsOptionsStr),
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_REAL_TIME_BARS, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQRTBARS.code(), FAIL_SEND_REQRTBARS.msg() + str(ex))
            return

    def reqRealTimeBarsProtoBuf(self, realTimeBarsRequestProto: RealTimeBarsRequestProto):
        if realTimeBarsRequestProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = realTimeBarsRequestProto.reqId if realTimeBarsRequestProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = realTimeBarsRequestProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.REQ_REAL_TIME_BARS + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQRTBARS.code(), FAIL_SEND_REQRTBARS.msg() + str(ex))
            return

    def cancelRealTimeBars(self, reqId: TickerId):
        """Call the cancelRealTimeBars() function to stop receiving real time bar results.

        reqId:TickerId - The id that was specified in the call to reqRealTimeBars()."""

        if self.useProtoBuf(OUT.CANCEL_REAL_TIME_BARS):
            cancelRealTimeBarsProto = createCancelRealTimeBarsProto(reqId)
            self.cancelRealTimeBarsProtoBuf(cancelRealTimeBarsProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 1

            # send req mkt data msg
            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
            ]

            msg = "".join(flds)
            self.sendMsg(OUT.CANCEL_REAL_TIME_BARS, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANRTBARS.code(), FAIL_SEND_CANRTBARS.msg() + str(ex))
            return

    def cancelRealTimeBarsProtoBuf(self, cancelRealTimeBarsProto: CancelRealTimeBarsProto):
        if cancelRealTimeBarsProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = cancelRealTimeBarsProto.reqId if cancelRealTimeBarsProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return
        
        try:
            serializedString = cancelRealTimeBarsProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.CANCEL_REAL_TIME_BARS + PROTOBUF_MSG_ID, serializedString)
        
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANRTBARS.code(), FAIL_SEND_CANRTBARS.msg() + str(ex))
            return

    #########################################################################
    # Fundamental Data
    #########################################################################

    def reqFundamentalData(
        self,
        reqId: TickerId,
        contract: Contract,
        reportType: str,
        fundamentalDataOptions: TagValueList,
    ):
        """Call this function to receive fundamental data for
        stocks. The appropriate market data subscription must be set up in
        Account Management before you can receive this data.
        Fundamental data will be returned at EWrapper.fundamentalData().

        reqFundamentalData() can handle conid specified in the Contract object,
        but not tradingClass or multiplier. This is because reqFundamentalData()
        is used only for stocks and stocks do not have a multiplier and
        trading class.

        reqId:tickerId - The ID of the data request. Ensures that responses are
             matched to requests if several requests are in process.
        contract:Contract - This structure contains a description of the
            contract for which fundamental data is being requested.
        reportType:str - One of the following XML reports:
            ReportSnapshot (company overview)
            ReportsFinSummary (financial summary)
            ReportRatios (financial ratios)
            ReportsFinStatements (financial statements)
            RESC (analyst estimates)"""

        if self.useProtoBuf(OUT.REQ_FUNDAMENTAL_DATA):
            self.reqFundamentalsDataProtoBuf(createFundamentalsDataRequestProto(reqId, contract, reportType, fundamentalDataOptions))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            VERSION = 2

            if self.serverVersion() < MIN_SERVER_VER_FUNDAMENTAL_DATA:
                self.wrapper.error(
                    NO_VALID_ID,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support fundamental data request.",
                )
                return

            if self.serverVersion() < MIN_SERVER_VER_TRADING_CLASS:
                self.wrapper.error(
                    NO_VALID_ID,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + "  It does not support conId parameter in reqFundamentalData.",
                )
                return

            flds = []
            flds += [
                make_field(VERSION),
                make_field(reqId),
            ]

            # send contract fields
            if self.serverVersion() >= MIN_SERVER_VER_TRADING_CLASS:
                flds += [
                    make_field(contract.conId),
                ]
            flds += [
                make_field(contract.symbol),
                make_field(contract.secType),
                make_field(contract.exchange),
                make_field(contract.primaryExchange),
                make_field(contract.currency),
                make_field(contract.localSymbol),
                make_field(reportType),
            ]

            if self.serverVersion() >= MIN_SERVER_VER_LINKING:
                fundDataOptStr = ""
                tagValuesCount = (
                    len(fundamentalDataOptions) if fundamentalDataOptions else 0
                )
                if fundamentalDataOptions:
                    for fundDataOption in fundamentalDataOptions:
                        fundDataOptStr += str(fundDataOption)
                flds += [make_field(tagValuesCount), make_field(fundDataOptStr)]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_FUNDAMENTAL_DATA, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQFUNDDATA.code(), FAIL_SEND_REQFUNDDATA.msg() + str(ex))
            return

    def reqFundamentalsDataProtoBuf(self, fundamentalsDataRequestProto: FundamentalsDataRequestProto):
        if fundamentalsDataRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = fundamentalsDataRequestProto.reqId if fundamentalsDataRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = fundamentalsDataRequestProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.REQ_FUNDAMENTAL_DATA + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQFUNDDATA.code(), FAIL_SEND_REQFUNDDATA.msg() + str(ex))
            return

    def cancelFundamentalData(self, reqId: TickerId):
        """Call this function to stop receiving fundamental data.

        reqId:TickerId - The ID of the data request."""

        if self.useProtoBuf(OUT.CANCEL_FUNDAMENTAL_DATA):
            self.cancelFundamentalsDataProtoBuf(createCancelFundamentalsDataProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_FUNDAMENTAL_DATA:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support fundamental data request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )

            self.sendMsg(OUT.CANCEL_FUNDAMENTAL_DATA, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANFUNDDATA.code(), FAIL_SEND_CANFUNDDATA.msg() + str(ex))
            return

    def cancelFundamentalsDataProtoBuf(self, cancelFundamentalsDataProto: CancelFundamentalsDataProto):
        if cancelFundamentalsDataProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelFundamentalsDataProto.reqId if cancelFundamentalsDataProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelFundamentalsDataProto.SerializeToString()
            self.sendMsgProtoBuf(OUT.CANCEL_FUNDAMENTAL_DATA + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANFUNDDATA.code(), FAIL_SEND_CANFUNDDATA.msg() + str(ex))
            return

    ########################################################################
    # News
    #########################################################################

    def reqNewsProviders(self):
        if self.useProtoBuf(OUT.REQ_NEWS_PROVIDERS):
            self.reqNewsProvidersProtoBuf(createNewsProvidersRequestProto())
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_NEWS_PROVIDERS:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support news providers request.",
            )
            return

        try:
            self.sendMsg(OUT.REQ_NEWS_PROVIDERS, "")
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQNEWSPROVIDERS.code(), FAIL_SEND_REQNEWSPROVIDERS.msg() + str(ex))
            return

    def reqNewsProvidersProtoBuf(self, newsProvidersRequestProto: NewsProvidersRequestProto):
        if newsProvidersRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = newsProvidersRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_NEWS_PROVIDERS + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQNEWSPROVIDERS.code(), FAIL_SEND_REQNEWSPROVIDERS.msg() + str(ex))
            return

    def reqNewsArticle(
        self,
        reqId: int,
        providerCode: str,
        articleId: str,
        newsArticleOptions: TagValueList,
    ):
        if self.useProtoBuf(OUT.REQ_NEWS_ARTICLE):
            self.reqNewsArticleProtoBuf(createNewsArticleRequestProto(reqId, providerCode, articleId, newsArticleOptions))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_NEWS_ARTICLE:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support news article request.",
            )
            return

        try:
            flds = []

            flds += [
                make_field(reqId),
                make_field(providerCode),
                make_field(articleId),
            ]

            # send newsArticleOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_NEWS_QUERY_ORIGINS:
                newsArticleOptionsStr = ""
                if newsArticleOptions:
                    for tagValue in newsArticleOptions:
                        newsArticleOptionsStr += str(tagValue)
                flds += [
                    make_field(newsArticleOptionsStr),
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_NEWS_ARTICLE, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQNEWSARTICLE.code(), FAIL_SEND_REQNEWSARTICLE.msg() + str(ex))
            return

    def reqNewsArticleProtoBuf(self, newsArticleRequestProto: NewsArticleRequestProto):
        if newsArticleRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = newsArticleRequestProto.reqId if newsArticleRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = newsArticleRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_NEWS_ARTICLE + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQNEWSARTICLE.code(), FAIL_SEND_REQNEWSARTICLE.msg() + str(ex))
            return

    def reqHistoricalNews(
        self,
        reqId: int,
        conId: int,
        providerCodes: str,
        startDateTime: str,
        endDateTime: str,
        totalResults: int,
        historicalNewsOptions: TagValueList,
    ):
        if self.useProtoBuf(OUT.REQ_HISTORICAL_NEWS):
            self.reqHistoricalNewsProtoBuf(createHistoricalNewsRequestProto(reqId, conId, providerCodes, startDateTime, endDateTime, totalResults, historicalNewsOptions))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_HISTORICAL_NEWS:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support historical news request.",
            )
            return

        try:
            flds = []

            flds += [
                make_field(reqId),
                make_field(conId),
                make_field(providerCodes),
                make_field(startDateTime),
                make_field(endDateTime),
                make_field(totalResults),
            ]

            # send historicalNewsOptions parameter
            if self.serverVersion() >= MIN_SERVER_VER_NEWS_QUERY_ORIGINS:
                historicalNewsOptionsStr = ""
                if historicalNewsOptions:
                    for tagValue in historicalNewsOptions:
                        historicalNewsOptionsStr += str(tagValue)
                flds += [
                    make_field(historicalNewsOptionsStr),
                ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_HISTORICAL_NEWS, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQHISTORICALNEWS.code(), FAIL_SEND_REQHISTORICALNEWS.msg() + str(ex))
            return

    def reqHistoricalNewsProtoBuf(self, historicalNewsRequestProto: HistoricalNewsRequestProto):
        if historicalNewsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = historicalNewsRequestProto.reqId if historicalNewsRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = historicalNewsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_HISTORICAL_NEWS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQHISTORICALNEWS.code(), FAIL_SEND_REQHISTORICALNEWS.msg() + str(ex))
            return

    #########################################################################
    # Display Groups
    #########################################################################

    def queryDisplayGroups(self, reqId: int):
        """
        API requests used to integrate with TWS color-grouped windows (display groups).
        TWS color-grouped windows are identified by an integer number.
        Currently, that number ranges from 1 to 7 and are mapped to specific colors, as indicated in TWS.

        reqId:int - The unique number that will be associated with the
            response"""
        if (self.useProtoBuf(OUT.QUERY_DISPLAY_GROUPS)):
            queryDisplayGroupsRequestProto = createQueryDisplayGroupsRequestProto(reqId)
            self.queryDisplayGroupsProtoBuf(queryDisplayGroupsRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support queryDisplayGroups request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )
            self.sendMsg(OUT.QUERY_DISPLAY_GROUPS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_QUERYDISPLAYGROUPS.code(), FAIL_SEND_QUERYDISPLAYGROUPS.msg() + str(ex))
            return

    def queryDisplayGroupsProtoBuf(self, queryDisplayGroupsRequestProto: QueryDisplayGroupsRequestProto):
        if queryDisplayGroupsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = queryDisplayGroupsRequestProto.reqId if queryDisplayGroupsRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = queryDisplayGroupsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.QUERY_DISPLAY_GROUPS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_QUERYDISPLAYGROUPS.code(), FAIL_SEND_QUERYDISPLAYGROUPS.msg() + str(ex))
            return

    def subscribeToGroupEvents(self, reqId: int, groupId: int):
        """reqId:int - The unique number associated with the notification.
        groupId:int - The ID of the group, currently it is a number from 1 to 7.
            This is the display group subscription request sent by the API to TWS."""

        if (self.useProtoBuf(OUT.SUBSCRIBE_TO_GROUP_EVENTS)):
            subscribeToGroupEventsRequestProto = createSubscribeToGroupEventsRequestProto(reqId, groupId)
            self.subscribeToGroupEventsProtoBuf(subscribeToGroupEventsRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support subscribeToGroupEvents request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
                + make_field(groupId)
            )
            self.sendMsg(OUT.SUBSCRIBE_TO_GROUP_EVENTS, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_SUBSCRIBETOGROUPEVENTS.code(), FAIL_SEND_SUBSCRIBETOGROUPEVENTS.msg() + str(ex))
            return

    def subscribeToGroupEventsProtoBuf(self, subscribeToGroupEventsRequestProto: SubscribeToGroupEventsRequestProto):
        if subscribeToGroupEventsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = subscribeToGroupEventsRequestProto.reqId if subscribeToGroupEventsRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = subscribeToGroupEventsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.SUBSCRIBE_TO_GROUP_EVENTS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_SUBSCRIBETOGROUPEVENTS.code(), FAIL_SEND_SUBSCRIBETOGROUPEVENTS.msg() + str(ex))
            return

    def updateDisplayGroup(self, reqId: int, contractInfo: str):
        """reqId:int - The requestId specified in subscribeToGroupEvents().
        contractInfo:str - The encoded value that uniquely represents the
            contract in IB. Possible values include:

            none = empty selection
            contractID@exchange - any non-combination contract.
                Examples: 8314@SMART for IBM SMART; 8314@ARCA for IBM @ARCA.
            combo = if any combo is selected."""

        if (self.useProtoBuf(OUT.UPDATE_DISPLAY_GROUP)):
            updateDisplayGroupRequestProto = createUpdateDisplayGroupRequestProto(reqId, contractInfo)
            self.updateDisplayGroupProtoBuf(updateDisplayGroupRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support updateDisplayGroup request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
                + make_field(contractInfo)
            )
            self.sendMsg(OUT.UPDATE_DISPLAY_GROUP, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_UPDATEDISPLAYGROUP.code(), FAIL_SEND_UPDATEDISPLAYGROUP.msg() + str(ex))
            return

    def updateDisplayGroupProtoBuf(self, updateDisplayGroupRequestProto: UpdateDisplayGroupRequestProto):
        if updateDisplayGroupRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = updateDisplayGroupRequestProto.reqId if updateDisplayGroupRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = updateDisplayGroupRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.UPDATE_DISPLAY_GROUP + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_UPDATEDISPLAYGROUP.code(), FAIL_SEND_UPDATEDISPLAYGROUP.msg() + str(ex))
            return

    def unsubscribeFromGroupEvents(self, reqId: int):
        """reqId:int - The requestId specified in subscribeToGroupEvents()."""

        if (self.useProtoBuf(OUT.UNSUBSCRIBE_FROM_GROUP_EVENTS)):
            unsubscribeFromGroupEventsRequestProto = createUnsubscribeFromGroupEventsRequestProto(reqId)
            self.unsubscribeFromGroupEventsProtoBuf(unsubscribeFromGroupEventsRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support unsubscribeFromGroupEvents request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(reqId)
            )
            self.sendMsg(OUT.UNSUBSCRIBE_FROM_GROUP_EVENTS, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS.code(), FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS.msg() + str(ex))
            return

    def unsubscribeFromGroupEventsProtoBuf(self, unsubscribeFromGroupEventsRequestProto: UnsubscribeFromGroupEventsRequestProto):
        if unsubscribeFromGroupEventsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = unsubscribeFromGroupEventsRequestProto.reqId if unsubscribeFromGroupEventsRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = unsubscribeFromGroupEventsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.UNSUBSCRIBE_FROM_GROUP_EVENTS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS.code(), FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS.msg() + str(ex))
            return

    def verifyRequest(self, apiName: str, apiVersion: str):
        """For IB's internal purpose. Allows to provide means of verification
        between the TWS and third party programs."""
        if (self.useProtoBuf(OUT.VERIFY_REQUEST)):
            verifyRequestProto = createVerifyRequestProto(apiName, apiVersion)
            self.verifyRequestProtoBuf(verifyRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support verification request.",
            )
            return

        if not self.extraAuth:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                FAIL_SEND_VERIFYMESSAGE.code(),
                FAIL_SEND_VERIFYMESSAGE.msg()
                + "  Intent to authenticate needs to be expressed during initial connect request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(apiName)
                + make_field(apiVersion)
            )
            self.sendMsg(OUT.VERIFY_REQUEST, msg)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_VERIFYREQUEST.code(), FAIL_SEND_VERIFYREQUEST.msg() + str(ex))
            return

    def verifyRequestProtoBuf(self, verifyRequestProto: VerifyRequestProto):
        if verifyRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if not self.extraAuth:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_VERIFYREQUEST.code(), FAIL_SEND_VERIFYREQUEST.msg() + "  Intent to authenticate needs to be expressed during initial connect request.")
            return

        try:
            serializedString = verifyRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.VERIFY_REQUEST + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_VERIFYREQUEST.code(), FAIL_SEND_VERIFYREQUEST.msg() + str(ex))
            return

    def verifyMessage(self, apiData: str):
        """For IB's internal purpose. Allows to provide means of verification
        between the TWS and third party programs."""
        if (self.useProtoBuf(OUT.VERIFY_MESSAGE)):
            verifyMessageRequestProto = createVerifyMessageRequestProto(apiData)
            self.verifyMessageProtoBuf(verifyMessageRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support verification request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(apiData)
            )
            self.sendMsg(OUT.VERIFY_MESSAGE, msg)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_VERIFYMESSAGE.code(), FAIL_SEND_VERIFYMESSAGE.msg() + str(ex))
            return

    def verifyMessageProtoBuf(self, verifyMessageRequestProto: VerifyMessageRequestProto):
        if verifyMessageRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = verifyMessageRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.VERIFY_MESSAGE + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_VERIFYMESSAGE.code(), FAIL_SEND_VERIFYMESSAGE.msg() + str(ex))
            return

    def verifyAndAuthRequest(self, apiName: str, apiVersion: str, opaqueIsvKey: str):
        """For IB's internal purpose. Allows to provide means of verification
        between the TWS and third party programs."""

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support verification request.",
            )
            return

        if not self.extraAuth:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                FAIL_SEND_VERIFYANDAUTHREQUEST.code(),
                FAIL_SEND_VERIFYANDAUTHREQUEST.msg()
                + "  Intent to authenticate needs to be expressed during initial connect request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(apiName)
                + make_field(apiVersion)
                + make_field(opaqueIsvKey)
            )
            self.sendMsg(OUT.VERIFY_AND_AUTH_REQUEST, msg)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_VERIFYANDAUTHREQUEST.code(), FAIL_SEND_VERIFYANDAUTHREQUEST.msg() + str(ex))
            return

    def verifyAndAuthMessage(self, apiData: str, xyzResponse: str):
        """For IB's internal purpose. Allows to provide means of verification
        between the TWS and third party programs."""

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_LINKING:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support verification request.",
            )
            return

        try:
            VERSION = 1

            msg = (
                make_field(VERSION)
                + make_field(apiData)
                + make_field(xyzResponse)
            )
            self.sendMsg(OUT.VERIFY_AND_AUTH_MESSAGE, msg)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_VERIFYANDAUTHMESSAGE.code(), FAIL_SEND_VERIFYANDAUTHMESSAGE.msg() + str(ex))
            return

    def reqSecDefOptParams(
        self,
        reqId: int,
        underlyingSymbol: str,
        futFopExchange: str,
        underlyingSecType: str,
        underlyingConId: int,
    ):
        """Requests security definition option parameters for viewing a
        contract's option chain reqId the ID chosen for the request
        underlyingSymbol futFopExchange The exchange on which the returned
        options are trading. Can be set to the empty string "" for all
        exchanges. underlyingSecType The type of the underlying security,
        i.e. STK underlyingConId the contract ID of the underlying security.
        Response comes via EWrapper.securityDefinitionOptionParameter()"""

        if self.useProtoBuf(OUT.REQ_SEC_DEF_OPT_PARAMS):
            self.reqSecDefOptParamsProtoBuf(createSecDefOptParamsRequestProto(reqId, underlyingSymbol, futFopExchange, underlyingSecType, underlyingConId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_SEC_DEF_OPT_PARAMS_REQ:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg()
                + "  It does not support security definition option request.",
            )
            return

        try:
            flds = []
            flds += [
                make_field(reqId),
                make_field(underlyingSymbol),
                make_field(futFopExchange),
                make_field(underlyingSecType),
                make_field(underlyingConId),
            ]

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_SEC_DEF_OPT_PARAMS, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQSECDEFOPTPARAMS.code(), FAIL_SEND_REQSECDEFOPTPARAMS.msg() + str(ex))
            return

    def reqSecDefOptParamsProtoBuf(self, secDefOptParamsRequestProto: SecDefOptParamsRequestProto):
        if secDefOptParamsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = secDefOptParamsRequestProto.reqId if secDefOptParamsRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = secDefOptParamsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_SEC_DEF_OPT_PARAMS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQSECDEFOPTPARAMS.code(), FAIL_SEND_REQSECDEFOPTPARAMS.msg() + str(ex))
            return

    def reqSoftDollarTiers(self, reqId: int):
        """Requests pre-defined Soft Dollar Tiers. This is only supported for
        registered professional advisors and hedge and mutual funds who have
        configured Soft Dollar Tiers in Account Management."""

        if self.useProtoBuf(OUT.REQ_SOFT_DOLLAR_TIERS):
            self.reqSoftDollarTiersProtoBuf(createSoftDollarTiersRequestProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            msg = make_field(reqId)
            self.sendMsg(OUT.REQ_SOFT_DOLLAR_TIERS, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQSOFTDOLLARTIERS.code(), FAIL_SEND_REQSOFTDOLLARTIERS.msg() + str(ex))
            return

    def reqSoftDollarTiersProtoBuf(self, softDollarTiersRequestProto: SoftDollarTiersRequestProto):
        if softDollarTiersRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = softDollarTiersRequestProto.reqId if softDollarTiersRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = softDollarTiersRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_SOFT_DOLLAR_TIERS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQSOFTDOLLARTIERS.code(), FAIL_SEND_REQSOFTDOLLARTIERS.msg() + str(ex))
            return


    def reqFamilyCodes(self):
        if self.useProtoBuf(OUT.REQ_FAMILY_CODES):
            self.reqFamilyCodesProtoBuf(createFamilyCodesRequestProto())
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_FAMILY_CODES:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support family codes request.",
            )
            return

        try:
            self.sendMsg(OUT.REQ_FAMILY_CODES, "")
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQFAMILYCODES.code(), FAIL_SEND_REQFAMILYCODES.msg() + str(ex))
            return

    def reqFamilyCodesProtoBuf(self, familyCodesRequestProto: FamilyCodesRequestProto):
        if familyCodesRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = familyCodesRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_FAMILY_CODES + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQFAMILYCODES.code(), FAIL_SEND_REQFAMILYCODES.msg() + str(ex))
            return

    def reqMatchingSymbols(self, reqId: int, pattern: str):
        if self.useProtoBuf(OUT.REQ_MATCHING_SYMBOLS):
            self.reqMatchingSymbolsProtoBuf(createMatchingSymbolsRequestProto(reqId, pattern))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_REQ_MATCHING_SYMBOLS:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + "  It does not support matching symbols request.",
            )
            return

        try:
            msg = (
                make_field(reqId)
                + make_field(pattern)
            )
            self.sendMsg(OUT.REQ_MATCHING_SYMBOLS, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQMATCHINGSYMBOLS.code(), FAIL_SEND_REQMATCHINGSYMBOLS.msg() + str(ex))
            return

    def reqMatchingSymbolsProtoBuf(self, matchingSymbolsRequestProto: MatchingSymbolsRequestProto):
        if matchingSymbolsRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = matchingSymbolsRequestProto.reqId if matchingSymbolsRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = matchingSymbolsRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_MATCHING_SYMBOLS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQMATCHINGSYMBOLS.code(), FAIL_SEND_REQMATCHINGSYMBOLS.msg() + str(ex))
            return

    def reqCompletedOrders(self, apiOnly: bool):
        """Call this function to request the completed orders. If apiOnly parameter
        is true, then only completed orders placed from API are requested.
        Each completed order will be fed back through the
        completedOrder() function on the EWrapper."""

        if (self.useProtoBuf(OUT.REQ_COMPLETED_ORDERS)):
            completedOrdersRequestProto = createCompletedOrdersRequestProto(apiOnly)
            self.reqCompletedOrdersProtoBuf(completedOrdersRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            msg = make_field(apiOnly)

            self.sendMsg(OUT.REQ_COMPLETED_ORDERS, msg)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQCOMPLETEDORDERS.code(), FAIL_SEND_REQCOMPLETEDORDERS.msg() + str(ex))
            return

    def reqCompletedOrdersProtoBuf(self, completedOrdersRequestProto: CompletedOrdersRequestProto):
        if completedOrdersRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = completedOrdersRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_COMPLETED_ORDERS + PROTOBUF_MSG_ID, serializedString)
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQCOMPLETEDORDERS.code(), FAIL_SEND_REQCOMPLETEDORDERS.msg() + str(ex))
            return

    def reqWshMetaData(self, reqId: int):
        if self.useProtoBuf(OUT.REQ_WSH_META_DATA):
            self.reqWshMetaDataProtoBuf(createWshMetaDataRequestProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_WSHE_CALENDAR:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(), 
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support WSHE Calendar API.",
            )
            return

        try:
            msg = make_field(reqId)
            self.sendMsg(OUT.REQ_WSH_META_DATA, msg)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQ_WSH_META_DATA.code(), FAIL_SEND_REQ_WSH_META_DATA.msg() + str(ex))
            return

    def reqWshMetaDataProtoBuf(self, wshMetaDataRequestProto: WshMetaDataRequestProto):
        if wshMetaDataRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = wshMetaDataRequestProto.reqId if wshMetaDataRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = wshMetaDataRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_WSH_META_DATA + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQ_WSH_META_DATA.code(), FAIL_SEND_REQ_WSH_META_DATA.msg() + str(ex))
            return

    def cancelWshMetaData(self, reqId: int):
        if self.useProtoBuf(OUT.CANCEL_WSH_META_DATA):
            self.cancelWshMetaDataProtoBuf(createCancelWshMetaDataProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_WSHE_CALENDAR:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support WSHE Calendar API.",
            )
            return

        try:
            msg = make_field(reqId)
            self.sendMsg(OUT.CANCEL_WSH_META_DATA, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CAN_WSH_META_DATA.code(), FAIL_SEND_CAN_WSH_META_DATA.msg() + str(ex))
            return

    def cancelWshMetaDataProtoBuf(self, cancelWshMetaDataProto: CancelWshMetaDataProto):
        if cancelWshMetaDataProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelWshMetaDataProto.reqId if cancelWshMetaDataProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelWshMetaDataProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_WSH_META_DATA + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CAN_WSH_META_DATA.code(), FAIL_SEND_CAN_WSH_META_DATA.msg() + str(ex))
            return

    def reqWshEventData(
        self,
        reqId: int,
        wshEventData: WshEventData
    ):
        if self.useProtoBuf(OUT.REQ_WSH_EVENT_DATA):
            self.reqWshEventDataProtoBuf(createWshEventDataRequestProto(reqId, wshEventData))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_WSHE_CALENDAR:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support WSHE Calendar API.",
            )
            return

        if self.serverVersion() < MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS:
            if (
                wshEventData.filter != ""
                or wshEventData.fillWatchlist
                or wshEventData.fillPortfolio
                or wshEventData.fillCompetitors
            ):
                self.wrapper.error(
                    NO_VALID_ID,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg() + " It does not support WSH event data filters.",
                )
                return

        if self.serverVersion() < MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS_DATE:
            if (
                wshEventData.startDate != ""
                or wshEventData.endDate != ""
                or wshEventData.totalLimit != UNSET_INTEGER
            ):
                self.wrapper.error(
                    NO_VALID_ID,
                    currentTimeMillis(),
                    UPDATE_TWS.code(),
                    UPDATE_TWS.msg()
                    + " It does not support WSH event data date filters.",
                )
                return

        try:
            flds = [
                make_field(reqId),
                make_field(wshEventData.conId),
            ]

            if self.serverVersion() >= MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS:
                flds.append(make_field(wshEventData.filter))
                flds.append(make_field(wshEventData.fillWatchlist))
                flds.append(make_field(wshEventData.fillPortfolio))
                flds.append(make_field(wshEventData.fillCompetitors))

            if self.serverVersion() >= MIN_SERVER_VER_WSH_EVENT_DATA_FILTERS_DATE:
                flds.append(make_field(wshEventData.startDate))
                flds.append(make_field(wshEventData.endDate))
                flds.append(make_field(wshEventData.totalLimit))

            msg = "".join(flds)
            self.sendMsg(OUT.REQ_WSH_EVENT_DATA, msg)
        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQ_WSH_EVENT_DATA.code(), FAIL_SEND_REQ_WSH_EVENT_DATA.msg() + str(ex))
            return

    def reqWshEventDataProtoBuf(self, wshEventDataRequestProto: WshEventDataRequestProto):
        if wshEventDataRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = wshEventDataRequestProto.reqId if wshEventDataRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = wshEventDataRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_WSH_EVENT_DATA + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQ_WSH_EVENT_DATA.code(), FAIL_SEND_REQ_WSH_EVENT_DATA.msg() + str(ex))
            return

    def cancelWshEventData(self, reqId: int):
        if self.useProtoBuf(OUT.CANCEL_WSH_EVENT_DATA):
            self.cancelWshEventDataProtoBuf(createCancelWshEventDataProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_WSHE_CALENDAR:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support WSHE Calendar API.",
            )
            return

        try:
            msg = make_field(reqId)
            self.sendMsg(OUT.CANCEL_WSH_EVENT_DATA, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CAN_WSH_EVENT_DATA.code(), FAIL_SEND_CAN_WSH_EVENT_DATA.msg() + str(ex))
            return

    def cancelWshEventDataProtoBuf(self, cancelWshEventDataProto: CancelWshEventDataProto):
        if cancelWshEventDataProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = cancelWshEventDataProto.reqId if cancelWshEventDataProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = cancelWshEventDataProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.CANCEL_WSH_EVENT_DATA + PROTOBUF_MSG_ID, serializedString)

        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CAN_WSH_EVENT_DATA.code(), FAIL_SEND_CAN_WSH_EVENT_DATA.msg() + str(ex))
            return

    def reqUserInfo(self, reqId: int):
        if self.useProtoBuf(OUT.REQ_USER_INFO):
            self.reqUserInfoProtoBuf(createUserInfoRequestProto(reqId))
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_USER_INFO:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support user info requests.",
            )
            return

        try:
            msg = make_field(reqId)
            self.sendMsg(OUT.REQ_USER_INFO, msg)
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQ_USER_INFO.code(), FAIL_SEND_REQ_USER_INFO.msg() + str(ex))
            return
        
    def reqUserInfoProtoBuf(self, userInfoRequestProto: UserInfoRequestProto):
        if userInfoRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        reqId = userInfoRequestProto.reqId if userInfoRequestProto.HasField('reqId') else NO_VALID_ID

        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = userInfoRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_USER_INFO + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(reqId, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQ_USER_INFO.code(), FAIL_SEND_REQ_USER_INFO.msg() + str(ex))
            return

    def reqCurrentTimeInMillis(self):
        """Asks the current system time in milliseconds on the server side."""

        if (self.useProtoBuf(OUT.REQ_CURRENT_TIME_IN_MILLIS)):
            currentTimeInMillisRequestProto = createCurrentTimeInMillisRequestProto()
            self.reqCurrentTimeInMillisProtoBuf(currentTimeInMillisRequestProto)
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_CURRENT_TIME_IN_MILLIS:
            self.wrapper.error(
                NO_VALID_ID,
                currentTimeMillis(),
                UPDATE_TWS.code(),
                UPDATE_TWS.msg() + " It does not support current time in millis requests.",
            )
            return

        try:
            self.sendMsg(OUT.REQ_CURRENT_TIME_IN_MILLIS, "")
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQCURRTIMEINMILLIS.code(), FAIL_SEND_REQCURRTIMEINMILLIS.msg() + str(ex))
            return

    def reqCurrentTimeInMillisProtoBuf(self, currentTimeInMillisRequestProto: CurrentTimeInMillisRequestProto):
        if currentTimeInMillisRequestProto is None:
            return

        self.logRequest(current_fn_name(), vars())

        if not self.isConnected():
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        try:
            serializedString = currentTimeInMillisRequestProto.SerializeToString()

            self.sendMsgProtoBuf(OUT.REQ_CURRENT_TIME_IN_MILLIS + PROTOBUF_MSG_ID, serializedString)

        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), FAIL_SEND_REQCURRTIMEINMILLIS.code(), FAIL_SEND_REQCURRTIMEINMILLIS.msg() + str(ex))
            return

    def cancelContractData(self, reqId: int):
        cancelContractDataProto = createCancelContractDataProto(reqId)
        self.cancelContractDataProtoBuf(cancelContractDataProto)

    def cancelContractDataProtoBuf(self, cancelContractDataProto):
        if cancelContractDataProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = cancelContractDataProto.reqId if cancelContractDataProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_CANCEL_CONTRACT_DATA:
            self.wrapper.error(reqId, currentTimeMillis(), UPDATE_TWS.code(), UPDATE_TWS.msg() + "  It does not support contract data cancels.")
            return
        
        try:
            serializedString = cancelContractDataProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.CANCEL_CONTRACT_DATA + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCEL_CONTRACT_DATA.code(), FAIL_SEND_CANCEL_CONTRACT_DATA.msg() + str(ex))
            return

    def cancelHistoricalTicks(self, reqId: TickerId):
        cancelHistoricalTicksProto = createCancelHistoricalTicksProto(reqId)
        self.cancelHistoricalTicksProtoBuf(cancelHistoricalTicksProto)

    def cancelHistoricalTicksProtoBuf(self, cancelHistoricalTicksProto):
        if cancelHistoricalTicksProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = cancelHistoricalTicksProto.reqId if cancelHistoricalTicksProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_CANCEL_CONTRACT_DATA:
            self.wrapper.error(reqId, currentTimeMillis(), UPDATE_TWS.code(), UPDATE_TWS.msg() + "  It does not support historical ticks cancels.")
            return
        
        try:
            serializedString = cancelHistoricalTicksProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.CANCEL_HISTORICAL_TICKS + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_CANCEL_HISTORICAL_TICKS.code(), FAIL_SEND_CANCEL_HISTORICAL_TICKS.msg() + str(ex))
            return

    def reqConfigProtoBuf(self, configRequestProto: ConfigRequestProto):
        if configRequestProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = configRequestProto.reqId if configRequestProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_CONFIG:
            self.wrapper.error(reqId, currentTimeMillis(), UPDATE_TWS.code(), UPDATE_TWS.msg() + "  It does not support config requests.")
            return
        
        try:
            serializedString = configRequestProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.REQ_CONFIG + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_REQCONFIG.code(), FAIL_SEND_REQCONFIG.msg() + str(ex))
            return

    def updateConfigProtoBuf(self, updateConfigRequestProto: UpdateConfigRequestProto):
        if updateConfigRequestProto is None:
            return
        
        self.logRequest(current_fn_name(), vars())
    
        reqId = updateConfigRequestProto.reqId if updateConfigRequestProto.HasField('reqId') else NO_VALID_ID
    
        if not self.isConnected():
            self.wrapper.error(reqId, currentTimeMillis(), NOT_CONNECTED.code(), NOT_CONNECTED.msg())
            return

        if self.serverVersion() < MIN_SERVER_VER_UPDATE_CONFIG:
            self.wrapper.error(reqId, currentTimeMillis(), UPDATE_TWS.code(), UPDATE_TWS.msg() + "  It does not support update config requests.")
            return
        
        try:
            serializedString = updateConfigRequestProto.SerializeToString()
        
            self.sendMsgProtoBuf(OUT.UPDATE_CONFIG + PROTOBUF_MSG_ID, serializedString)
        
        except ClientException as ex:
            self.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
            return
        except Exception as ex:
            self.wrapper.error(reqId, currentTimeMillis(), FAIL_SEND_UPDATECONFIG.code(), FAIL_SEND_UPDATECONFIG.msg() + str(ex))
            return
