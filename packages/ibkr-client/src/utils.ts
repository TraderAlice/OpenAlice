/**
 * Collection of misc tools — field decoding, validation, formatting.
 * Mirrors: ibapi/utils.py
 */

import Decimal from 'decimal.js'
import {
  UNSET_INTEGER,
  UNSET_DOUBLE,
  UNSET_LONG,
  UNSET_DECIMAL,
  DOUBLE_INFINITY,
  INFINITY_STR,
} from '@traderalice/ibkr-types'

export class BadMessage extends Error {
  constructor(text: string) {
    super(text)
    this.name = 'BadMessage'
  }
}

export class ClientException extends Error {
  code: number
  msg: string
  text: string

  constructor(code: number, msg: string, text: string) {
    super(`${msg}${text}`)
    this.name = 'ClientException'
    this.code = code
    this.msg = msg
    this.text = text
  }
}

export const SHOW_UNSET = true

/**
 * Central field decoder. Reads next field from an iterator and converts to the
 * requested type.
 *
 * Python's `decode(the_type, fields, show_unset)` — we use a string discriminator
 * instead of Python's type objects.
 */
export function decodeStr(fields: Iterator<string>): string {
  const r = fields.next()
  if (r.done) throw new BadMessage('no more fields')
  return r.value
}

export function decodeInt(fields: Iterator<string>, showUnset = false): number {
  const r = fields.next()
  if (r.done) throw new BadMessage('no more fields')
  const s = r.value
  if (showUnset) {
    if (s === null || s === undefined || s.length === 0) return UNSET_INTEGER
    return parseInt(s, 10)
  }
  return parseInt(s || '0', 10)
}

export function decodeFloat(fields: Iterator<string>, showUnset = false): number {
  const r = fields.next()
  if (r.done) throw new BadMessage('no more fields')
  const s = r.value
  if (s === INFINITY_STR) return DOUBLE_INFINITY
  if (showUnset) {
    if (s === null || s === undefined || s.length === 0) return UNSET_DOUBLE
    return parseFloat(s)
  }
  return parseFloat(s || '0')
}

export function decodeBool(fields: Iterator<string>): boolean {
  const r = fields.next()
  if (r.done) throw new BadMessage('no more fields')
  const s = r.value
  return parseInt(s || '0', 10) !== 0
}

export function decodeDecimal(fields: Iterator<string>): Decimal {
  const r = fields.next()
  if (r.done) throw new BadMessage('no more fields')
  const s = r.value
  if (
    s === null ||
    s === undefined ||
    s.length === 0 ||
    s === '2147483647' ||
    s === '9223372036854775807' ||
    s === '1.7976931348623157E308' ||
    s === '-9223372036854775808'
  ) {
    return UNSET_DECIMAL
  }
  return new Decimal(s)
}

export function decodeLong(fields: Iterator<string>, showUnset = false): bigint {
  const r = fields.next()
  if (r.done) throw new BadMessage('no more fields')
  const s = r.value
  if (showUnset) {
    if (s === null || s === undefined || s.length === 0) return UNSET_LONG
    return BigInt(s)
  }
  return BigInt(s || '0')
}

// Validation helpers

export function isValidFloatValue(val: number): boolean {
  return val !== UNSET_DOUBLE
}

export function isValidIntValue(val: number): boolean {
  return val !== UNSET_INTEGER
}

export function isValidLongValue(val: bigint): boolean {
  return val !== UNSET_LONG
}

export function isValidDecimalValue(val: Decimal): boolean {
  return !val.equals(UNSET_DECIMAL)
}

// Formatting helpers

export function floatMaxString(val: number | null | undefined): string {
  if (val == null) return ''
  if (val === UNSET_DOUBLE) return ''
  // Match Python's f"{val:.8f}".rstrip("0").rstrip(".").rstrip(",")
  const s = val.toFixed(8)
  return s.replace(/0+$/, '').replace(/\.$/, '').replace(/,$/, '')
}

export function longMaxString(val: bigint): string {
  return val !== UNSET_LONG ? String(val) : ''
}

export function intMaxString(val: number): string {
  return val !== UNSET_INTEGER ? String(val) : ''
}

export function decimalMaxString(val: Decimal): string {
  if (val.equals(UNSET_DECIMAL)) return ''
  return val.toFixed()
}

export function isAsciiPrintable(val: string): boolean {
  for (let i = 0; i < val.length; i++) {
    const c = val.charCodeAt(i)
    if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13) continue
    return false
  }
  return true
}

export function isPegBenchOrder(orderType: string): boolean {
  return orderType === 'PEG BENCH' || orderType === 'PEGBENCH'
}

export function isPegMidOrder(orderType: string): boolean {
  return orderType === 'PEG MID' || orderType === 'PEGMID'
}

export function isPegBestOrder(orderType: string): boolean {
  return orderType === 'PEG BEST' || orderType === 'PEGBEST'
}

export function currentTimeMillis(): number {
  return Date.now()
}

export function getTimeStrFromMillis(time: number): string {
  if (time <= 0) return ''
  return new Date(time).toISOString()
}
