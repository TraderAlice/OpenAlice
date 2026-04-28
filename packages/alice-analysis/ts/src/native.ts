// Re-export the napi-rs generated module. The relative path resolves out of
// `ts/dist/` back up to the package root, where napi-rs emits `index.js`.
//
// `index.js` is napi-rs's standard CJS loader (it picks the right `.node` file
// for the host platform). Since this package declares `"type": "module"`, we
// can't `import` a `.js` CJS file directly — Node parses it as ESM and the
// inner `require('fs')` calls explode. We use `createRequire` to grab it as
// CJS through the proper interop path. This is the pattern the napi-rs README
// recommends for ESM consumers.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// `here` is `<pkg>/ts/dist`; the napi loader is at `<pkg>/index.js`.
const require_ = createRequire(import.meta.url)
const native = require_(resolve(here, '..', '..', 'index.js')) as NativeShape

export const version = native.version
export const smaRaw = native.smaRaw
export const emaRaw = native.emaRaw
export const stdevRaw = native.stdevRaw
export const maxRaw = native.maxRaw
export const minRaw = native.minRaw
export const sumRaw = native.sumRaw
export const averageRaw = native.averageRaw
export const rsiRaw = native.rsiRaw
export const bbandsRaw = native.bbandsRaw
export const macdRaw = native.macdRaw
export const atrRaw = native.atrRaw
export const evaluateFormulaNative = native.evaluateFormula
export const safeCalculate = native.safeCalculate

interface NativeShape {
  version: () => string
  smaRaw: (data: Float64Array, period: number) => number
  emaRaw: (data: Float64Array, period: number) => number
  stdevRaw: (data: Float64Array) => number
  maxRaw: (data: Float64Array) => number
  minRaw: (data: Float64Array) => number
  sumRaw: (data: Float64Array) => number
  averageRaw: (data: Float64Array) => number
  rsiRaw: (data: Float64Array, period: number) => number
  bbandsRaw: (
    data: Float64Array,
    period: number,
    stdDevMultiplier: number,
  ) => { upper: number; middle: number; lower: number }
  macdRaw: (
    data: Float64Array,
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
  ) => { macd: number; signal: number; histogram: number }
  atrRaw: (
    highs: Float64Array,
    lows: Float64Array,
    closes: Float64Array,
    period: number,
  ) => number
  evaluateFormula: (
    formula: string,
    fetcher: (
      symbol: string,
      interval: string,
      field: string,
    ) => Promise<{
      values: Float64Array
      source: { symbol: string; from: string; to: string; bars: number }
    }>,
    precision?: number,
  ) => Promise<{
    kind: 'number' | 'array' | 'object'
    n?: number
    a?: number[]
    arraySource?: { symbol: string; from: string; to: string; bars: number }
    o?: Record<string, number>
    dataRange: Record<
      string,
      { symbol: string; from: string; to: string; bars: number }
    >
  }>
  safeCalculate: (expression: string) => number
}
