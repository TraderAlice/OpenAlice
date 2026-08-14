import { TELEGRAM_PLAIN_TEXT_MAX } from '@traderalice/connector-protocol'
import { GrammyError } from 'grammy'
import { describe, expect, it, vi } from 'vitest'
import { toTelegramMarkdownV2 } from './telegram-markdown-v2.js'
import {
  clipTelegramPlainText,
  isRecoverableRichMessageError,
  sendTelegramRichText,
} from './telegram-rich-text.js'

function grammyError(description: string, errorCode = 400, method = 'sendMessage') {
  return new GrammyError(`Call to '${method}' failed!`, {
    ok: false,
    error_code: errorCode,
    description,
  }, method, {})
}

describe('Telegram rich-text send', () => {
  it('sends converted MarkdownV2 through sendMessage', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
    }

    await sendTelegramRichText(api, '42', '**hello**')

    expect(api.sendMessage).toHaveBeenCalledWith('42', '*hello*', { parse_mode: 'MarkdownV2' })
    expect(api.sendRichMessage).not.toHaveBeenCalled()
  })

  it('falls back to sendRichMessage when MarkdownV2 is rejected', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => {
        throw grammyError("Bad Request: can't parse entities")
      }),
    }

    await sendTelegramRichText(api, '42', '**hello**')

    expect(api.sendRichMessage).toHaveBeenCalledWith('42', { markdown: '**hello**' })
  })

  it('falls back to plain text when both formatted sends fail', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => {
        throw grammyError("Bad Request: can't parse rich message markdown", 400, 'sendRichMessage')
      }),
      sendMessage: vi.fn(async (_chatId, _text, other?: { parse_mode?: 'MarkdownV2' }) => {
        if (other?.parse_mode === 'MarkdownV2') {
          throw grammyError("Bad Request: can't parse entities")
        }
      }),
    }

    await sendTelegramRichText(api, '42', '# broken <', 'plain fallback')

    expect(api.sendMessage).toHaveBeenLastCalledWith('42', 'plain fallback')
  })

  it('does not swallow a transport or authorization failure', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => {
        throw grammyError('Unauthorized', 401)
      }),
    }

    await expect(sendTelegramRichText(api, '42', 'hello')).rejects.toThrow('401')
    expect(api.sendRichMessage).not.toHaveBeenCalled()
    expect(isRecoverableRichMessageError(new Error('offline'))).toBe(false)
  })

  it('clips a long fallback to the sendMessage cap', () => {
    const text = `${'a'.repeat(TELEGRAM_PLAIN_TEXT_MAX)}!`
    const clipped = clipTelegramPlainText(text)
    expect(clipped).toHaveLength(TELEGRAM_PLAIN_TEXT_MAX)
    expect(clipped.endsWith('…')).toBe(true)
    expect(toTelegramMarkdownV2('a.b')).toBe('a\\.b')
  })
})
