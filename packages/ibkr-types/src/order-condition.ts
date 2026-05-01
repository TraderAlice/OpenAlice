/**
 * Mirrors: ibapi/order_condition.py
 */

import { UNSET_DOUBLE } from './const.js'

// Helper to pull next value from an iterator
function nextField(fields: Iterator<string>): string {
  const r = fields.next()
  if (r.done) throw new Error('unexpected end')
  return r.value
}

function decodeBool(fields: Iterator<string>): boolean {
  return parseInt(nextField(fields), 10) !== 0
}

function decodeInt(fields: Iterator<string>): number {
  return parseInt(nextField(fields), 10)
}

function decodeStr(fields: Iterator<string>): string {
  return nextField(fields)
}

function makeField(val: unknown): string {
  if (typeof val === 'boolean') return val ? '1' : '0'
  return String(val ?? '')
}

export class OrderCondition {
  static readonly Price = 1
  static readonly Time = 3
  static readonly Margin = 4
  static readonly Execution = 5
  static readonly Volume = 6
  static readonly PercentChange = 7

  condType: number
  isConjunctionConnection = true

  constructor(condType: number) {
    this.condType = condType
  }

  type(): number {
    return this.condType
  }

  And(): this {
    this.isConjunctionConnection = true
    return this
  }

  Or(): this {
    this.isConjunctionConnection = false
    return this
  }

  decode(fields: Iterator<string>): void {
    const connector = decodeStr(fields)
    this.isConjunctionConnection = connector === 'a'
  }

  makeFields(): string[] {
    return [makeField(this.isConjunctionConnection ? 'a' : 'o')]
  }

  toString(): string {
    return this.isConjunctionConnection ? '<AND>' : '<OR>'
  }
}

export class ExecutionCondition extends OrderCondition {
  secType: string | null
  exchange: string | null
  symbol: string | null

  constructor(secType: string | null = null, exch: string | null = null, symbol: string | null = null) {
    super(OrderCondition.Execution)
    this.secType = secType
    this.exchange = exch
    this.symbol = symbol
  }

  decode(fields: Iterator<string>): void {
    super.decode(fields)
    this.secType = decodeStr(fields)
    this.exchange = decodeStr(fields)
    this.symbol = decodeStr(fields)
  }

  makeFields(): string[] {
    return [
      ...super.makeFields(),
      makeField(this.secType),
      makeField(this.exchange),
      makeField(this.symbol),
    ]
  }

  toString(): string {
    return (
      'trade occurs for ' +
      this.symbol +
      ' symbol on ' +
      this.exchange +
      ' exchange for ' +
      this.secType +
      ' security type'
    )
  }
}

export abstract class OperatorCondition extends OrderCondition {
  isMore: boolean | null

  constructor(condType: number | null = null, isMore: boolean | null = null) {
    super(condType ?? 0)
    this.isMore = isMore
  }

  abstract valueToString(): string
  abstract setValueFromString(text: string): void

  decode(fields: Iterator<string>): void {
    super.decode(fields)
    this.isMore = decodeBool(fields)
    const text = decodeStr(fields)
    this.setValueFromString(text)
  }

  makeFields(): string[] {
    return [
      ...super.makeFields(),
      makeField(this.isMore),
      makeField(this.valueToString()),
    ]
  }

  toString(): string {
    const sb = this.isMore ? '>= ' : '<= '
    return ` ${sb} ${this.valueToString()}`
  }
}

export class MarginCondition extends OperatorCondition {
  percent: number | null

  constructor(isMore: boolean | null = null, percent: number | null = null) {
    super(OrderCondition.Margin, isMore)
    this.percent = percent
  }

  decode(fields: Iterator<string>): void {
    super.decode(fields)
  }

  makeFields(): string[] {
    return super.makeFields()
  }

  valueToString(): string {
    return String(this.percent)
  }

  setValueFromString(text: string): void {
    this.percent = parseFloat(text)
  }

  toString(): string {
    return `the margin cushion percent ${OperatorCondition.prototype.toString.call(this)} `
  }
}

export class ContractCondition extends OperatorCondition {
  conId: number | null
  exchange: string | null

  constructor(
    condType: number | null = null,
    conId: number | null = null,
    exch: string | null = null,
    isMore: boolean | null = null,
  ) {
    super(condType, isMore)
    this.conId = conId
    this.exchange = exch
  }

  decode(fields: Iterator<string>): void {
    super.decode(fields)
    this.conId = decodeInt(fields)
    this.exchange = decodeStr(fields)
  }

  makeFields(): string[] {
    return [
      ...super.makeFields(),
      makeField(this.conId),
      makeField(this.exchange),
    ]
  }

  valueToString(): string {
    return ''
  }

  setValueFromString(_text: string): void {
    // todo
  }

  toString(): string {
    return `${this.conId} on ${this.exchange} is ${OperatorCondition.prototype.toString.call(this)} `
  }
}

export class TimeCondition extends OperatorCondition {
  time: string | null

  constructor(isMore: boolean | null = null, time: string | null = null) {
    super(OrderCondition.Time, isMore)
    this.time = time
  }

  decode(fields: Iterator<string>): void {
    super.decode(fields)
  }

  makeFields(): string[] {
    return super.makeFields()
  }

  valueToString(): string {
    return this.time ?? ''
  }

  setValueFromString(text: string): void {
    this.time = text
  }

  toString(): string {
    return `time is ${OperatorCondition.prototype.toString.call(this)} `
  }
}

export const TriggerMethodEnum = {
  Default: 0,
  DoubleBidAsk: 1,
  Last: 2,
  DoubleLast: 3,
  BidAsk: 4,
  'N/A1': 5,
  'N/A2': 6,
  LastBidAsk: 7,
  MidPoint: 8,
} as const

const TriggerMethodNames = [
  'Default',
  'DoubleBidAsk',
  'Last',
  'DoubleLast',
  'BidAsk',
  'N/A1',
  'N/A2',
  'LastBidAsk',
  'MidPoint',
]

export class PriceCondition extends ContractCondition {
  price: number | null
  triggerMethod: number | null

  constructor(
    triggerMethod: number | null = null,
    conId: number | null = null,
    exch: string | null = null,
    isMore: boolean | null = null,
    price: number | null = null,
  ) {
    super(OrderCondition.Price, conId, exch, isMore)
    this.price = price
    this.triggerMethod = triggerMethod
  }

  decode(fields: Iterator<string>): void {
    super.decode(fields)
    this.triggerMethod = decodeInt(fields)
  }

  makeFields(): string[] {
    return [
      ...super.makeFields(),
      makeField(this.triggerMethod),
    ]
  }

  valueToString(): string {
    return String(this.price)
  }

  setValueFromString(text: string): void {
    this.price = parseFloat(text)
  }

  toString(): string {
    const methodName = TriggerMethodNames[this.triggerMethod ?? 0] ?? String(this.triggerMethod)
    return `${methodName} price of ${ContractCondition.prototype.toString.call(this)} `
  }
}

export class PercentChangeCondition extends ContractCondition {
  changePercent: number

  constructor(
    conId: number | null = null,
    exch: string | null = null,
    isMore: boolean | null = null,
    changePercent: number = UNSET_DOUBLE,
  ) {
    super(OrderCondition.PercentChange, conId, exch, isMore)
    this.changePercent = changePercent
  }

  decode(fields: Iterator<string>): void {
    super.decode(fields)
  }

  makeFields(): string[] {
    return super.makeFields()
  }

  valueToString(): string {
    return String(this.changePercent)
  }

  setValueFromString(text: string): void {
    this.changePercent = parseFloat(text)
  }

  toString(): string {
    return `percent change of ${ContractCondition.prototype.toString.call(this)} `
  }
}

export class VolumeCondition extends ContractCondition {
  volume: number | null

  constructor(
    conId: number | null = null,
    exch: string | null = null,
    isMore: boolean | null = null,
    volume: number | null = null,
  ) {
    super(OrderCondition.Volume, conId, exch, isMore)
    this.volume = volume
  }

  decode(fields: Iterator<string>): void {
    super.decode(fields)
  }

  makeFields(): string[] {
    return super.makeFields()
  }

  valueToString(): string {
    return String(this.volume)
  }

  setValueFromString(text: string): void {
    this.volume = parseInt(text, 10)
  }

  toString(): string {
    return `volume of ${ContractCondition.prototype.toString.call(this)} `
  }
}

export function Create(condType: number): OrderCondition | null {
  switch (condType) {
    case OrderCondition.Execution:
      return new ExecutionCondition()
    case OrderCondition.Margin:
      return new MarginCondition()
    case OrderCondition.PercentChange:
      return new PercentChangeCondition()
    case OrderCondition.Price:
      return new PriceCondition()
    case OrderCondition.Time:
      return new TimeCondition()
    case OrderCondition.Volume:
      return new VolumeCondition()
    default:
      return null
  }
}
