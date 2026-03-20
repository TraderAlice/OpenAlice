/**
 * Convert standard Markdown to Telegram-compatible HTML.
 *
 * Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">.
 * Headers, tables, and other advanced markdown are converted to approximate
 * equivalents (bold headers, preformatted tables).
 */

const PLACEHOLDER = '\x00CB'

interface CodeBlock {
  placeholder: string
  html: string
}

/**
 * Convert markdown text to Telegram HTML format.
 * Returns a string safe to use with parse_mode: 'HTML'.
 */
export function markdownToTelegramHtml(md: string): string {
  const blocks: CodeBlock[] = []
  let blockIdx = 0

  // 1. Extract fenced code blocks before any escaping
  let text = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const ph = `${PLACEHOLDER}${blockIdx++}${PLACEHOLDER}`
    blocks.push({ placeholder: ph, html: `<pre>${escapeHtml(code.trimEnd())}</pre>` })
    return ph
  })

  // 2. Extract inline code
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const ph = `${PLACEHOLDER}${blockIdx++}${PLACEHOLDER}`
    blocks.push({ placeholder: ph, html: `<code>${escapeHtml(code)}</code>` })
    return ph
  })

  // 3. Escape HTML entities in remaining text
  text = escapeHtml(text)

  // 4. Headers → bold (## Header → \n<b>Header</b>\n)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')

  // 5. Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  text = text.replace(/__(.+?)__/g, '<b>$1</b>')

  // 6. Italic: *text* or _text_ (not inside bold markers)
  text = text.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>')
  text = text.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>')

  // 7. Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // 8. Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // 9. Restore code blocks
  for (const block of blocks) {
    text = text.replace(block.placeholder, block.html)
  }

  return text.trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
