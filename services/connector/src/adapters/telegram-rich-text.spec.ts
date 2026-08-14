import { TELEGRAM_PLAIN_TEXT_MAX } from '@traderalice/connector-protocol'
import { GrammyError } from 'grammy'
import { describe, expect, it, vi } from 'vitest'
import { toTelegramMarkdownV2 } from './telegram-markdown-v2.js'
import {
  isRecoverableRichMessageError,
  sendTelegramRichText,
  splitTelegramPlainText,
} from './telegram-rich-text.js'

function grammyError(description: string, errorCode = 400, method = 'sendMessage') {
  return new GrammyError(`Call to '${method}' failed!`, {
    ok: false,
    error_code: errorCode,
    description,
  }, method, {})
}

describe('Telegram rich-text send', () => {
  it('sends original GFM through sendRichMessage', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
    }

    await sendTelegramRichText(api, '42', '**hello**')

    expect(api.sendRichMessage).toHaveBeenCalledWith('42', { markdown: '**hello**' })
    expect(api.sendMessage).not.toHaveBeenCalled()
  })

  it('falls back to MarkdownV2 when sendRichMessage is unavailable', async () => {
    const api = {
      sendRichMessage: vi.fn(async () => {
        throw grammyError('Not Found', 404, 'sendRichMessage')
      }),
      sendMessage: vi.fn(async () => undefined),
    }

    await sendTelegramRichText(api, '42', '**hello**')

    expect(api.sendMessage).toHaveBeenCalledWith('42', '*hello*', { parse_mode: 'MarkdownV2' })
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
      sendRichMessage: vi.fn(async () => {
        throw grammyError('Unauthorized', 401)
      }),
      sendMessage: vi.fn(async () => undefined),
    }

    await expect(sendTelegramRichText(api, '42', 'hello')).rejects.toThrow('401')
    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(isRecoverableRichMessageError(new Error('offline'))).toBe(false)
  })

  it('sends a long owner message intact through sendRichMessage', async () => {
    const markdown = 'a'.repeat(5_000)
    const api = {
      sendRichMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
    }

    await sendTelegramRichText(api, '42', markdown)

    expect(api.sendRichMessage).toHaveBeenCalledWith('42', { markdown })
    expect(api.sendMessage).not.toHaveBeenCalled()
  })

  it('preserves a long plain fallback across multiple messages', async () => {
    const plain = `${'a'.repeat(4_000)}\n\n${'🙂'.repeat(600)}`
    const api = {
      sendRichMessage: vi.fn(async () => {
        throw grammyError('Not Found', 404, 'sendRichMessage')
      }),
      sendMessage: vi.fn(async (_chatId, _text, other?: { parse_mode?: 'MarkdownV2' }) => {
        if (other?.parse_mode === 'MarkdownV2') {
          throw grammyError('Bad Request: message is too long')
        }
      }),
    }

    await sendTelegramRichText(api, '42', plain)

    const plainCalls = api.sendMessage.mock.calls.filter((call) => call[2] === undefined)
    const chunks = plainCalls.map((call) => call[1])
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(plain)
    expect(chunks.every((chunk) => chunk.length <= TELEGRAM_PLAIN_TEXT_MAX)).toBe(true)
    expect(chunks.every((chunk) => !chunk.endsWith('\ud83d'))).toBe(true)
  })

  it('splits plain text at readable boundaries without losing content', () => {
    const text = `${'a'.repeat(TELEGRAM_PLAIN_TEXT_MAX - 20)}\n\n${'b'.repeat(40)}`
    const chunks = splitTelegramPlainText(text)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].endsWith('\n\n')).toBe(true)
    expect(chunks.join('')).toBe(text)
    expect(toTelegramMarkdownV2('a.b')).toBe('a\\.b')
  })
})
