/**
 * TWS API error codes and messages.
 * Mirrors: ibapi/errors.py
 */

export class CodeMsgPair {
  constructor(
    public readonly errorCode: number,
    public readonly errorMsg: string,
  ) {}

  code(): number {
    return this.errorCode
  }

  msg(): string {
    return this.errorMsg
  }
}

export const ALREADY_CONNECTED = new CodeMsgPair(501, 'Already connected.')
export const CONNECT_FAIL = new CodeMsgPair(
  502,
  `Couldn't connect to TWS. Confirm that "Enable ActiveX and Socket Clients" ` +
    `is enabled and connection port is the same as "Socket Port" on the ` +
    `TWS "Edit->Global Configuration...->API->Settings" menu. Live Trading ports: ` +
    `TWS: 7496; IB Gateway: 4001. Simulated Trading ports: TWS: 7497; IB Gateway: 4002. ` +
    `Verify that the maximum API connection threshold (default 32) is not exceeded.`,
)
export const UPDATE_TWS = new CodeMsgPair(503, 'The TWS is out of date and must be upgraded.')
export const NOT_CONNECTED = new CodeMsgPair(504, 'Not connected')
export const UNKNOWN_ID = new CodeMsgPair(505, 'Fatal Error: Unknown message id.')
export const BAD_LENGTH = new CodeMsgPair(507, 'Bad message length')
export const BAD_MESSAGE = new CodeMsgPair(508, 'Bad message')
export const FAIL_SEND_REQMKT = new CodeMsgPair(510, 'Request Market Data Sending Error - ')
export const FAIL_SEND_CANMKT = new CodeMsgPair(511, 'Cancel Market Data Sending Error - ')
export const FAIL_SEND_ORDER = new CodeMsgPair(512, 'Order Sending Error - ')
export const FAIL_SEND_ACCT = new CodeMsgPair(513, 'Account Update Request Sending Error - ')
export const FAIL_SEND_EXEC = new CodeMsgPair(514, 'Request For Executions Sending Error - ')
export const FAIL_SEND_CORDER = new CodeMsgPair(515, 'Cancel Order Sending Error - ')
export const FAIL_SEND_OORDER = new CodeMsgPair(516, 'Request Open Order Sending Error - ')
export const FAIL_SEND_REQCONTRACT = new CodeMsgPair(518, 'Request Contract Data Sending Error - ')
export const FAIL_SEND_REQMKTDEPTH = new CodeMsgPair(519, 'Request Market Depth Sending Error - ')
export const FAIL_CREATE_SOCK = new CodeMsgPair(520, 'Failed to create socket')
export const FAIL_SEND_SERVER_LOG_LEVEL = new CodeMsgPair(521, 'Set Server Log Level Sending Error - ')
export const FAIL_SEND_FA_REQUEST = new CodeMsgPair(522, 'FA Information Request Sending Error - ')
export const FAIL_SEND_FA_REPLACE = new CodeMsgPair(523, 'FA Information Replace Sending Error - ')
export const FAIL_SEND_REQSCANNER = new CodeMsgPair(524, 'Request Scanner Subscription Sending Error - ')
export const FAIL_SEND_CANSCANNER = new CodeMsgPair(525, 'Cancel Scanner Subscription Sending Error - ')
export const FAIL_SEND_REQSCANNERPARAMETERS = new CodeMsgPair(526, 'Request Scanner Parameter Sending Error - ')
export const FAIL_SEND_REQHISTDATA = new CodeMsgPair(527, 'Request Historical Data Sending Error - ')
export const FAIL_SEND_CANHISTDATA = new CodeMsgPair(528, 'Request Historical Data Sending Error - ')
export const FAIL_SEND_REQRTBARS = new CodeMsgPair(529, 'Request Real-time Bar Data Sending Error - ')
export const FAIL_SEND_CANRTBARS = new CodeMsgPair(530, 'Cancel Real-time Bar Data Sending Error - ')
export const FAIL_SEND_REQCURRTIME = new CodeMsgPair(531, 'Request Current Time Sending Error - ')
export const FAIL_SEND_REQFUNDDATA = new CodeMsgPair(532, 'Request Fundamental Data Sending Error - ')
export const FAIL_SEND_CANFUNDDATA = new CodeMsgPair(533, 'Cancel Fundamental Data Sending Error - ')
export const FAIL_SEND_REQCALCIMPLIEDVOLAT = new CodeMsgPair(534, 'Request Calculate Implied Volatility Sending Error - ')
export const FAIL_SEND_REQCALCOPTIONPRICE = new CodeMsgPair(535, 'Request Calculate Option Price Sending Error - ')
export const FAIL_SEND_CANCALCIMPLIEDVOLAT = new CodeMsgPair(536, 'Cancel Calculate Implied Volatility Sending Error - ')
export const FAIL_SEND_CANCALCOPTIONPRICE = new CodeMsgPair(537, 'Cancel Calculate Option Price Sending Error - ')
export const FAIL_SEND_REQGLOBALCANCEL = new CodeMsgPair(538, 'Request Global Cancel Sending Error - ')
export const FAIL_SEND_REQMARKETDATATYPE = new CodeMsgPair(539, 'Request Market Data Type Sending Error - ')
export const FAIL_SEND_REQPOSITIONS = new CodeMsgPair(540, 'Request Positions Sending Error - ')
export const FAIL_SEND_CANPOSITIONS = new CodeMsgPair(541, 'Cancel Positions Sending Error - ')
export const FAIL_SEND_REQACCOUNTDATA = new CodeMsgPair(542, 'Request Account Data Sending Error - ')
export const FAIL_SEND_CANACCOUNTDATA = new CodeMsgPair(543, 'Cancel Account Data Sending Error - ')
export const FAIL_SEND_VERIFYREQUEST = new CodeMsgPair(544, 'Verify Request Sending Error - ')
export const FAIL_SEND_VERIFYMESSAGE = new CodeMsgPair(545, 'Verify Message Sending Error - ')
export const FAIL_SEND_QUERYDISPLAYGROUPS = new CodeMsgPair(546, 'Query Display Groups Sending Error - ')
export const FAIL_SEND_SUBSCRIBETOGROUPEVENTS = new CodeMsgPair(547, 'Subscribe To Group Events Sending Error - ')
export const FAIL_SEND_UPDATEDISPLAYGROUP = new CodeMsgPair(548, 'Update Display Group Sending Error - ')
export const FAIL_SEND_UNSUBSCRIBEFROMGROUPEVENTS = new CodeMsgPair(549, 'Unsubscribe From Group Events Sending Error - ')
export const FAIL_SEND_STARTAPI = new CodeMsgPair(550, 'Start API Sending Error - ')
export const FAIL_SEND_VERIFYANDAUTHREQUEST = new CodeMsgPair(551, 'Verify And Auth Request Sending Error - ')
export const FAIL_SEND_VERIFYANDAUTHMESSAGE = new CodeMsgPair(552, 'Verify And Auth Message Sending Error - ')
export const FAIL_SEND_REQPOSITIONSMULTI = new CodeMsgPair(553, 'Request Positions Multi Sending Error - ')
export const FAIL_SEND_CANPOSITIONSMULTI = new CodeMsgPair(554, 'Cancel Positions Multi Sending Error - ')
export const FAIL_SEND_REQACCOUNTUPDATESMULTI = new CodeMsgPair(555, 'Request Account Updates Multi Sending Error - ')
export const FAIL_SEND_CANACCOUNTUPDATESMULTI = new CodeMsgPair(556, 'Cancel Account Updates Multi Sending Error - ')
export const FAIL_SEND_REQSECDEFOPTPARAMS = new CodeMsgPair(557, 'Request Security Definition Option Params Sending Error - ')
export const FAIL_SEND_REQSOFTDOLLARTIERS = new CodeMsgPair(558, 'Request Soft Dollar Tiers Sending Error - ')
export const FAIL_SEND_REQFAMILYCODES = new CodeMsgPair(559, 'Request Family Codes Sending Error - ')
export const FAIL_SEND_REQMATCHINGSYMBOLS = new CodeMsgPair(560, 'Request Matching Symbols Sending Error - ')
export const FAIL_SEND_REQMKTDEPTHEXCHANGES = new CodeMsgPair(561, 'Request Market Depth Exchanges Sending Error - ')
export const FAIL_SEND_REQSMARTCOMPONENTS = new CodeMsgPair(562, 'Request Smart Components Sending Error - ')
export const FAIL_SEND_REQNEWSPROVIDERS = new CodeMsgPair(563, 'Request News Providers Sending Error - ')
export const FAIL_SEND_REQNEWSARTICLE = new CodeMsgPair(564, 'Request News Article Sending Error - ')
export const FAIL_SEND_REQHISTORICALNEWS = new CodeMsgPair(565, 'Request Historical News Sending Error - ')
export const FAIL_SEND_REQHEADTIMESTAMP = new CodeMsgPair(566, 'Request Head Time Stamp Sending Error - ')
export const FAIL_SEND_REQHISTOGRAMDATA = new CodeMsgPair(567, 'Request Histogram Data Sending Error - ')
export const FAIL_SEND_CANCELHISTOGRAMDATA = new CodeMsgPair(568, 'Cancel Request Histogram Data Sending Error - ')
export const FAIL_SEND_CANCELHEADTIMESTAMP = new CodeMsgPair(569, 'Cancel Head Time Stamp Sending Error - ')
export const FAIL_SEND_REQMARKETRULE = new CodeMsgPair(570, 'Request Market Rule Sending Error - ')
export const FAIL_SEND_REQPNL = new CodeMsgPair(571, 'Request PnL Sending Error - ')
export const FAIL_SEND_CANCELPNL = new CodeMsgPair(572, 'Cancel PnL Sending Error - ')
export const FAIL_SEND_REQPNLSINGLE = new CodeMsgPair(573, 'Request PnL Single Error - ')
export const FAIL_SEND_CANCELPNLSINGLE = new CodeMsgPair(574, 'Cancel PnL Single Sending Error - ')
export const FAIL_SEND_REQHISTORICALTICKS = new CodeMsgPair(575, 'Request Historical Ticks Error - ')
export const FAIL_SEND_REQTICKBYTICKDATA = new CodeMsgPair(576, 'Request Tick-By-Tick Data Sending Error - ')
export const FAIL_SEND_CANCELTICKBYTICKDATA = new CodeMsgPair(577, 'Cancel Tick-By-Tick Data Sending Error - ')
export const FAIL_SEND_REQCOMPLETEDORDERS = new CodeMsgPair(578, 'Request Completed Orders Sending Error - ')
export const INVALID_SYMBOL = new CodeMsgPair(579, 'Invalid symbol in string - ')
export const FAIL_SEND_REQ_WSH_META_DATA = new CodeMsgPair(580, 'Request WSH Meta Data Sending Error - ')
export const FAIL_SEND_CAN_WSH_META_DATA = new CodeMsgPair(581, 'Cancel WSH Meta Data Sending Error - ')
export const FAIL_SEND_REQ_WSH_EVENT_DATA = new CodeMsgPair(582, 'Request WSH Event Data Sending Error - ')
export const FAIL_SEND_CAN_WSH_EVENT_DATA = new CodeMsgPair(583, 'Cancel WSH Event Data Sending Error - ')
export const FAIL_SEND_REQ_USER_INFO = new CodeMsgPair(584, 'Request User Info Sending Error - ')
export const FA_PROFILE_NOT_SUPPORTED = new CodeMsgPair(585, 'FA Profile is not supported anymore, use FA Group instead - ')
export const FAIL_SEND_REQCURRTIMEINMILLIS = new CodeMsgPair(587, 'Request Current Time In Millis Sending Error - ')
export const ERROR_ENCODING_PROTOBUF = new CodeMsgPair(588, 'Error encoding protobuf - ')
export const FAIL_SEND_CANMKTDEPTH = new CodeMsgPair(589, 'Cancel Market Depth Sending Error - ')
export const FAIL_SEND_CANCEL_CONTRACT_DATA = new CodeMsgPair(590, 'Cancel Contract Data Sending Error - ')
export const FAIL_SEND_CANCEL_HISTORICAL_TICKS = new CodeMsgPair(591, 'Cancel Historical Ticks Sending Error - ')
export const FAIL_SEND_REQCONFIG = new CodeMsgPair(592, 'Request Config Sending Error - ')
export const FAIL_SEND_UPDATECONFIG = new CodeMsgPair(593, 'Update Config Request Sending Error - ')
