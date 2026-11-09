import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { SessionMailbox } from './session-mailbox.js'
import {
  SessionWakeDelivery,
  formatSessionWakePointer,
  type SessionWakeDeliveryDeps,
} from './session-wake-delivery.js'

let dir: string
let mailbox: SessionMailbox
let delivery: SessionWakeDelivery
let deps: { pty: Mock; web: Mock; headless: Mock; warn: Mock }

const RESUME = 'resume-parent'

function taskInput(overrides: Record<string, unknown> = {}) {
  return {
    recipientResumeId: RESUME,
    recipientWorkspaceId: 'ws-a',
    taskId: 'run-task-1',
    childResumeId: 'resume-child',
    childWorkspaceId: 'ws-b',
    childAgent: 'claude',
    taskStatus: 'done' as const,
    assistantPreview: 'all done',
    ...overrides,
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wake-'))
  mailbox = await SessionMailbox.load(join(dir, 'session-mailbox.json'))
  deps = {
    pty: vi.fn(async () => 'absent' as const),
    web: vi.fn(async () => 'absent' as const),
    headless: vi.fn(async () => 'delivered' as const),
    warn: vi.fn(),
  }
  delivery = new SessionWakeDelivery({
    mailbox,
    deliverToPty: deps.pty,
    deliverToWeb: deps.web,
    deliverToHeadless: deps.headless,
    warn: deps.warn,
  } satisfies SessionWakeDeliveryDeps)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('formatSessionWakePointer', () => {
  it('renders singular and plural single-line ASCII pointers', () => {
    expect(formatSessionWakePointer(1, RESUME)).toBe(
      'You have 1 completed peer task. Run `alice conversation check` to read the result and continue.',
    )
    expect(formatSessionWakePointer(3, RESUME)).toBe(
      'You have 3 completed peer tasks. Run `alice conversation check` to read the results and continue.',
    )
    expect(formatSessionWakePointer(3, RESUME)).not.toContain('\n')
  })
})

describe('SessionWakeDelivery', () => {
  it('delivers to Web first and marks messages notified', async () => {
    deps.web.mockResolvedValue('delivered')
    await delivery.notifyTaskCompleted(taskInput())

    expect(deps.web).toHaveBeenCalledWith(
      RESUME,
      formatSessionWakePointer(1, RESUME),
    )
    expect(deps.pty).not.toHaveBeenCalled()
    expect(deps.headless).not.toHaveBeenCalled()
    expect(mailbox.pendingFor(RESUME).map((m) => m.status)).toEqual(['notified'])
    expect(mailbox.hasActiveWatermark(RESUME)).toBe(true)
  })

  it('falls back to PTY when Web is absent', async () => {
    deps.pty.mockResolvedValue('delivered')
    await delivery.notifyTaskCompleted(taskInput())

    expect(deps.web).toHaveBeenCalledTimes(1)
    expect(deps.pty).toHaveBeenCalledWith(
      RESUME,
      formatSessionWakePointer(1, RESUME),
    )
    expect(deps.headless).not.toHaveBeenCalled()
    expect(mailbox.pendingFor(RESUME)[0].status).toBe('notified')
  })

  it('falls back to headless when Web and PTY are both absent', async () => {
    await delivery.notifyTaskCompleted(taskInput())

    expect(deps.headless).toHaveBeenCalledWith(
      RESUME,
      formatSessionWakePointer(1, RESUME),
    )
    expect(mailbox.pendingFor(RESUME)[0].status).toBe('notified')
  })

  it('returns unavailable when headless cannot resume and nowhere else delivered', async () => {
    deps.headless.mockResolvedValue('unavailable')
    await mailbox.enqueue(taskInput())
    expect(await delivery.tryDeliver(RESUME)).toBe('unavailable')
    expect(mailbox.pendingFor(RESUME)[0].status).toBe('unread')
  })

  it('parks when every surface is busy, then redelivers on settle', async () => {
    deps.web.mockResolvedValue('busy')
    deps.pty.mockResolvedValue('busy')
    deps.headless.mockResolvedValue('busy')

    const result = await delivery.tryDeliver(RESUME)
    expect(result).toBe('noop') // nothing enqueued yet

    await mailbox.enqueue(taskInput())
    const parked = await delivery.tryDeliver(RESUME)
    expect(parked).toBe('parked')
    expect(mailbox.pendingFor(RESUME)[0].status).toBe('unread')

    // Surface settles → redelivery succeeds.
    deps.web.mockResolvedValue('delivered')
    await delivery.onSessionSettled(RESUME)
    expect(mailbox.pendingFor(RESUME)[0].status).toBe('notified')
  })

  it('parks on notifyTaskCompleted when surfaces are busy and redelivers on settle', async () => {
    deps.web.mockResolvedValue('busy')
    deps.pty.mockResolvedValue('absent')
    await delivery.notifyTaskCompleted(taskInput())
    expect(mailbox.unreadFor(RESUME)).toHaveLength(1)

    deps.web.mockResolvedValue('delivered')
    await delivery.onSessionSettled(RESUME)
    expect(deps.web).toHaveBeenCalledTimes(2)
    expect(mailbox.hasActiveWatermark(RESUME)).toBe(true)
  })

  it('onSessionSettled is a no-op when nothing is parked or unread', async () => {
    deps.web.mockResolvedValue('delivered')
    await delivery.onSessionSettled(RESUME)
    expect(deps.web).not.toHaveBeenCalled()
  })

  it('watermark prevents duplicate TUI spam when multiple tasks finish', async () => {
    deps.web.mockResolvedValue('delivered')
    await delivery.notifyTaskCompleted(taskInput({ taskId: 'run-task-1' }))

    const second = await delivery.notifyTaskCompleted(
      taskInput({ taskId: 'run-task-2' }),
    ).then(() => delivery.tryDeliver(RESUME))
    expect(second).toBe('watermarked')

    // Web was prompted exactly once; the second task stays unread.
    expect(deps.web).toHaveBeenCalledTimes(1)
    expect(mailbox.unreadFor(RESUME).map((m) => m.taskId)).toEqual(['run-task-2'])

    // One check acks both together and clears the watermark.
    const acked = await mailbox.checkAndAck(RESUME)
    expect(acked.map((m) => m.taskId).sort()).toEqual(['run-task-1', 'run-task-2'])
    expect(mailbox.hasActiveWatermark(RESUME)).toBe(false)

    // After the check, a new completion prompts again.
    await delivery.notifyTaskCompleted(taskInput({ taskId: 'run-task-3' }))
    expect(deps.web).toHaveBeenCalledTimes(2)
  })

  it('parks without retrying when delivery is already in flight', async () => {
    // Executor form: tests tsconfig lib (ES2023) lacks Promise.withResolvers.
    let releaseWeb!: (v: 'delivered') => void
    const gate = new Promise<'delivered'>((resolve) => {
      releaseWeb = resolve
    })
    deps.web.mockImplementation(() => gate)

    await mailbox.enqueue(taskInput())
    const first = delivery.tryDeliver(RESUME)

    // A concurrent tryDeliver while the first is in flight parks.
    const second = await delivery.tryDeliver(RESUME)
    expect(second).toBe('parked')

    releaseWeb('delivered')
    expect(await first).toBe('delivered')
  })

  it('parks when headless is not provided and Web/PTY are absent', async () => {
    const bare = new SessionWakeDelivery({
      mailbox,
      deliverToPty: async () => 'absent',
      deliverToWeb: async () => 'absent',
    })
    await mailbox.enqueue(taskInput())
    expect(await bare.tryDeliver(RESUME)).toBe('parked')
  })
})
