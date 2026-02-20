import type { Message, User, Chat } from 'grammy/types'

let nextMessageId = 1

export function resetCounters() {
  nextMessageId = 1
}

export function user(overrides?: Partial<User>): User {
  return { id: 12345, is_bot: false, first_name: 'Alice', ...overrides }
}

export function chat(overrides?: Partial<Chat>): Chat {
  return { id: 67890, type: 'private', first_name: 'Alice', ...overrides } as Chat
}

export function baseMessage(overrides?: Partial<Message>): Message {
  return {
    message_id: nextMessageId++,
    date: 1700000000,
    chat: chat(),
    from: user(),
    ...overrides,
  } as Message
}

// ── Message factories ──

export function textMessage(text: string, overrides?: Partial<Message>): Message {
  return baseMessage({ text, ...overrides })
}

export function photoMessage(caption?: string, overrides?: Partial<Message>): Message {
  return baseMessage({
    photo: [
      { file_id: 'small_id', file_unique_id: 'small_u', width: 90, height: 90 },
      { file_id: 'medium_id', file_unique_id: 'med_u', width: 320, height: 320 },
      { file_id: 'large_id', file_unique_id: 'large_u', width: 800, height: 600 },
    ],
    ...(caption ? { caption } : {}),
    ...overrides,
  })
}

export function documentMessage(fileName: string, caption?: string): Message {
  return baseMessage({
    document: {
      file_id: 'doc_id',
      file_unique_id: 'doc_u',
      file_name: fileName,
      mime_type: 'application/pdf',
    },
    ...(caption ? { caption } : {}),
  })
}

export function animationMessage(caption?: string): Message {
  return baseMessage({
    animation: {
      file_id: 'anim_id',
      file_unique_id: 'anim_u',
      width: 320,
      height: 240,
      duration: 3,
    },
    // Telegram also sends a document field for animations; include for realism
    document: {
      file_id: 'anim_id',
      file_unique_id: 'anim_u',
      file_name: 'animation.mp4',
      mime_type: 'video/mp4',
    },
    ...(caption ? { caption } : {}),
  })
}

export function voiceMessage(duration = 5): Message {
  return baseMessage({
    voice: {
      file_id: 'voice_id',
      file_unique_id: 'voice_u',
      duration,
    },
  })
}

export function stickerMessage(emoji = '\u{1F600}'): Message {
  return baseMessage({
    sticker: {
      file_id: 'sticker_id',
      file_unique_id: 'sticker_u',
      type: 'regular',
      width: 512,
      height: 512,
      is_animated: false,
      is_video: false,
      emoji,
    },
  })
}

export function mediaGroupPhotoMessage(groupId: string, caption?: string): Message {
  return baseMessage({
    media_group_id: groupId,
    photo: [
      { file_id: `photo_${nextMessageId}_sm`, file_unique_id: `pu_${nextMessageId}_sm`, width: 90, height: 90 },
      { file_id: `photo_${nextMessageId}_lg`, file_unique_id: `pu_${nextMessageId}_lg`, width: 800, height: 600 },
    ],
    ...(caption ? { caption } : {}),
  })
}

export function channelPostMessage(text: string): Message {
  return baseMessage({
    text,
    chat: chat({ id: -1001234567890, type: 'channel', title: 'Test Channel' }),
  })
}

export function groupMessage(text: string, chatId = -100999, threadId?: number): Message {
  return baseMessage({
    text,
    chat: chat({ id: chatId, type: 'supergroup', title: 'Test Group' }),
    ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
  })
}
