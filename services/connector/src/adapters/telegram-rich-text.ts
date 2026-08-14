import { TELEGRAM_PLAIN_TEXT_MAX } from '@traderalice/connector-protocol'
import { GrammyError } from 'grammy'

export interface TelegramRichTextApi {
  sendRichMessage(chatId: string | number, richMessage: { markdown: string }): Promise<unknown>
  sendMessage(chatId: string | number, text: string): Promise<unknown>
}

/** Send GFM-compatible markdown through Bot API 10.1. A parse/format 400
 * (or a missing-method response) falls back to plain `sendMessage` so the
 * owner still receives the text. */
export async function sendTelegramRichText(
  api: TelegramRichTextApi,
  chatId: string,
  markdown: string,
  plainFallback = markdown,
): Promise<void> {
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
