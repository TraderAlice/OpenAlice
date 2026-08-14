import { TELEGRAM_PLAIN_TEXT_MAX } from '@traderalice/connector-protocol'
import { GrammyError } from 'grammy'
import { describe, expect, it, vi } from 'vitest'
import {
  clipTelegramPlainText,
  isRecoverableRichMessageError,
  sendTelegramRichText,
} from './telegram-rich-text.js'

function grammyError(description: string, errorCode = 400, method = 'sendRichMessage') {
  return new GrammyError(`Call to '${method}' failed!`, {
    ok: false,
    error_code: errorCode,
    description,
  }, method, {})
}

describe('Telegram rich-text send', () => {
  it('sends markdown through sendRichMessage', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
    }

    await sendTelegramRichText(api, '42', '**hello**')

    expect(api.sendRichMessage).toHaveBeenCalledWith('42', { markdown: '**hello**' })
    expect(api.sendMessage).not.toHaveBeenCalled()
  })

  it('falls back to plain text when Telegram cannot parse the rich markdown', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => {
        throw grammyError("Bad Request: can't parse rich message markdown")
      }),
      sendMessage: vi.fn(async () => undefined),
    }

    await sendTelegramRichText(api, '42', '# broken <', 'plain fallback')

    expect(api.sendMessage).toHaveBeenCalledWith('42', 'plain fallback')
  })

  it('falls back when sendRichMessage is not available', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => {
        throw grammyError('Not Found: method not found', 404)
      }),
      sendMessage: vi.fn(async () => undefined),
    }

    await sendTelegramRichText(api, '42', '*still readable*')

    expect(api.sendMessage).toHaveBeenCalledWith('42', '*still readable*')
  })

  it('does not swallow a transport or authorization failure', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => {
        throw grammyError('Unauthorized', 401)
      }),
      sendMessage: vi.fn(async () => undefined),
    }

    await expect(sendTelegramRichText(api, '42', 'hello')).rejects.toThrow('401')
    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(isRecoverableRichMessageError(new Error('offline'))).toBe(false)
  })

  it('clips a long fallback to the sendMessage cap', () => {
    const text = `${'a'.repeat(TELEGRAM_PLAIN_TEXT_MAX)}!`
    const clipped = clipTelegramPlainText(text)
    expect(clipped).toHaveLength(TELEGRAM_PLAIN_TEXT_MAX)
    expect(clipped.endsWith('…')).toBe(true)
  })
})
