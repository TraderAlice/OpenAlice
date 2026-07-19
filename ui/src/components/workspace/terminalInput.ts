export const TERMINAL_FONT_FAMILY =
  'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "DejaVu Sans Mono", ' +
  '"Maple Mono NF CN", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans CJK SC", "PingFang SC", monospace'

export function describeTerminalInput(data: string): string {
  return Array.from(data)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0
      const hex = code.toString(16).toUpperCase().padStart(4, '0')
      const label =
        ch === '\r' ? 'CR'
        : ch === '\n' ? 'LF'
        : ch === '\x1b' ? 'ESC'
        : ch
      return `${label}=U+${hex}`
    })
    .join(' ')
}
