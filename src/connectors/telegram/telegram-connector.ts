/**
 * Telegram outbound connector.
 *
 * Delivers messages and media to a specific Telegram chat via the grammY
 * Bot API. Handles photo attachments (read from disk, sent via sendPhoto)
 * and automatic text chunking for messages exceeding Telegram's 4096-char limit.
 *
 * Does not support streaming (no sendStream) — ConnectorCenter falls back
 * to draining the stream and calling send() with the completed result.
 */

import { readFile } from 'node:fs/promises'
import { Bot, InputFile } from 'grammy'
import type { Connector, ConnectorCapabilities, SendPayload, SendResult } from '../types.js'

export const MAX_MESSAGE_LENGTH = 4096

export class TelegramConnector implements Connector {
  readonly channel: string
  readonly to: string
  readonly capabilities: ConnectorCapabilities = { push: true, media: true }

  constructor(
    private readonly bot: Bot,
    private readonly chatId: number,
    channel = 'telegram',
  ) {
    this.channel = channel
    this.to = String(chatId)
  }

  async send(payload: SendPayload): Promise<SendResult> {
    // Send media first (photos)
    if (payload.media && payload.media.length > 0) {
      for (const attachment of payload.media) {
        try {
          const buf = await readFile(attachment.path)
          await this.bot.api.sendPhoto(this.chatId, new InputFile(buf, 'screenshot.jpg'))
        } catch (err) {
          console.error('telegram: failed to send photo:', err)
        }
      }
    }

    // Send text with chunking
    if (payload.text) {
      const chunks = splitMessage(payload.text, MAX_MESSAGE_LENGTH)
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(this.chatId, chunk)
      }
    }

    return { delivered: true }
  }
}

// ==================== Helpers ====================

export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // Try to split at a newline
    let splitAt = remaining.lastIndexOf('\n', maxLength)
    if (splitAt === -1 || splitAt < maxLength / 2) {
      // Fall back to splitting at a space
      splitAt = remaining.lastIndexOf(' ', maxLength)
    }
    if (splitAt === -1 || splitAt < maxLength / 2) {
      // Hard split
      splitAt = maxLength
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}
