/**
 * CN Local Paper settlement — T+0 vs T+1 for secondary-market trading.
 *
 * Pure / deterministic: same inputs → same Settlement. No network.
 * Priority: VERIFIED table > category heuristics > conservative T1.
 */

export type SettlementMode = 'T0' | 'T1'
export type SettlementSource = 'manual' | 'heuristic' | 'fallback'

export interface Settlement {
  symbol: string
  mode: SettlementMode
  source: SettlementSource
  reason: string
  /** Heuristic / unknown — should be human-reviewed into VERIFIED. */
  needsReview: boolean
}

interface VerifiedRow {
  mode: SettlementMode
  source: SettlementSource
  verifiedAt: string
  note: string
}

/** Manually verified 6-digit codes (no exchange suffix). */
export const VERIFIED_SETTLEMENT: Readonly<Record<string, VerifiedRow>> = {
  '513100': {
    mode: 'T0',
    source: 'manual',
    verifiedAt: '2026-09-28',
    note: '纳指 QDII ETF，二级市场当日回转',
  },
  '518880': {
    mode: 'T0',
    source: 'manual',
    verifiedAt: '2026-09-28',
    note: '黄金 ETF',
  },
}

const REVIEW_KW = ['沪港深', '港股通'] as const
const MONEY_KW = ['货币', '日利', '添益', '现金', '快线'] as const
const BOND_KW = ['债', '国开', '政金', '城投'] as const
const COMMODITY_KW = ['黄金', '白银', '豆粕', '有色', '能源化工', '原油'] as const
const CROSS_BORDER_KW = [
  'QDII', '纳斯达克', '纳指', '标普', '日经', '德国', '法国',
  '恒生', '港股', '中概', '沙特', '越南', '印度', '亚太', '海外',
] as const

const CB_PREFIX = ['110', '113', '118', '111', '123', '127', '128'] as const
const ETF_PREFIX = ['51', '56', '58', '15', '16'] as const
const STOCK_PREFIX = ['60', '00', '30', '68', '688'] as const

function bareCode(symbol: string): string {
  return symbol.split('.')[0]!.replace(/^(sh|sz|bj)/i, '').trim()
}

function hasKw(text: string, kws: readonly string[]): boolean {
  return kws.some((k) => text.includes(k))
}

/**
 * @param symbol - `513100` or `513100.SH`
 * @param name - security short name / fund title (Tencent name or etf_basic.extname)
 * @param etfType - optional Tushare `etf_basic.etf_type`
 */
export function getSettlement(
  symbol: string,
  name = '',
  etfType = '',
): Settlement {
  const code = bareCode(symbol)

  const verified = VERIFIED_SETTLEMENT[code]
  if (verified) {
    return {
      symbol: code,
      mode: verified.mode,
      source: verified.source,
      reason: verified.note,
      needsReview: false,
    }
  }

  if (code.length === 6 && CB_PREFIX.some((p) => code.startsWith(p))) {
    return {
      symbol: code,
      mode: 'T0',
      source: 'heuristic',
      reason: '可转债代码段',
      needsReview: false,
    }
  }

  if (ETF_PREFIX.some((p) => code.startsWith(p))) {
    const haystack = `${name} ${etfType}`.trim()
    if (!haystack) {
      return {
        symbol: code,
        mode: 'T1',
        source: 'fallback',
        reason: 'ETF 代码段但缺少名称/类型，无法分类，保守 T1',
        needsReview: true,
      }
    }
    const upper = haystack.toUpperCase()
    if (hasKw(haystack, REVIEW_KW) || hasKw(upper, REVIEW_KW)) {
      return {
        symbol: code,
        mode: 'T1',
        source: 'fallback',
        reason: '沪港深/港股通类含 A 股成分，需人工核对',
        needsReview: true,
      }
    }
    for (const [kws, label] of [
      [MONEY_KW, '货币 ETF'],
      [BOND_KW, '债券 ETF'],
      [COMMODITY_KW, '商品 ETF'],
      [CROSS_BORDER_KW, '跨境 ETF'],
    ] as const) {
      if (hasKw(haystack, kws) || hasKw(upper, kws)) {
        return {
          symbol: code,
          mode: 'T0',
          source: 'heuristic',
          reason: `类别推断：${label}`,
          needsReview: true,
        }
      }
    }
    return {
      symbol: code,
      mode: 'T1',
      source: 'heuristic',
      reason: '类别推断：A 股股票型 ETF',
      needsReview: false,
    }
  }

  if (STOCK_PREFIX.some((p) => code.startsWith(p))) {
    return {
      symbol: code,
      mode: 'T1',
      source: 'heuristic',
      reason: 'A 股股票',
      needsReview: false,
    }
  }

  return {
    symbol: code,
    mode: 'T1',
    source: 'fallback',
    reason: '未知品种，保守 T1',
    needsReview: true,
  }
}

/** True when secondary-market buys must wait until the next session to sell. */
export function isTPlus1Settlement(symbol: string, name = '', etfType = ''): boolean {
  return getSettlement(symbol, name, etfType).mode === 'T1'
}
