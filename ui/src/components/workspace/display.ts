import type { SessionRecord, Workspace } from './api'

export function workspaceDisplayName(w: Workspace): string {
  return w.displayName?.trim() || w.tag
}

/** Soft cap for sidebar / top-bar Session chrome — identity, not the full prompt. */
export const SESSION_CHROME_TITLE_MAX = 18

const STRATEGY_HINTS = [
  '有界马丁格尔',
  '马丁格尔',
  '双动量策略',
  '双动量',
  'Dual Momentum',
  '截面动量',
  '动量',
  '波动率',
  'regime',
] as const

/** Parentheticals that are prompt scaffolding, not ticker/company names. */
const PAREN_NOISE = /调用方|已有判断|决策用途|研究问题|固定规则|优先回答|沪深\d{3}|缺什么|先问我|可用数据|事件定义|概率中枢|锚点/u

const BARE_SUBJECTS = ['豫光金铅', '英伟达', '茅台'] as const

function clampChromeTitle(value: string, maxChars: number): string {
  const chars = [...value.trim()]
  if (chars.length <= maxChars) return chars.join('')
  return chars.slice(0, maxChars).join('').replace(/[·\s，,：:\-–—]+$/u, '')
}

function joinChrome(left: string, right: string, maxChars: number): string {
  return clampChromeTitle(`${left} · ${right}`, maxChars)
}

function normalizeChromeBody(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim()
  // Pasted product chrome sometimes prefixes the real user prompt.
  text = text.replace(
    /^OpenAlice(?:\s+(?:Quick Start|Inbox|Issues|Tracked|Market|Trading|Chat))+\s+/iu,
    '',
  )
  text = text.replace(/^研究问题[：:]\s*/u, '')
  text = text.replace(/\*{1,2}/g, '')
  return text.trim()
}

function pickStrategy(body: string): string | undefined {
  const lower = body.toLowerCase()
  const hit = STRATEGY_HINTS.find((hint) => lower.includes(hint.toLowerCase()))
  if (!hit) return undefined
  if (hit === 'Dual Momentum' || hit === '双动量策略') return '双动量'
  return hit
}

function pickParenCnName(body: string): string | undefined {
  for (const match of body.matchAll(/[（(]\s*([^）)]+?)\s*[）)]/gu)) {
    const inner = match[1]?.trim()
    if (!inner || PAREN_NOISE.test(inner)) continue
    const cjk = inner.match(/[\u4e00-\u9fff]{2,12}/u)
    if (cjk?.[0]) return cjk[0]
  }
  return undefined
}

function pickBareSubject(body: string): string | undefined {
  return BARE_SUBJECTS.find((name) => body.includes(name))
}

function pickAShareTicker(body: string): string | undefined {
  return body.match(/\b(\d{6}\.(?:SH|SZ|BJ))\b/)?.[1]
    ?? body.match(/(?:^|[^\d])(\d{6})(?:\.(?:SH|SZ|BJ))?(?=[^\d]|$)/)?.[1]
}

function pickUsTicker(body: string): string | undefined {
  return body.match(/\b(AAPL|NVDA|TSLA|MSFT|GOOG|GOOGL|AMZN|META)\b/)?.[1]
}

function pickBookFrame(body: string): string | undefined {
  return body.match(/「([^」]{2,48})」/u)?.[1]?.trim()
}

function shortenBookFrame(frame: string, maxChars: number): string | undefined {
  const wti = frame.match(/\b(WTI)\b/i)?.[1]
  if (wti && /80/.test(frame)) return joinChrome(wti.toUpperCase(), '跌破80', maxChars)

  const cn = pickParenCnName(frame) ?? pickBareSubject(frame)
  const ticker = pickAShareTicker(frame)
  if (cn) return clampChromeTitle(cn, maxChars)
  if (ticker) return clampChromeTitle(ticker, maxChars)

  // Keep a scannable lead from the book title itself.
  const lead = frame
    .replace(/这一宏观事件.*$/u, '')
    .replace(/框架下.*$/u, '')
    .replace(/是否.+$/u, '')
    .trim()
  if (lead && [...lead].length <= maxChars) return lead
  if (lead) return clampChromeTitle(lead, maxChars)
  return undefined
}

function firstClause(body: string): string {
  const cut = body.search(/[，。；;！？?\n]/u)
  return (cut === -1 ? body : body.slice(0, cut)).trim()
}

function mostlyLatin(text: string): boolean {
  const chars = [...text]
  if (chars.length === 0) return false
  let latin = 0
  for (const char of chars) {
    if (/[A-Za-z]/.test(char)) latin += 1
  }
  return latin * 2 >= chars.length
}

/**
 * Shrink a launch prompt / native title into a one-line chrome label.
 * Prefer “标的 · 方法”; never invent facts beyond what’s already in the string.
 * When nothing compact extracts, clamp the first clause so chrome stays short.
 */
export function shortenSessionChromeTitle(raw: string, maxChars = SESSION_CHROME_TITLE_MAX): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return text

  const body = normalizeChromeBody(text) || text
  const strategy = pickStrategy(body)
  // Prefer known bare subjects (豫光金铅) over scaffold parentheticals.
  const cnName = pickBareSubject(body) ?? pickParenCnName(body)
  const aShare = pickAShareTicker(body)
  const usTicker = pickUsTicker(body)
  const book = pickBookFrame(body)
  const overLong = [...text].length > maxChars || [...body].length > maxChars

  if (cnName && strategy) return joinChrome(cnName, strategy, maxChars)
  if (aShare && strategy) return joinChrome(aShare, strategy, maxChars)
  if (strategy && (body.includes('双动量') || /dual\s*momentum/i.test(body))) {
    return clampChromeTitle(strategy, maxChars)
  }

  if (/Studio capability|Harness Workspace/i.test(body)) {
    return clampChromeTitle('Studio', maxChars)
  }
  if (/宏观/.test(body) && /跨资产|板块轮动/.test(body)) {
    return joinChrome('今日宏观', '跨资产', maxChars)
  }
  if (/longbridge/i.test(body) && /港股/.test(body)) {
    return joinChrome('Longbridge', '港股', maxChars)
  }
  if (/QMT/.test(body)) {
    return joinChrome(/华安/.test(body) ? '华安QMT' : 'QMT', '实时接口', maxChars)
  }
  if (/英伟达/.test(body)) {
    return joinChrome('英伟达', '投资逻辑', maxChars)
  }
  if (/auto\s*quant/i.test(body) && /算法/.test(body)) {
    return joinChrome('算法私用', '下一步', maxChars)
  }
  if (usTicker && (/FMP/i.test(body) || /基本面/.test(body))) {
    return joinChrome(usTicker, /FMP/i.test(body) ? 'FMP' : '基本面', maxChars)
  }
  if (aShare && (/利润表|income_statement/i.test(body))) {
    return joinChrome(aShare.includes('.') ? aShare.slice(0, 6) : aShare, '利润表', maxChars)
  }

  if (book) {
    const fromBook = shortenBookFrame(book, maxChars)
    if (fromBook) {
      if (strategy && !fromBook.includes('·')) return joinChrome(fromBook, strategy, maxChars)
      return fromBook
    }
  }
  if (/石油|油价|WTI/i.test(body) && /80/.test(body)) {
    return joinChrome(/WTI/i.test(body) ? 'WTI' : '石油', '80美元', maxChars)
  }

  if (cnName && overLong) return clampChromeTitle(cnName, maxChars)

  if (!overLong) return [...body].length <= maxChars ? body : text

  // Bare tickers alone are too weak for Latin titles ("Review AAPL earnings");
  // keep A-share codes when the prompt is already over-long CJK/mixed text.
  if (aShare && !mostlyLatin(body)) return clampChromeTitle(aShare, maxChars)

  const clause = firstClause(body)
  // Latin-only leftovers stay full so SpacedTruncate owns the ellipsis mark.
  if (mostlyLatin(clause)) return text
  return clampChromeTitle(clause, maxChars)
}

/**
 * Workspace-owned coworker nametag → short chrome title → sticky launcher name.
 * Explicit displayName is never auto-rewritten.
 */
export function sessionCoworkerLabel(
  session: Pick<SessionRecord, 'title' | 'name' | 'displayName'>,
): string {
  return sessionChromeLabel(session)
}

/** Same as sessionCoworkerLabel, with an optional roster override title. */
export function sessionChromeLabel(
  session: Pick<SessionRecord, 'title' | 'name' | 'displayName'>,
  overrideTitle?: string | null,
): string {
  const named = session.displayName?.trim()
  if (named) return named
  const raw = overrideTitle?.trim() || session.title?.trim() || session.name
  return shortenSessionChromeTitle(raw)
}

export function workspaceDisplayTitle(w: Workspace): string {
  const display = workspaceDisplayName(w)
  return display === w.tag ? w.tag : `${display}\n${w.tag}`
}
