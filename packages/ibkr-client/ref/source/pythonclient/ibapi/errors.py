"""
Copyright (C) 2023 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.

This is the interface that will need to be overloaded by the customer so
that his/her code can receive info from the TWS/IBGW.
"""


class CodeMsgPair:
    def __init__(self, code, msg):
        self.errorCode = code
        self.errorMsg = msg

    def code(self):
        return self.errorCode

    def msg(self):
        return self.errorMsg


ALREADY_CONNECTED = CodeMsgPair(501, "Already connected.")
CONNECT_FAIL = CodeMsgPair(
    502,
    """Couldn't connect to TWS. Confirm that \"Enable ActiveX and Socket Clients\" 
is enabled and connection port is the same as \"Socket Port\" on the 
TWS \"Edit->Global Configuration...->API->Settings\" menu. Live Trading ports: 
TWS: 7496; IB Gateway: 4001. Simulated Trading ports: TWS: 7497; IB Gateway: 4002.
Verify that the maximum API connection threshold (default 32) is not exceeded.""",
)
UPDATE_TWS = CodeMsgPair(503, "The TWS is out of date and must be upgraded.")
NOT_CONNECTED = CodeMsgPair(504, "Not connected")
UNKNOWN_ID = CodeMsgPair(505, "Fatal Error: Unknown message id.")
# UNSUPPORTED_VERSION = CodeMsgPair(506, "Unsupported version") #not used
BAD_LENGTH = CodeMsgPair(507, "Bad message length")
BAD_MESSAGE = CodeMsgPair(508, "Bad message")
# SOCKET_EXCEPTION = CodeMsgPair(509, "Exception caught while reading socket - ") #not used
FAIL_SEND_REQMKT = CodeMsgPair(510, "Request Market Data Sending Error - ")
FAIL_SEND_CANMKT = CodeMsgPair(511, "Cancel Market Data Sending Error - ")
FAIL_SEND_ORDER = CodeMsgPair(512, "Order Sending Error - ")
FAIL_SEND_ACCT = CodeMsgPair(513, "Account Update Request Sending Error - ")
FAIL_SEND_EXEC = CodeMsgPair(514, "Request For Executions Sending Error - ")
FAIL_SEND_CORDER = CodeMsgPair(515, "Cancel Order Sending Error - ")
FAIL_SEND_OORDER = CodeMsgPair(516, "Request Open Order Sending Error - ")
FAIL_SEND_REQCONTRACT = CodeMsgPair(518, "Request Contract Data Sending Error - ")
FAIL_SEND_REQMKTDEPTH = CodeMsgPair(519, "Request Market Depth Sending Error - ")
FAIL_CREATE_SOCK = CodeMsgPair(520, "Failed to create socket")
FAIL_SEND_SERVER_LOG_LEVEL = CodeMsgPair(521, "Set Server Log Level Sending Error - ")
FAIL_SEND_FA_REQUEST = CodeMsgPair(522, "FA Information Request Sending Error - ")
FAIL_SEND_FA_REPLACE = CodeMsgPair(523, "FA Information Replace Sending Error - ")
FAIL_SEND_REQSCANNER = CodeMsgPair(524, "Request Scanner Subscription Sending Error - ")
FAIL_SEND_CANSCANNER = CodeMsgPair(525, "Cancel Scanner Subscription Sending Error - ")
FAIL_SEND_REQSCANNERPARAMETERS = CodeMsgPair(526, "Request Scanner Parameter Sending Error - ")
FAIL_SEND_REQHISTDATA = CodeMsgPair(527, "Request Historical Data Sending Error - ")
FAIL_SEND_CANHISTDATA = CodeMsgPair(528, "Request Historical Data Sending Error - ")
FAIL_SEND_REQRTBARS = CodeMsgPair(529, "Request Real-time Bar Data Sending Error - ")
FAIL_SEND_CANRTBARS = CodeMsgPair(530, "Cancel Real-time Bar Data Sending Error - ")
FAIL_SEND_REQCURRTIME = CodeMsgPair(531, "Request Current Time Sending Error - ")
FAIL_SEND_REQFUNDDATA = CodeMsgPair(532, "Request Fundamental Data Sending Error - ")
FAIL_SEND_CANFUNDDATA = CodeMsgPair(533, "Cancel Fundamental Data Sending Error - ")
FAIL_SEND_REQCALCIMPLIEDVOLAT = CodeMsgPair(534, "Request Calculate Implied Volatility Sending Error - ")
FAIL_SEND_REQCALCOPTIONPRICE = CodeMsgPair(535, "Request Calculate Option Price Sending Error - ")
FAIL_SEND_CANCALCIMPLIEDVOLAT = CodeMsgPair(536, "Cancel Calculate Implied Volatility Sending Error - ")
FAIL_SEND_CANCALCOPTIONPRICE = CodeMsgPair(537, "Cancel Calculate Option Price Sending Error - ")
FAIL_SEND_REQGLOBALCANCEL = CodeMsgPair(538, "Request Global Cancel Sending Error - ")
FAIL_SEND_REQMARKETDATATYPE = CodeMsgPair(539, "Request Market Data Type Sending Error - ")
FAIL_SEND_REQPOSITIONS = CodeMsgPair(540, "Request Positions Sending Error - ")
FAIL_SEND_CANPOSITIONS = CodeMsgPair(541, "Cancel Positions Sending Error - ")
FAIL_SEND_REQACCOUNTDATA = CodeMsgPair(542, "Request Account Data Sending Error - ")
FAIL_SEND_CANACCOUNTDATA = CodeMsgPair(543, "Cancel Account Data Sending Error - ")
FAIL_SEND_VERIFYREQUEST = CodeMsgPair(544, "Verify Request Sending Error - ")
FAIL_SEND_VERIFYMESSAGE = CodeMsgPair(545, "Verify Message Sending Error - ")
FAIL_SEND_QUERYDISPLAYGROUPS = CodeMsgPair(546, "Query Display Groups Sending Error - ")
FAIL_SEND_SUBSCRIBETOGROUPEVENTS = CodeMsgPair(547, "Subscribe To Group Events Sending Error - ")
FAIL_SEND_UPDATEDISPLAYGROUP = CodeMsgPair(548, "Update Display Group Sending Error - ")
FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS = CodeMsgPair(549, "Unsubscribe From Group Events Sending Error - ")
FAIL_SEND_STARTAPI = CodeMsgPair(550, "Start API Sending Error - ")
FAIL_SEND_VERIFYANDAUTHREQUEST = CodeMsgPair(551, "Verify And Auth Request Sending Error - ")
FAIL_SEND_VERIFYANDAUTHMESSAGE = CodeMsgPair(552, "Verify And Auth Message Sending Error - ")
FAIL_SEND_REQPOSITIONSMULTI = CodeMsgPair(553, "Request Positions Multi Sending Error - ")
FAIL_SEND_CANPOSITIONSMULTI = CodeMsgPair(554, "Cancel Positions Multi Sending Error - ")
FAIL_SEND_REQACCOUNTUPDATESMULTI = CodeMsgPair(555, "Request Account Updates Multi Sending Error - ")
FAIL_SEND_CANACCOUNTUPDATESMULTI = CodeMsgPair(556, "Cancel Account Updates Multi Sending Error - ")
FAIL_SEND_REQSECDEFOPTPARAMS = CodeMsgPair(557, "Request Security Definition Option Params Sending Error - ")
FAIL_SEND_REQSOFTDOLLARTIERS = CodeMsgPair(558, "Request Soft Dollar Tiers Sending Error - ")
FAIL_SEND_REQFAMILYCODES = CodeMsgPair(559, "Request Family Codes Sending Error - ")
FAIL_SEND_REQMATCHINGSYMBOLS = CodeMsgPair(560, "Request Matching Symbols Sending Error - ")
FAIL_SEND_REQMKTDEPTHEXCHANGES = CodeMsgPair(561, "Request Market Depth Exchanges Sending Error - ")
FAIL_SEND_REQSMARTCOMPONENTS = CodeMsgPair(562, "Request Smart Components Sending Error - ")
FAIL_SEND_REQNEWSPROVIDERS = CodeMsgPair(563, "Request News Providers Sending Error - ")
FAIL_SEND_REQNEWSARTICLE = CodeMsgPair(564, "Request News Article Sending Error - ")
FAIL_SEND_REQHISTORICALNEWS = CodeMsgPair(565, "Request Historical News Sending Error - ")
FAIL_SEND_REQHEADTIMESTAMP = CodeMsgPair(566, "Request Head Time Stamp Sending Error - ")
FAIL_SEND_REQHISTOGRAMDATA = CodeMsgPair(567, "Request Histogram Data Sending Error - ")
FAIL_SEND_CANCELHISTOGRAMDATA = CodeMsgPair(568, "Cancel Request Histogram Data Sending Error - ")
FAIL_SEND_CANCELHEADTIMESTAMP = CodeMsgPair(569, "Cancel Head Time Stamp Sending Error - ")
FAIL_SEND_REQMARKETRULE = CodeMsgPair(570, "Request Market Rule Sending Error - ")
FAIL_SEND_REQPNL = CodeMsgPair(571, "Request PnL Sending Error - ")
FAIL_SEND_CANCELPNL = CodeMsgPair(572, "Cancel PnL Sending Error - ")
FAIL_SEND_REQPNLSINGLE = CodeMsgPair(573, "Request PnL Single Error - ")
FAIL_SEND_CANCELPNLSINGLE = CodeMsgPair(574, "Cancel PnL Single Sending Error - ")
FAIL_SEND_REQHISTORICALTICKS = CodeMsgPair(575, "Request Historical Ticks Error - ")
FAIL_SEND_REQTICKBYTICKDATA = CodeMsgPair(576, "Request Tick-By-Tick Data Sending Error - ")
FAIL_SEND_CANCELTICKBYTICKDATA = CodeMsgPair(577, "Cancel Tick-By-Tick Data Sending Error - ")
FAIL_SEND_REQCOMPLETEDORDERS = CodeMsgPair(578, "Request Completed Orders Sending Error - ")
INVALID_SYMBOL = CodeMsgPair(579, "Invalid symbol in string - ")
FAIL_SEND_REQ_WSH_META_DATA = CodeMsgPair(580, "Request WSH Meta Data Sending Error - ")
FAIL_SEND_CAN_WSH_META_DATA = CodeMsgPair(581, "Cancel WSH Meta Data Sending Error - ")
FAIL_SEND_REQ_WSH_EVENT_DATA = CodeMsgPair(582, "Request WSH Event Data Sending Error - ")
FAIL_SEND_CAN_WSH_EVENT_DATA = CodeMsgPair(583, "Cancel WSH Event Data Sending Error - ")
FAIL_SEND_REQ_USER_INFO = CodeMsgPair(584, "Request User Info Sending Error - ")
FA_PROFILE_NOT_SUPPORTED = CodeMsgPair(585, "FA Profile is not supported anymore, use FA Group instead - ")
FAIL_SEND_REQCURRTIMEINMILLIS = CodeMsgPair(587, "Request Current Time In Millis Sending Error - ")
ERROR_ENCODING_PROTOBUF = CodeMsgPair(588, "Error encoding protobuf - ")
FAIL_SEND_CANMKTDEPTH = CodeMsgPair(589, "Cancel Market Depth Sending Error - ")
FAIL_SEND_CANCEL_CONTRACT_DATA = CodeMsgPair(590, "Cancel Contract Data Sending Error - ")
FAIL_SEND_CANCEL_HISTORICAL_TICKS = CodeMsgPair(591, "Cancel Historical Ticks Sending Error - ")
FAIL_SEND_REQCONFIG = CodeMsgPair(592, "Request Config Sending Error - ")
FAIL_SEND_UPDATECONFIG = CodeMsgPair(593, "Update Config Request Sending Error - ")
