/**
 * Mirrors: tests/test_utils.py + additional decode tests
 */

import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import {
  decodeStr, decodeInt, decodeFloat, decodeBool, decodeDecimal,
  floatMaxString, intMaxString, decimalMaxString,
  isAsciiPrintable, BadMessage,
} from '../src/utils.js'
import { UNSET_DOUBLE, UNSET_INTEGER, UNSET_DECIMAL, DOUBLE_INFINITY } from '@traderalice/ibkr-types'
import { TickTypeEnum, tickTypeToString } from '@traderalice/ibkr-types'

function iter(arr: string[]): Iterator<string> {
  return arr[Symbol.iterator]()
}

describe('decode functions', () => {
  it('decodeStr: reads next string field', () => {
    expect(decodeStr(iter(['hello', 'world']))).toBe('hello')
  })

  it('decodeStr: throws BadMessage when empty', () => {
    expect(() => decodeStr(iter([]))).toThrow(BadMessage)
  })

  it('decodeInt: parses integer', () => {
    expect(decodeInt(iter(['42']))).toBe(42)
  })

  it('decodeInt: empty string → 0 (no showUnset)', () => {
    expect(decodeInt(iter(['']))).toBe(0)
  })

  it('decodeInt: empty string → UNSET_INTEGER (showUnset)', () => {
    expect(decodeInt(iter(['']), true)).toBe(UNSET_INTEGER)
  })

  it('decodeFloat: parses float', () => {
    expect(decodeFloat(iter(['3.14']))).toBeCloseTo(3.14)
  })

  it('decodeFloat: "Infinity" → DOUBLE_INFINITY', () => {
    expect(decodeFloat(iter(['Infinity']))).toBe(DOUBLE_INFINITY)
  })

  it('decodeFloat: empty → UNSET_DOUBLE (showUnset)', () => {
    expect(decodeFloat(iter(['']), true)).toBe(UNSET_DOUBLE)
  })

  it('decodeBool: "0" → false, "1" → true', () => {
    expect(decodeBool(iter(['0']))).toBe(false)
    expect(decodeBool(iter(['1']))).toBe(true)
  })

  it('decodeDecimal: parses Decimal', () => {
    const d = decodeDecimal(iter(['123.456']))
    expect(d.toString()).toBe('123.456')
  })

  it('decodeDecimal: sentinel values → UNSET_DECIMAL', () => {
    expect(decodeDecimal(iter(['2147483647'])).equals(UNSET_DECIMAL)).toBe(true)
    expect(decodeDecimal(iter(['9223372036854775807'])).equals(UNSET_DECIMAL)).toBe(true)
    expect(decodeDecimal(iter(['1.7976931348623157E308'])).equals(UNSET_DECIMAL)).toBe(true)
    expect(decodeDecimal(iter([''])).equals(UNSET_DECIMAL)).toBe(true)
  })
})

describe('formatting helpers', () => {
  it('floatMaxString: UNSET → empty', () => {
    expect(floatMaxString(UNSET_DOUBLE)).toBe('')
  })

  it('floatMaxString: normal value → formatted', () => {
    expect(floatMaxString(3.14)).toBe('3.14')
  })

  it('floatMaxString: null → empty', () => {
    expect(floatMaxString(null)).toBe('')
  })

  it('intMaxString: UNSET → empty', () => {
    expect(intMaxString(UNSET_INTEGER)).toBe('')
  })

  it('intMaxString: normal value → string', () => {
    expect(intMaxString(42)).toBe('42')
  })

  it('decimalMaxString: UNSET → empty', () => {
    expect(decimalMaxString(UNSET_DECIMAL)).toBe('')
  })

  it('decimalMaxString: normal value → string', () => {
    expect(decimalMaxString(new Decimal('123.45'))).toBe('123.45')
  })
})

describe('isAsciiPrintable', () => {
  it('normal ASCII → true', () => {
    expect(isAsciiPrintable('hello world')).toBe(true)
  })

  it('tabs and newlines → true', () => {
    expect(isAsciiPrintable('hello\tworld\n')).toBe(true)
  })

  it('non-ASCII → false', () => {
    expect(isAsciiPrintable('héllo')).toBe(false)
  })
})

describe('TickTypeEnum', () => {
  it('has expected values', () => {
    expect(TickTypeEnum.BID).toBe(1)
    expect(TickTypeEnum.ASK).toBe(2)
    expect(TickTypeEnum.LAST).toBe(4)
    expect(TickTypeEnum.CLOSE).toBe(9)
    expect(TickTypeEnum.NOT_SET).toBe(105)
  })

  it('tickTypeToString resolves names', () => {
    expect(tickTypeToString(1)).toBe('BID')
    expect(tickTypeToString(999)).toBe('Unknown(999)')
  })
})
