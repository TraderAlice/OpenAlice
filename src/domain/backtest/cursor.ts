/**
 * BarCursor implementation — enforces strict temporal access.
 *
 * Internally holds a reference to the full bar array, but the public
 * API only exposes bars at indices ≤ current. Any attempt to read
 * forward returns undefined; there is no escape hatch, no "just peek"
 * method. This makes look-ahead bias a compile-time-visible mistake.
 */

import type { Bar, BarCursor } from './types.js'

export class BarCursorImpl implements BarCursor {
  private _index = 0

  constructor(private readonly bars: readonly Bar[]) {
    if (bars.length === 0) {
      throw new Error('BarCursor requires at least one bar')
    }
  }

  get index(): number {
    return this._index
  }

  get current(): Bar {
    return this.bars[this._index]
  }

  lookback(offset: number): Bar | undefined {
    if (offset < 0) {
      throw new Error(`BarCursor.lookback offset must be non-negative, got ${offset}`)
    }
    const target = this._index - offset
    if (target < 0) return undefined
    return this.bars[target]
  }

  lastN(n: number): Bar[] {
    if (n <= 0) return []
    const start = Math.max(0, this._index - n + 1)
    return this.bars.slice(start, this._index + 1)
  }

  /** Package-private: advance the cursor by one bar. */
  _advance(): void {
    if (this._index + 1 >= this.bars.length) {
      throw new Error('BarCursor: cannot advance past end of bars')
    }
    this._index += 1
  }

  /** Package-private: are there more bars after current? */
  _hasNext(): boolean {
    return this._index + 1 < this.bars.length
  }

  /** Package-private: peek the NEXT bar (used by the execution model
   *  for next-bar fills — callers must NOT leak this to strategies). */
  _peekNext(): Bar | undefined {
    return this.bars[this._index + 1]
  }

  /** Total number of bars in the underlying series (for runner bookkeeping). */
  _total(): number {
    return this.bars.length
  }
}
