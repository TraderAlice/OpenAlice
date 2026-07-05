export type KeyMap = Readonly<Record<string, string>>

export const TERMINAL_FONT_FAMILY =
  'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "DejaVu Sans Mono", ' +
  '"Maple Mono NF CN", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans CJK SC", "PingFang SC", monospace'

export function keySignature(ev: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'key'>): string {
  const parts: string[] = []
  if (ev.ctrlKey) parts.push('ctrl')
  if (ev.altKey) parts.push('alt')
  if (ev.shiftKey) parts.push('shift')
  if (ev.metaKey) parts.push('meta')
  parts.push(ev.key.toLowerCase())
  return parts.join('+')
}

export function keyMapForAgent(agent: string | null | undefined): KeyMap | undefined {
  switch (agent) {
    case 'claude':
      return { 'shift+enter': '\x1b\r' }
    case 'codex':
      // Codex is a crossterm TUI. It handles multiline as the modified
      // Shift+Enter key event, not as a bare LF byte.
      return { 'shift+enter': '\x1b[13;2u' }
    default:
      return undefined
  }
}

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
