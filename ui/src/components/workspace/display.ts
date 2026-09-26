import type { SessionRecord, Workspace } from './api'

export function workspaceDisplayName(w: Workspace): string {
  return w.displayName?.trim() || w.tag
}

/** Soft cap for sidebar / top-bar Session chrome — identity, not the full prompt. */
export const SESSION_CHROME_TITLE_MAX = 18

const STRATEGY_HINTS = [
  '有界马丁格尔',
  '马丁格尔',
  '双动量',
  'Dual Momentum',
  '截面动量',
  '动量',
  '波动率',
  'regime',
] as const

function clampChromeTitle(value: string, maxChars: number): string {
  const chars = [...value.trim()]
  if (chars.length <= maxChars) return chars.join('')
  return chars.slice(0, maxChars).join('').replace(/[·\s，,：:\-–—]+$/u, '')
}

/**
 * Shrink a launch prompt / native title into a one-line chrome label.
 * Prefer “标的 · 方法”; never invent facts beyond what’s already in the string.
 * When no compact identity extracts, keep the full string — SpacedTruncate
 * owns visual ellipsis so we never mid-word-clip without a mark.
 */
export function shortenSessionChromeTitle(raw: string, maxChars = SESSION_CHROME_TITLE_MAX): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return text
  if ([...text].length <= maxChars) return text

  const body = text.replace(/^研究问题[：:]\s*/u, '')
  const cnName = body.match(/[（(]\s*([^\s）)]{2,12})\s*[）)]/u)
  const ticker = body.match(/\b(\d{6}\.(?:SH|SZ|BJ))\b/)
  const strategy = STRATEGY_HINTS.find((hint) => body.toLowerCase().includes(hint.toLowerCase()))

  if (cnName?.[1] && strategy) {
    return clampChromeTitle(`${cnName[1]} · ${strategy}`, maxChars)
  }
  if (cnName?.[1] && [...body].length > maxChars) {
    return clampChromeTitle(cnName[1], maxChars)
  }
  if (ticker?.[1] && strategy) {
    return clampChromeTitle(`${ticker[1]} · ${strategy}`, maxChars)
  }

  // No compact extract — leave the real title for CSS truncation + spaced “…”.
  return text
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
