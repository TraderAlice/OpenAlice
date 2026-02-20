import { describe, it, expect, beforeEach } from 'vitest'
import { extractMedia, buildParsedMessage } from '../helpers.js'
import {
  resetCounters,
  textMessage,
  photoMessage,
  documentMessage,
  animationMessage,
  voiceMessage,
  stickerMessage,
  mediaGroupPhotoMessage,
  channelPostMessage,
  groupMessage,
} from './fixtures.js'

beforeEach(() => {
  resetCounters()
})

// ── extractMedia ──────────────────────────────────────────────

describe('extractMedia', () => {
  it('picks the largest photo', () => {
    const msg = photoMessage()
    const media = extractMedia(msg)
    expect(media).toHaveLength(1)
    expect(media[0]).toEqual({
      type: 'photo',
      fileId: 'large_id',
      width: 800,
      height: 600,
    })
  })

  it('extracts document', () => {
    const msg = documentMessage('report.pdf')
    const media = extractMedia(msg)
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({
      type: 'document',
      fileId: 'doc_id',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
    })
  })

  it('extracts animation (not document) from GIF messages', () => {
    const msg = animationMessage()
    const media = extractMedia(msg)
    // Should have animation only, not the duplicate document
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({
      type: 'animation',
      fileId: 'anim_id',
    })
  })

  it('extracts voice', () => {
    const msg = voiceMessage(10)
    const media = extractMedia(msg)
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({
      type: 'voice',
      fileId: 'voice_id',
    })
  })

  it('extracts sticker', () => {
    const msg = stickerMessage('\u{1F389}')
    const media = extractMedia(msg)
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({
      type: 'sticker',
      fileId: 'sticker_id',
      width: 512,
      height: 512,
    })
  })

  it('returns empty array for plain text', () => {
    const msg = textMessage('hello')
    const media = extractMedia(msg)
    expect(media).toEqual([])
  })
})

// ── buildParsedMessage ───────────────────────────────────────

describe('buildParsedMessage', () => {
  it('builds from a text message', () => {
    const parsed = buildParsedMessage(textMessage('hello'))
    expect(parsed.chatId).toBe(67890)
    expect(parsed.text).toBe('hello')
    expect(parsed.from.id).toBe(12345)
    expect(parsed.from.firstName).toBe('Alice')
    expect(parsed.command).toBeUndefined()
    expect(parsed.media).toEqual([])
  })

  it('includes command and args when provided', () => {
    const parsed = buildParsedMessage(textMessage('/status detailed'), 'status', 'detailed')
    expect(parsed.command).toBe('status')
    expect(parsed.commandArgs).toBe('detailed')
    expect(parsed.text).toBe('/status detailed')
  })

  it('builds from a photo with caption', () => {
    const parsed = buildParsedMessage(photoMessage('nice pic'))
    expect(parsed.text).toBe('nice pic')
    expect(parsed.media).toHaveLength(1)
    expect(parsed.media[0].type).toBe('photo')
  })

  it('builds from a photo without caption', () => {
    const parsed = buildParsedMessage(photoMessage())
    expect(parsed.text).toBe('')
    expect(parsed.media).toHaveLength(1)
  })

  it('builds from a document', () => {
    const parsed = buildParsedMessage(documentMessage('data.csv', 'here is the data'))
    expect(parsed.text).toBe('here is the data')
    expect(parsed.media).toHaveLength(1)
    expect(parsed.media[0].type).toBe('document')
    expect(parsed.media[0].fileName).toBe('data.csv')
  })

  it('builds from an animation', () => {
    const parsed = buildParsedMessage(animationMessage('funny'))
    expect(parsed.text).toBe('funny')
    expect(parsed.media).toHaveLength(1)
    expect(parsed.media[0].type).toBe('animation')
  })

  it('builds from a voice message', () => {
    const parsed = buildParsedMessage(voiceMessage())
    expect(parsed.text).toBe('')
    expect(parsed.media).toHaveLength(1)
    expect(parsed.media[0].type).toBe('voice')
  })

  it('builds from a sticker', () => {
    const parsed = buildParsedMessage(stickerMessage('\u{1F600}'))
    expect(parsed.text).toBe('')
    expect(parsed.media).toHaveLength(1)
    expect(parsed.media[0].type).toBe('sticker')
  })

  it('builds from a channel post', () => {
    const parsed = buildParsedMessage(channelPostMessage('announcement'))
    expect(parsed.text).toBe('announcement')
    expect(parsed.chatId).toBe(-1001234567890)
  })

  it('builds from a group message', () => {
    const parsed = buildParsedMessage(groupMessage('group chat', -100999))
    expect(parsed.chatId).toBe(-100999)
    expect(parsed.text).toBe('group chat')
  })

  it('preserves mediaGroupId', () => {
    const parsed = buildParsedMessage(mediaGroupPhotoMessage('album_1', 'first'))
    expect(parsed.mediaGroupId).toBe('album_1')
  })

  it('date is a proper Date object', () => {
    const parsed = buildParsedMessage(textMessage('hi'))
    expect(parsed.date).toBeInstanceOf(Date)
    expect(parsed.date.getTime()).toBe(1700000000 * 1000)
  })

  it('increments message IDs across calls', () => {
    const p1 = buildParsedMessage(textMessage('a'))
    const p2 = buildParsedMessage(textMessage('b'))
    expect(p2.messageId).toBe(p1.messageId + 1)
  })
})
