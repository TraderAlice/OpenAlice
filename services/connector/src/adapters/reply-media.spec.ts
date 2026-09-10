import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { DiscordConnectorAdapter } from './discord.js'
import { SlackConnectorAdapter } from './slack.js'
import { FeishuConnectorAdapter } from './feishu.js'

const bytes = Buffer.from('media-fixture')
const attachment = {
  filename: 'wave.png', mediaType: 'image/png', sizeBytes: bytes.length,
  contentBase64: bytes.toString('base64'),
  contentSha256: createHash('sha256').update(bytes).digest('hex'),
}

function setup(platform: 'discord' | 'slack' | 'feishu') {
  const send = vi.fn(async () => ({ code: 0 }))
  const upload = vi.fn(async () => ({ image_key: 'img_1', file_key: 'file_1' }))
  const adapter = platform === 'discord' ? new DiscordConnectorAdapter()
    : platform === 'slack' ? new SlackConnectorAdapter() : new FeishuConnectorAdapter()
  Object.assign(adapter, {
    ownerUserId: 'owner', chatId: 'dm', sessionReady: true,
    ...(platform === 'discord' ? { client: {
      isReady: () => true, users: { fetch: vi.fn(async () => ({ send })) },
    } } : platform === 'slack' ? { web: {
      conversations: { open: vi.fn(async () => ({ channel: { id: 'dm' } })) },
      filesUploadV2: upload,
    } } : { client: { im: {
      image: { create: upload }, file: { create: upload }, message: { create: send },
    } } }),
  })
  return { adapter, send, upload }
}

describe.each(['discord', 'slack', 'feishu'] as const)('%s reply media', platform => {
  it.each(['file', 'image', 'sticker'] as const)('delivers %s to the linked owner without changing bytes', async presentation => {
    const { adapter, send, upload } = setup(platform)
    await adapter.sendOwnerFile(attachment, presentation)
    if (platform === 'discord') {
      expect(send).toHaveBeenCalledWith({ files: [{ attachment: bytes, name: 'wave.png' }] })
    } else if (platform === 'slack') {
      expect(upload).toHaveBeenCalledWith({ channel_id: 'dm', file: bytes, filename: 'wave.png' })
    } else {
      expect(upload).toHaveBeenCalledWith({ data: presentation === 'file'
        ? { file_type: 'stream', file_name: 'wave.png', file: bytes }
        : { image_type: 'message', image: bytes } })
      expect(send).toHaveBeenCalledWith({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: 'dm', msg_type: presentation === 'file' ? 'file' : 'image',
          content: JSON.stringify(presentation === 'file' ? { file_key: 'file_1' } : { image_key: 'img_1' }) },
      })
    }
    expect(adapter.health().status).toBe('healthy')
  })

  it('delivers directed artifacts as files without an Inbox summary', async () => {
    const { adapter, send, upload } = setup(platform)
    await adapter.deliverArtifact({
      requestId: 'request', connectorId: platform, entryId: 'entry', docIndex: 0, attachment,
    })
    if (platform === 'discord') expect(send.mock.calls[0]).toEqual([{ files: [{ attachment: bytes, name: 'wave.png' }] }])
    else if (platform === 'slack') expect(upload).toHaveBeenCalledTimes(1)
    else expect(send).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ msg_type: 'file' }),
    }))
  })

  it('rejects an unlinked owner before uploading', async () => {
    const { adapter, send, upload } = setup(platform)
    Object.assign(adapter, { ownerUserId: undefined })
    await expect(adapter.sendOwnerFile(attachment, 'sticker')).rejects.toThrow('not linked')
    expect(send).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('reports upload failure and degraded health', async () => {
    const { adapter, send, upload } = setup(platform)
    const endpoint = platform === 'discord' ? send : upload
    endpoint.mockRejectedValueOnce(new Error('upload denied'))
    await expect(adapter.sendOwnerFile(attachment, 'sticker')).rejects.toThrow('upload denied')
    expect(adapter.health().status).toBe('degraded')
  })

  it('rejects corrupt media before uploading', async () => {
    const { adapter, send, upload } = setup(platform)
    await expect(adapter.sendOwnerFile({ ...attachment, contentSha256: '0'.repeat(64) })).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })
})

it('does not send a Feishu message when upload returns no image key', async () => {
  const { adapter, send, upload } = setup('feishu')
  upload.mockResolvedValueOnce({} as Awaited<ReturnType<typeof upload>>)
  await expect(adapter.sendOwnerFile(attachment, 'image')).rejects.toThrow('image_key')
  expect(send).not.toHaveBeenCalled()
})
