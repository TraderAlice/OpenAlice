import type { InboxNotification } from '@traderalice/connector-protocol'
import { formatInboxProvenance } from './shared.js'

const MARKDOWN_V2_SPECIALS = new Set([
  '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!', '\\',
])

/** Escape a literal Telegram MarkdownV2 string. */
export function escapeTelegramMarkdownV2(text: string): string {
  return [...text].map((character) => (
    MARKDOWN_V2_SPECIALS.has(character) ? `\\${character}` : character
  )).join('')
}

function escapeTelegramMarkdownV2Code(text: string): string {
  return text.replace(/([`\\])/g, '\\$1')
}

function escapeTelegramMarkdownV2Url(url: string): string {
  return url.replace(/([)\\])/g, '\\$1')
}

/**
 * Convert common GFM/agent markdown into Telegram `parse_mode: MarkdownV2`.
 * Unmatched markers stay literal and are escaped so the Bot API does not 400.
 */
export function toTelegramMarkdownV2(source: string): string {
  const parts: string[] = []
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g
  let last = 0
  for (const match of source.matchAll(fence)) {
    const index = match.index ?? 0
    parts.push(convertMarkdownSection(source.slice(last, index)))
    const language = match[1].trim()
    const code = escapeTelegramMarkdownV2Code(match[2].replace(/\n$/, ''))
    parts.push(language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``)
    last = index + match[0].length
  }
  parts.push(convertMarkdownSection(source.slice(last)))
  return parts.join('')
}

function convertMarkdownSection(section: string): string {
  if (!section) return section
  return section.split('\n').map(convertMarkdownLine).join('\n')
}

function convertMarkdownLine(line: string): string {
  const heading = /^(#{1,6})\s+(.+)$/.exec(line)
  if (heading) return `*${escapeTelegramMarkdownV2(heading[2].trim())}*`
  const quote = /^>\s?(.*)$/.exec(line)
  if (quote) return `>${convertInline(quote[1])}`
  const unordered = /^(\s*)[-*+]\s+(.+)$/.exec(line)
  if (unordered) return `${unordered[1]}• ${convertInline(unordered[2])}`
  const ordered = /^(\s*)(\d+)\.\s+(.+)$/.exec(line)
  if (ordered) return `${ordered[1]}${escapeTelegramMarkdownV2(ordered[2])}\\. ${convertInline(ordered[3])}`
  return convertInline(line)
}

function convertInline(input: string): string {
  let index = 0
  let output = ''
  while (index < input.length) {
    if (input.startsWith('***', index)) {
      const end = input.indexOf('***', index + 3)
      if (end !== -1) {
        output += `*_${escapeTelegramMarkdownV2(input.slice(index + 3, end))}_*`
        index = end + 3
        continue
      }
    }
    if (input.startsWith('**', index)) {
      const end = input.indexOf('**', index + 2)
      if (end !== -1) {
        output += `*${escapeTelegramMarkdownV2(input.slice(index + 2, end))}*`
        index = end + 2
        continue
      }
    }
    if (input.startsWith('__', index)) {
      const end = input.indexOf('__', index + 2)
      if (end !== -1) {
        output += `*${escapeTelegramMarkdownV2(input.slice(index + 2, end))}*`
        index = end + 2
        continue
      }
    }
    if (input.startsWith('~~', index)) {
      const end = input.indexOf('~~', index + 2)
      if (end !== -1) {
        output += `~${escapeTelegramMarkdownV2(input.slice(index + 2, end))}~`
        index = end + 2
        continue
      }
    }
    if (input[index] === '`') {
      const end = input.indexOf('`', index + 1)
      if (end !== -1) {
        output += `\`${escapeTelegramMarkdownV2Code(input.slice(index + 1, end))}\``
        index = end + 1
        continue
      }
    }
    if (input[index] === '[') {
      const close = input.indexOf(']', index + 1)
      if (close !== -1 && input[close + 1] === '(') {
        const urlEnd = input.indexOf(')', close + 2)
        if (urlEnd !== -1) {
          output += `[${escapeTelegramMarkdownV2(input.slice(index + 1, close))}](${escapeTelegramMarkdownV2Url(input.slice(close + 2, urlEnd))})`
          index = urlEnd + 1
          continue
        }
      }
    }
    if (input[index] === '*' && input[index + 1] !== '*') {
      const end = findSingleMarker(input, '*', index + 1)
      if (end !== -1) {
        output += `_${escapeTelegramMarkdownV2(input.slice(index + 1, end))}_`
        index = end + 1
        continue
      }
    }
    if (input[index] === '_' && input[index + 1] !== '_') {
      const end = findSingleMarker(input, '_', index + 1)
      if (end !== -1) {
        output += `_${escapeTelegramMarkdownV2(input.slice(index + 1, end))}_`
        index = end + 1
        continue
      }
    }
    output += escapeTelegramMarkdownV2(input[index] ?? '')
    index += 1
  }
  return output
}

export function formatTelegramInboxMarkdownV2(notification: InboxNotification): string {
  const workspace = notification.workspaceLabel ?? notification.workspaceId
  const provenance = formatInboxProvenance(notification)
  const parts = [
    `*${escapeTelegramMarkdownV2(notification.title)}*`,
    `Workspace: ${escapeTelegramMarkdownV2(workspace)}`,
  ]
  if (provenance) parts.push(`From: ${escapeTelegramMarkdownV2(provenance)}`)
  const body = notification.body.trim()
  if (body) {
    const clipped = body.length <= 1_600 ? body : `${body.slice(0, 1_599)}…`
    parts.push('', toTelegramMarkdownV2(clipped))
  }
  if (notification.href) parts.push('', escapeTelegramMarkdownV2(notification.href))
  return parts.join('\n')
}

function findSingleMarker(input: string, marker: '*' | '_', from: number): number {
  for (let index = from; index < input.length; index += 1) {
    if (input[index] !== marker) continue
    if (input[index + 1] === marker) {
      index += 1
      continue
    }
    return index
  }
  return -1
}
