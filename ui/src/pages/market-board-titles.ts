import type { ViewSpec } from '../tabs/types'

type BoardKind = Extract<ViewSpec, { kind: 'market-board' }>['params']['board']

/** Tab titles (plain English, matching the registry's other title strings). */
export const MARKET_BOARD_TITLES: Record<BoardKind, string> = {
  movers: 'Movers',
  calendar: 'Calendar',
  macro: 'Macro',
  'term-structure': 'Term Structure',
  'global-macro': 'Global Macro',
  shipping: 'Shipping',
  fed: 'Fed',
}
