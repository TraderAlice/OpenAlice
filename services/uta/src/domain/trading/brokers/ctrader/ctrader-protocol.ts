/**
 * cTrader Open API wire constants for the JSON transport (port 5036).
 *
 * Payload type numbers and enum values are copied from Spotware's official
 * proto definitions (MIT): https://github.com/spotware/openapi-proto-messages
 * (OpenApiCommonModelMessages.proto, OpenApiModelMessages.proto). Only the
 * subset this adapter uses is listed; extend it from the same source.
 */

export const CTRADER_HOSTS = {
  demo: 'demo.ctraderapi.com',
  live: 'live.ctraderapi.com',
} as const

export type CtraderEnvironment = keyof typeof CTRADER_HOSTS

/** JSON messages are only accepted on 5036 (Protobuf uses 5035). */
export const CTRADER_JSON_PORT = 5036

export function ctraderJsonUrl(env: CtraderEnvironment): string {
  return `wss://${CTRADER_HOSTS[env]}:${CTRADER_JSON_PORT}`
}

export const PayloadType = {
  // ProtoPayloadType (common)
  ERROR_RES: 50,
  HEARTBEAT_EVENT: 51,

  // ProtoOAPayloadType
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  VERSION_REQ: 2104,
  VERSION_RES: 2105,
  NEW_ORDER_REQ: 2106,
  TRAILING_SL_CHANGED_EVENT: 2107,
  CANCEL_ORDER_REQ: 2108,
  AMEND_ORDER_REQ: 2109,
  AMEND_POSITION_SLTP_REQ: 2110,
  CLOSE_POSITION_REQ: 2111,
  ASSET_LIST_REQ: 2112,
  ASSET_LIST_RES: 2113,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  SYMBOL_CHANGED_EVENT: 2120,
  TRADER_REQ: 2121,
  TRADER_RES: 2122,
  TRADER_UPDATE_EVENT: 2123,
  RECONCILE_REQ: 2124,
  RECONCILE_RES: 2125,
  EXECUTION_EVENT: 2126,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SUBSCRIBE_SPOTS_RES: 2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  UNSUBSCRIBE_SPOTS_RES: 2130,
  SPOT_EVENT: 2131,
  ORDER_ERROR_EVENT: 2132,
  DEAL_LIST_REQ: 2133,
  DEAL_LIST_RES: 2134,
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
  MARGIN_CHANGED_EVENT: 2141,
  OA_ERROR_RES: 2142,
  GET_TICKDATA_REQ: 2145,
  GET_TICKDATA_RES: 2146,
  ACCOUNTS_TOKEN_INVALIDATED_EVENT: 2147,
  CLIENT_DISCONNECT_EVENT: 2148,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,
  ASSET_CLASS_LIST_REQ: 2153,
  ASSET_CLASS_LIST_RES: 2154,
  SYMBOL_CATEGORY_REQ: 2160,
  SYMBOL_CATEGORY_RES: 2161,
  ACCOUNT_LOGOUT_REQ: 2162,
  ACCOUNT_LOGOUT_RES: 2163,
  ACCOUNT_DISCONNECT_EVENT: 2164,
  REFRESH_TOKEN_REQ: 2173,
  REFRESH_TOKEN_RES: 2174,
  ORDER_LIST_REQ: 2175,
  ORDER_LIST_RES: 2176,
  ORDER_DETAILS_REQ: 2181,
  ORDER_DETAILS_RES: 2182,
} as const

export type PayloadTypeValue = (typeof PayloadType)[keyof typeof PayloadType]

/** Error envelopes: ProtoErrorRes (common) and ProtoOAErrorRes. */
export const ERROR_PAYLOAD_TYPES: ReadonlySet<number> = new Set([
  PayloadType.ERROR_RES,
  PayloadType.OA_ERROR_RES,
])

/**
 * Message types the server sends only on its own initiative. They never
 * settle a pending request even if they carry a clientMsgId.
 */
export const EVENT_PAYLOAD_TYPES: ReadonlySet<number> = new Set([
  PayloadType.HEARTBEAT_EVENT,
  PayloadType.TRAILING_SL_CHANGED_EVENT,
  PayloadType.SYMBOL_CHANGED_EVENT,
  PayloadType.TRADER_UPDATE_EVENT,
  PayloadType.SPOT_EVENT,
  PayloadType.MARGIN_CHANGED_EVENT,
  PayloadType.ACCOUNTS_TOKEN_INVALIDATED_EVENT,
  PayloadType.CLIENT_DISCONNECT_EVENT,
  PayloadType.ACCOUNT_DISCONNECT_EVENT,
])

/**
 * Replies that also describe account state (order accepted, filled,
 * rejected). They settle the matching request and are broadcast as events.
 */
export const BROADCAST_REPLY_PAYLOAD_TYPES: ReadonlySet<number> = new Set([
  PayloadType.EXECUTION_EVENT,
  PayloadType.ORDER_ERROR_EVENT,
])

/** Common ProtoErrorCode names that mean the request can be retried later. */
export const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'TIMEOUT_ERROR',
  'CANT_ROUTE_REQUEST',
  'BLOCKED_PAYLOAD_TYPE',
])

/** One message on the JSON wire, in either direction. */
export interface CtraderEnvelope {
  payloadType: number
  payload?: Record<string, unknown>
  clientMsgId?: string
}

export interface CtraderErrorPayload {
  errorCode?: string
  description?: string
  ctidTraderAccountId?: number
  maintenanceEndTimestamp?: number
}
