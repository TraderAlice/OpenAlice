import { TELEGRAM_PLAIN_TEXT_MAX } from '@traderalice/connector-protocol'
import { GrammyError } from 'grammy'
import { toTelegramMarkdownV2 } from './telegram-markdown-v2.js'

export interface TelegramRichTextApi {
  sendRichMessage(chatId: string | number, richMessage: { markdown: string }): Promise<unknown>
  sendMessage(
    chatId: string | number,
    text: string,
    other?: { parse_mode?: 'MarkdownV2' },
  ): Promise<unknown>
}

/** Send formatted Telegram text without silently discarding message content.
 * Bot API 10.1 rich messages accept the complete owner-chat payload. Older or
 * incompatible endpoints fall back to MarkdownV2, then lossless plain chunks. */
export async function sendTelegramRichText(
  api: TelegramRichTextApi,
  chatId: string,
  markdown: string,
  plainFallback = markdown,
  markdownV2 = toTelegramMarkdownV2(markdown),
): Promise<void> {
  try {
    await api.sendRichMessage(chatId, { markdown })
    return
  } catch (error) {
    if (!isRecoverableRichMessageError(error)) throw error
    console.warn(
      '[connector] Telegram rich message fell back:',
      error instanceof Error ? error.message : error,
    )
  }
  try {
    await api.sendMessage(chatId, markdownV2, { parse_mode: 'MarkdownV2' })
    return
  } catch (error) {
    if (!isRecoverableRichMessageError(error)) throw error
    console.warn(
      '[connector] Telegram MarkdownV2 fell back to plain text:',
      error instanceof Error ? error.message : error,
    )
  }

  for (const chunk of splitTelegramPlainText(plainFallback)) {
    await api.sendMessage(chatId, chunk)
  }
}

/** Split plain Telegram text at readable boundaries while preserving every
 * code unit and never cutting through a Unicode grapheme cluster. */
export function splitTelegramPlainText(text: string): string[] {
  if (text.length <= TELEGRAM_PLAIN_TEXT_MAX) return [text]

  const chunks: string[] = []
  let remaining = text
  while (remaining.length > TELEGRAM_PLAIN_TEXT_MAX) {
    const safeEnd = telegramChunkEnd(remaining)
    const candidate = remaining.slice(0, safeEnd)
    const preferredEnd = preferredTelegramBreak(candidate)
    const chunkEnd = preferredEnd > 0 ? preferredEnd : safeEnd
    chunks.push(remaining.slice(0, chunkEnd))
    remaining = remaining.slice(chunkEnd)
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

export function isRecoverableRichMessageError(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false
  if (error.error_code === 404) return true
  if (error.error_code !== 400) return false
  const description = error.description.toLowerCase()
  return description.includes('parse')
    || description.includes('markdown')
    || description.includes('rich message')
    || description.includes('too long')
    || description.includes('method not found')
    || description.includes('unknown method')
}

function telegramChunkEnd(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let end = 0
  for (const { segment } of segmenter.segment(text)) {
    if (end + segment.length > TELEGRAM_PLAIN_TEXT_MAX) break
    end += segment.length
  }

  // An artificially huge grapheme cannot satisfy both constraints. Keep the
  // loop progressing at a Unicode code-point boundary in that pathological case.
  if (end === 0) return [...text][0]?.length ?? text.length
  return end
}

function preferredTelegramBreak(candidate: string): number {
  const minimumReadableChunk = Math.floor(candidate.length / 2)
  const breaks = [
    candidate.lastIndexOf('\n\n') + 2,
    candidate.lastIndexOf('\n') + 1,
    candidate.lastIndexOf(' ') + 1,
    candidate.lastIndexOf('\t') + 1,
  ]
  return breaks.find((index) => index >= minimumReadableChunk) ?? 0
}
