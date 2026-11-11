import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SessionMailbox,
  type SessionMailboxMessage,
} from './session-mailbox.js'

let dir: string
let path: string

function input(overrides: Partial<SessionMailboxMessage> = {}) {
  return {
    recipientResumeId: 'resume-parent',
    recipientWorkspaceId: 'ws-a',
    taskId: 'run-abc123',
    childResumeId: 'resume-child',
    childWorkspaceId: 'ws-b',
    childAgent: 'codex',
    taskStatus: 'done' as const,
    assistantPreview: 'finished the refactor',
    ...overrides,
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mailbox-'))
  path = join(dir, 'session-mailbox.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('SessionMailbox', () => {
  it('starts empty for a missing file and persists enqueue across reload', async () => {
    const mailbox = await SessionMailbox.load(path)
    expect(mailbox.pendingFor('resume-parent')).toEqual([])

    const msg = await mailbox.enqueue(input({ createdAt: 1000 }))
    expect(msg).toMatchObject({ id: 'mail-run-abc123', status: 'unread', createdAt: 1000 })

    const reloaded = await SessionMailbox.load(path)
    expect(reloaded.pendingFor('resume-parent')).toHaveLength(1)
    expect(reloaded.pendingFor('resume-parent')[0]).toMatchObject({
      taskId: 'run-abc123',
      status: 'unread',
    })
  })

  it('recovers empty from a corrupt file', async () => {
    await writeFile(path, '{not json', 'utf8')
    const mailbox = await SessionMailbox.load(path)
    expect(mailbox.pendingFor('resume-parent')).toEqual([])
    const msg = await mailbox.enqueue(input())
    expect(msg.status).toBe('unread')
  })

  it('is idempotent by taskId + recipientResumeId', async () => {
    const mailbox = await SessionMailbox.load(path)
    const first = await mailbox.enqueue(input({ createdAt: 1 }))
    const second = await mailbox.enqueue(input({ taskId: 'run-abc123', createdAt: 2 }))
    expect(second).toBe(first)
    expect(mailbox.pendingFor('resume-parent')).toHaveLength(1)

    // Same taskId for a different recipient is a distinct message.
    await mailbox.enqueue(input({ recipientResumeId: 'resume-other', createdAt: 3 }))
    expect(mailbox.pendingFor('resume-parent')).toHaveLength(1)
    expect(mailbox.pendingFor('resume-other')).toHaveLength(1)
  })

  it('markNotified sets the watermark; checkAndAck clears it and acks everything together', async () => {
    const mailbox = await SessionMailbox.load(path)
    await mailbox.enqueue(input({ taskId: 'run-1', createdAt: 1 }))
    await mailbox.enqueue(input({ taskId: 'run-2', createdAt: 2 }))

    expect(mailbox.hasActiveWatermark('resume-parent')).toBe(false)

    const pending = await mailbox.markNotified('resume-parent', undefined, 500)
    expect(pending.map((m) => m.taskId).sort()).toEqual(['run-1', 'run-2'])
    expect(mailbox.hasActiveWatermark('resume-parent')).toBe(true)
    expect(mailbox.unreadFor('resume-parent')).toEqual([])

    // A third completion while watermarked stays unread (coalescing).
    await mailbox.enqueue(input({ taskId: 'run-3', createdAt: 3 }))
    expect(mailbox.hasActiveWatermark('resume-parent')).toBe(true)
    expect(mailbox.unreadFor('resume-parent').map((m) => m.taskId)).toEqual(['run-3'])
    expect(mailbox.recipientsWithUnread()).toEqual([])

    const acked = await mailbox.checkAndAck('resume-parent', 900)
    expect(acked.map((m) => m.taskId).sort()).toEqual(['run-1', 'run-2', 'run-3'])
    expect(acked.every((m) => m.status === 'acked' && m.ackedAt === 900)).toBe(true)

    expect(mailbox.hasActiveWatermark('resume-parent')).toBe(false)
    expect(mailbox.pendingFor('resume-parent')).toEqual([])

    // Persistence of the ack transition.
    const reloaded = await SessionMailbox.load(path)
    expect(reloaded.pendingFor('resume-parent')).toEqual([])
  })

  it('markNotified can target specific message ids', async () => {
    const mailbox = await SessionMailbox.load(path)
    const a = await mailbox.enqueue(input({ taskId: 'run-a' }))
    await mailbox.enqueue(input({ taskId: 'run-b' }))
    await mailbox.markNotified('resume-parent', [a.id], 10)
    expect(mailbox.hasActiveWatermark('resume-parent')).toBe(true)
    expect(mailbox.unreadFor('resume-parent').map((m) => m.taskId)).toEqual(['run-b'])
  })

  it('recipientsWithUnread lists only watermark-free recipients', async () => {
    const mailbox = await SessionMailbox.load(path)
    await mailbox.enqueue(input({ recipientResumeId: 'resume-1', taskId: 'run-1' }))
    await mailbox.enqueue(input({ recipientResumeId: 'resume-2', taskId: 'run-2' }))
    await mailbox.enqueue(input({ recipientResumeId: 'resume-2', taskId: 'run-3' }))
    expect(mailbox.recipientsWithUnread().sort()).toEqual(['resume-1', 'resume-2'])

    await mailbox.markNotified('resume-2')
    expect(mailbox.recipientsWithUnread()).toEqual(['resume-1'])

    await mailbox.checkAndAck('resume-1')
    expect(mailbox.recipientsWithUnread()).toEqual([])
  })

  it('prunes acked messages beyond 500 to keep the file bounded', async () => {
    const mailbox = await SessionMailbox.load(path)
    for (let i = 0; i < 490; i++) {
      await mailbox.enqueue(input({ taskId: `run-old-${i}`, createdAt: i }))
    }
    await mailbox.checkAndAck('resume-parent')
    for (let i = 0; i < 20; i++) {
      await mailbox.enqueue(input({ taskId: `run-new-${i}`, createdAt: 1000 + i }))
    }

    const onDisk = JSON.parse(await readFile(path, 'utf8')) as {
      messages: SessionMailboxMessage[]
    }
    expect(onDisk.messages).toHaveLength(500)
    expect(onDisk.messages.filter((m) => m.status === 'acked')).toHaveLength(480)
    expect(mailbox.pendingFor('resume-parent')).toHaveLength(20)
    expect(mailbox.pendingFor('resume-parent')[0].taskId).toBe('run-new-0')
  })

  it('writes atomically (no leftover tmp file)', async () => {
    const mailbox = await SessionMailbox.load(path)
    await mailbox.enqueue(input())
    const files = await readdir(dir)
    expect(files).toEqual(['session-mailbox.json'])
  })
})
