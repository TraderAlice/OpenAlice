import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationQueue, type NotificationInput } from './queue'

let now: number
let queue: NotificationQueue
const show = vi.fn()
const hide = vi.fn()
const news = (overrides: Partial<NotificationInput> = {}): NotificationInput => ({ status: 'info', title: 'Reuters', description: 'First', duration: 6_000, group: 'news:reuters', windowMs: 4_000, ...overrides })

beforeEach(() => { now = 0; show.mockReset(); hide.mockReset(); queue = new NotificationQueue({ show, hide }, () => now) })

describe('notification display policy', () => {
  it('admits waiting cards by priority, then arrival order', () => {
    for (let i = 0; i < 3; i++) queue.publish({ id: `busy:${i}`, status: 'running', title: 'Busy', duration: Infinity })
    queue.publish(news({ group: 'news:one' }))
    queue.publish({ id: 'success:one', status: 'success', title: 'First result', duration: 4_000 })
    queue.publish({ id: 'success:two', status: 'success', title: 'Second result', duration: 4_000 })
    queue.dismiss('busy:0')
    expect(show.mock.lastCall?.[1].title).toBe('First result')
    queue.dismiss('busy:1')
    expect(show.mock.lastCall?.[1].title).toBe('Second result')
    queue.dismiss('busy:2')
    expect(show.mock.lastCall?.[1].title).toBe('Reuters')
  })
  it('uses a fixed burst window and replaces the entire latest article tuple', () => {
    const id = queue.publish(news({ revision: 1, articleId: 1, image: '/first.jpg' }))
    now = 3_000
    expect(queue.publish(news({ revision: 2, articleId: 2, description: 'Second' }))).toBe(id)
    expect(show.mock.lastCall?.[1]).toMatchObject({ count: 2, articleId: 2, description: 'Second' })
    expect(show.mock.lastCall?.[1].image).toBeUndefined()
    queue.publish(news({ revision: 2 }))
    expect(show).toHaveBeenCalledTimes(2)
    now = 4_000
    expect(queue.publish(news({ revision: 3 }))).not.toBe(id)
  })

  it('holds overflow without starting its timer, coalesces waiting items and admits on close', () => {
    for (let i = 0; i < 3; i++) queue.publish({ id: `running:${i}`, status: 'running', title: 'Working', duration: Infinity })
    const id = queue.publish(news({ revision: 1 }))
    now = 10_000
    expect(queue.publish(news({ revision: 2, description: 'Latest' }))).toBe(id)
    expect(show).toHaveBeenCalledTimes(3)
    queue.dismiss('running:0')
    expect(show.mock.lastCall?.[1]).toMatchObject({ count: 2, description: 'Latest', duration: 6_000 })
  })

  it('preempts a low-priority card for failure and ignores its delayed dismissal callback', () => {
    queue.publish({ id: 'running', status: 'running', title: 'Working', duration: Infinity })
    const oldCallback = show.mock.lastCall?.[2]
    queue.publish(news({ group: 'news:a' }))
    queue.publish(news({ group: 'news:b' }))
    queue.publish({ id: 'failure', status: 'error', title: 'Failed', duration: 10_000 })
    expect(hide).toHaveBeenCalledWith(expect.stringContaining('running'))
    oldCallback()
    queue.dismiss('failure')
    expect(show.mock.lastCall?.[1].status).toBe('running')
  })

  it('keeps dismissed progress hidden but admits a terminal result under the same operation', () => {
    queue.publish({ id: 'task:1', revision: 1, status: 'running', title: 'Working', duration: Infinity })
    queue.dismiss('task:1')
    queue.publish({ id: 'task:1', revision: 2, status: 'running', title: 'Progress', duration: Infinity })
    expect(show).toHaveBeenCalledTimes(1)
    queue.publish({ id: 'task:1', revision: 3, status: 'error', title: 'Failed', duration: 10_000 })
    expect(show).toHaveBeenCalledTimes(2)
  })

  it('silences the same closed error within 30 seconds but preserves different errors/scopes', () => {
    const error = { status: 'error' as const, title: 'Offline', group: 'state:A:offline', duration: 10_000, windowMs: 30_000 }
    const id = queue.publish(error)
    now = 3_000
    queue.publish(error)
    expect(show.mock.lastCall?.[1].count).toBe(2)
    queue.dismiss(id)
    now = 12_000
    queue.publish(error)
    expect(show).toHaveBeenCalledTimes(2)
    queue.publish({ ...error, group: 'state:B:offline' })
    expect(show).toHaveBeenCalledTimes(3)
    now = 30_000
    queue.publish(error)
    expect(show).toHaveBeenCalledTimes(4)
  })

  it('folds a second correlated delivery into its source group and removes its running card', () => {
    queue.publish({ id: 'task:1', status: 'running', title: 'Working', duration: Infinity })
    queue.publish({ id: 'task:1', group: 'inbox:session', status: 'success', title: 'Delivered', duration: 6_000 })
    queue.publish({ id: 'task:2', status: 'running', title: 'Working', duration: Infinity })
    expect(queue.publish({ id: 'task:2', group: 'inbox:session', status: 'success', title: 'Delivered again', duration: 6_000 })).toBe('task:1')
    expect(show.mock.lastCall?.[1]).toMatchObject({ title: 'Delivered again', count: 2 })
    expect(hide).toHaveBeenCalledWith(expect.stringContaining('task:2'))
  })
})

it('bounds waiting announcements while keeping error priority', () => {
  const transport = { show: vi.fn(), hide: vi.fn() }
  const queue = new NotificationQueue(transport, Date.now, 1, 3)
  queue.publish({id:'visible',status:'success',title:'visible',duration:4000})
  for(let i=0;i<20;i++) queue.publish({id:`pending:${i}`,status:'info',title:'news',duration:4000})
  queue.publish({id:'error',status:'error',title:'failed',duration:10000})
  expect(transport.show.mock.lastCall?.[1].status).toBe('error')
  // Drain by visible dismissal; bounded queue cannot retain all 20 pending facts.
  for(let i=0;i<10;i++) transport.show.mock.lastCall?.[2]()
  expect(transport.show.mock.calls.length).toBeLessThanOrEqual(5)
})
