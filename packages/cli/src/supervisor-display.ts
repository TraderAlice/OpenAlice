export function displayWidth(value: string): number {
  let width = 0
  for (const { segment } of graphemes(value)) width += graphemeWidth(segment)
  return width
}

export function truncateDisplayWidth(value: string, width: number): string {
  if (width <= 0) return ''
  if (displayWidth(value) <= width) return value
  const ellipsis = '…'
  const budget = Math.max(0, width - graphemeWidth(ellipsis))
  let output = ''
  let used = 0
  for (const { segment } of graphemes(value)) {
    const next = graphemeWidth(segment)
    if (used + next > budget) break
    output += segment
    used += next
  }
  return `${output}${ellipsis}`
}

function graphemes(value: string): Iterable<{ segment: string }> {
  return new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)
}

function graphemeWidth(value: string): number {
  if (/^\p{Mark}+$/u.test(value)) return 0
  if (value.includes('\uFE0F') || /\p{Emoji_Presentation}/u.test(value)) return 2
  const code = value.codePointAt(0) ?? 0
  return isWideCodePoint(code) ? 2 : 1
}

function isWideCodePoint(code: number): boolean {
  return code >= 0x1100 && (
    code <= 0x115f
    || code === 0x2329
    || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x20000 && code <= 0x3fffd)
  )
}
