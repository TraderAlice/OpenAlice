/**
 * TWS API constants — sentinel values for "unset" state.
 * Mirrors: ibapi/const.py
 */

import Decimal from 'decimal.js'

export const NO_VALID_ID = -1
export const MAX_MSG_LEN = 0xffffff // 16MB - 1byte
export const UNSET_INTEGER = 2 ** 31 - 1
export const UNSET_DOUBLE = Number.MAX_VALUE
export const UNSET_LONG = BigInt(2 ** 63) - 1n
export const UNSET_DECIMAL = new Decimal('170141183460469231731687303715884105727') // 2^127 - 1
export const DOUBLE_INFINITY = Infinity
export const INFINITY_STR = 'Infinity'
