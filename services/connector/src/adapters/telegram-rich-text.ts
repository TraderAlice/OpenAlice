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

/** Send formatted Telegram text. MarkdownV2 is the `sendMessage` parse_mode.
 * Raw agent markdown is converted first. If Telegram rejects that payload,
 * try Bot API 10.1 `sendRichMessage` with the original GFM, then plain text. */
export async function sendTelegramRichText(
  api: TelegramRichTextApi,
  chatId: string,
  markdown: string,
  plainFallback = markdown,
  markdownV2 = toTelegramMarkdownV2(markdown),
): Promise<void> {
  try {
    await api.sendMessage(chatId, clipTelegramPlainText(markdownV2), { parse_mode: 'MarkdownV2' })
    return
  } catch (error) {
    if (!isRecoverableRichMessageError(error)) throw error
    console.warn(
      '[connector] Telegram MarkdownV2 fell back:',
      error instanceof Error ? error.message : error,
    )
  }
  try {
    await api.sendRichMessage(chatId, { markdown })
  } catch (error) {
    if (!isRecoverableRichMessageError(error)) throw error
    console.warn(
      '[connector] Telegram rich message fell back to plain text:',
      error instanceof Error ? error.message : error,
    )
    await api.sendMessage(chatId, clipTelegramPlainText(plainFallback))
  }
}

export function clipTelegramPlainText(text: string): string {
  if (text.length <= TELEGRAM_PLAIN_TEXT_MAX) return text
  return `${text.slice(0, TELEGRAM_PLAIN_TEXT_MAX - 1)}…`
}

export function isRecoverableRichMessageError(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false
  if (error.error_code === 404) return true
  if (error.error_code !== 400) return false
  const description = error.description.toLowerCase()
  return description.includes('parse')
    || description.includes('markdown')
    || description.includes('rich message')
    || description.includes('method not found')
    || description.includes('unknown method')
}
