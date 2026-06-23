import { describe, it, expect } from 'vitest'
import { groupNotifications, normalizeNotificationText } from '../groupNotifications'
import type { DisplayItem } from '../../hooks/useChat'

// ==================== Fixtures ====================

let id = 0
function notification(text: string): DisplayItem {
  return { kind: 'text', role: 'notification', text, _id: ++id }
}
function user(text: string): DisplayItem {
  return { kind: 'text', role: 'user', text, _id: ++id }
}
function assistant(text: string): DisplayItem {
  return { kind: 'text', role: 'assistant', text, _id: ++id }
}
function tool(): DisplayItem {
  return { kind: 'tool_calls', calls: [], _id: ++id }
}

// ==================== normalizeNotificationText ====================

describe('normalizeNotificationText', () => {
  it('collapses whitespace', () => {
    expect(normalizeNotificationText('  無異常  ')).toBe('無異常')
    expect(normalizeNotificationText('\n\t無異常\n')).toBe('無異常')
  })

  it('strips trailing punctuation', () => {
    expect(normalizeNotificationText('無異常。')).toBe('無異常')
    expect(normalizeNotificationText('無異常!')).toBe('無異常')
    expect(normalizeNotificationText('nothing to report.')).toBe('nothing to report')
  })

  it('is case-insensitive', () => {
    expect(normalizeNotificationText('Nothing To Report'))
      .toBe(normalizeNotificationText('nothing to report'))
  })

  it('preserves meaningful internal content', () => {
    expect(normalizeNotificationText('2330 dropped 4%')).toBe('2330 dropped 4%')
    expect(normalizeNotificationText('BTC just fell to 87k'))
      .not.toBe(normalizeNotificationText('BTC just fell to 86k'))
  })
})

// ==================== groupNotifications ====================

describe('groupNotifications', () => {
  it('leaves non-notification messages untouched', () => {
    const items = [user('hi'), assistant('hello'), tool()]
    const groups = groupNotifications(items)
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.kind === 'single')).toBe(true)
  })

  it('leaves a single lone notification as a single group', () => {
    const n = notification('無異常')
    const groups = groupNotifications([n])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('single')
  })

  it('folds two consecutive identical notifications into a run of 2', () => {
    const groups = groupNotifications([notification('無異常'), notification('無異常')])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('notification-run')
    if (groups[0].kind === 'notification-run') {
      expect(groups[0].count).toBe(2)
      expect(groups[0].items).toHaveLength(2)
    }
  })

  it('folds a long run of identical notifications', () => {
    const items = Array.from({ length: 12 }, () => notification('無異常'))
    const groups = groupNotifications(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('notification-run')
    if (groups[0].kind === 'notification-run') expect(groups[0].count).toBe(12)
  })

  it('folds across whitespace and punctuation variants', () => {
    const groups = groupNotifications([
      notification('無異常'),
      notification('無異常。'),
      notification('  無異常  '),
      notification('無異常!'),
    ])
    expect(groups).toHaveLength(1)
    if (groups[0].kind === 'notification-run') expect(groups[0].count).toBe(4)
  })

  it('does NOT fold notifications with different normalized text', () => {
    const groups = groupNotifications([
      notification('2330 dropped 4%'),
      notification('2330 dropped 5%'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.kind === 'single')).toBe(true)
  })

  it('does NOT fold across a user message', () => {
    const groups = groupNotifications([
      notification('無異常'),
      notification('無異常'),
      user('hi'),
      notification('無異常'),
      notification('無異常'),
    ])
    expect(groups).toHaveLength(3)
    expect(groups[0].kind).toBe('notification-run')
    expect(groups[1].kind).toBe('single')
    expect(groups[2].kind).toBe('notification-run')
  })

  it('does NOT fold across an assistant message', () => {
    const groups = groupNotifications([
      notification('無異常'),
      assistant('ok'),
      notification('無異常'),
    ])
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.kind === 'single')).toBe(true)
  })

  it('preserves order between runs and singles', () => {
    const n1 = notification('無異常')
    const n2 = notification('無異常')
    const u = user('question')
    const a = assistant('answer')
    const n3 = notification('critical alert')
    const groups = groupNotifications([n1, n2, u, a, n3])
    expect(groups).toHaveLength(4)
    expect(groups[0].kind).toBe('notification-run')
    expect(groups[1].kind).toBe('single')
    if (groups[1].kind === 'single') expect(groups[1].item).toBe(u)
    expect(groups[2].kind).toBe('single')
    if (groups[2].kind === 'single') expect(groups[2].item).toBe(a)
    expect(groups[3].kind).toBe('single')
    if (groups[3].kind === 'single') expect(groups[3].item).toBe(n3)
  })

  it('does not mutate the input array', () => {
    const input = [notification('無異常'), notification('無異常')]
    const snapshot = [...input]
    groupNotifications(input)
    expect(input).toEqual(snapshot)
  })

  it('gives each group a stable _id for React keys', () => {
    const groups = groupNotifications([
      notification('無異常'),
      notification('無異常'),
      user('hi'),
    ])
    expect(groups[0]._id).toBeDefined()
    expect(groups[1]._id).toBeDefined()
    expect(groups[0]._id).not.toBe(groups[1]._id)
  })
})
