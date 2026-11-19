// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ScheduleSkipState } from '../api/schedule'
import { i18n } from '../i18n'
import {
  formatFutureRetryTime,
  formatScheduleNextRunLabel,
  ScheduleSkipPill,
  ScheduleSkipStateNotice,
} from './ScheduleSkipState'

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
})

describe('ScheduleSkipState', () => {
  it('formats future retry boundaries stably without off-by-one drift', () => {
    expect(formatFutureRetryTime(NOW + 5 * 60_000 - 5, NOW, 'en')).toBe('in 5m')
    expect(formatFutureRetryTime(NOW + 60_000 - 3, NOW, 'en')).toBe('in 1m')
    expect(formatFutureRetryTime(NOW + 30_000, NOW, 'en')).toBe('in 30s')
    expect(formatFutureRetryTime(NOW + 3_600_000 - 10, NOW, 'en')).toBe('in 1h')
    expect(formatFutureRetryTime(NOW - 1_000, NOW, 'en')).toBeNull()
  })

  it('renders deferred pill with countdown and accessible reason', () => {
    const skipState: ScheduleSkipState = {
      kind: 'deferred',
      code: 'session_blocked',
      reason: 'Session is cooling down after rate limit.',
      retryAtMs: NOW + 5 * 60_000,
      sinceMs: NOW - 60_000,
    }

    render(<ScheduleSkipPill skipState={skipState} nowMs={NOW} />)

    const pill = screen.getByTestId('schedule-skip-pill')
    expect(pill.getAttribute('data-skip-kind')).toBe('deferred')
    expect(pill.textContent).toBe('Retrying in 5m')
    expect(pill.getAttribute('aria-label')).toBe(
      'Retrying in 5m — Session is cooling down after rate limit.',
    )
    expect(pill.getAttribute('title')).toBe(
      'Retrying in 5m — Session is cooling down after rate limit.',
    )
  })

  it('renders deferred pill fallback status when retryAtMs has elapsed', () => {
    const skipState: ScheduleSkipState = {
      kind: 'deferred',
      code: 'session_blocked',
      reason: 'Session cooldown just ended.',
      retryAtMs: NOW,
      sinceMs: NOW - 60_000,
    }

    const { unmount } = render(<ScheduleSkipPill skipState={skipState} nowMs={NOW} />)
    expect(screen.getByTestId('schedule-skip-pill').textContent).toBe('Cooling down')
    unmount()

    render(
      <ScheduleSkipPill
        skipState={{ ...skipState, code: 'not_ready', reason: 'Runtime starting up.' }}
        nowMs={NOW}
      />,
    )
    expect(screen.getByTestId('schedule-skip-pill').textContent).toBe('Backing off')
  })

  it('renders parked pill with Paused badge and reason aria-label', () => {
    const skipState: ScheduleSkipState = {
      kind: 'parked',
      code: 'retired',
      reason: 'Assigned Session is retired.',
      sinceMs: NOW - 10 * 60_000,
    }

    render(<ScheduleSkipPill skipState={skipState} nowMs={NOW} />)

    const pill = screen.getByTestId('schedule-skip-pill')
    expect(pill.getAttribute('data-skip-kind')).toBe('parked')
    expect(pill.textContent).toBe('Paused')
    expect(pill.getAttribute('aria-label')).toBe('Paused — Assigned Session is retired.')
  })

  it('renders deferred inspector notice with badge, retry countdown, and reason', () => {
    const skipState: ScheduleSkipState = {
      kind: 'deferred',
      code: 'not_ready',
      reason: 'Headless session is still initializing.',
      retryAtMs: NOW + 15 * 60_000,
      sinceMs: NOW - 2 * 60_000,
    }

    render(<ScheduleSkipStateNotice skipState={skipState} nowMs={NOW} />)

    const notice = screen.getByTestId('schedule-skip-notice')
    expect(notice.getAttribute('data-skip-kind')).toBe('deferred')
    expect(notice.getAttribute('role')).toBe('status')
    expect(screen.getByText('Backing off')).toBeTruthy()
    expect(screen.getByText('Retrying in 15m')).toBeTruthy()
    expect(screen.getByText('Headless session is still initializing.')).toBeTruthy()
  })

  it('renders parked inspector notice with reason and code-specific recovery guidance', () => {
    const blocked: ScheduleSkipState = {
      kind: 'parked',
      code: 'session_blocked',
      reason: 'Execution fault circuit breaker tripped after repeated crashes.',
      sinceMs: NOW - 10 * 60_000,
    }

    const { unmount } = render(<ScheduleSkipStateNotice skipState={blocked} nowMs={NOW} />)
    expect(screen.getByText('Paused')).toBeTruthy()
    expect(screen.getByText('Since 10m ago')).toBeTruthy()
    expect(
      screen.getByText('Execution fault circuit breaker tripped after repeated crashes.'),
    ).toBeTruthy()
    expect(
      screen.getByText(/Release the Session block, reassign the Issue, or run manually to resume\./),
    ).toBeTruthy()
    unmount()

    render(
      <ScheduleSkipStateNotice
        skipState={{
          kind: 'parked',
          code: 'adapter_no_headless',
          reason: 'agent runtime does not support headless work: custom-cli',
          sinceMs: NOW - 30_000,
        }}
        nowMs={NOW}
      />,
    )
    expect(
      screen.getByText(/Select an Agent runtime that supports background execution to resume\./),
    ).toBeTruthy()
  })

  it('computes accurate Next run label for parked, deferred, and normal schedules', () => {
    expect(
      formatScheduleNextRunLabel(
        NOW,
        { kind: 'parked', code: 'retired', reason: 'Retired', sinceMs: NOW - 60_000 },
        i18n.t,
        'en',
        NOW,
      ),
    ).toBe('Paused')

    expect(
      formatScheduleNextRunLabel(
        NOW,
        {
          kind: 'deferred',
          code: 'session_blocked',
          reason: 'Cooling down',
          retryAtMs: NOW + 10 * 60_000,
          sinceMs: NOW - 60_000,
        },
        i18n.t,
        'en',
        NOW,
      ),
    ).toBe('in 10m')
  })

  it.each([
    ['en', 'Cooling down', 'Retrying in 5m', 'Paused'],
    ['zh', '冷却中', '5分钟后重试', '已暂停'],
    ['zh-Hant', '冷卻中', '5 分鐘後重試', '已暫停'],
    ['ja', 'クールダウン中', '5分後に再試行', '一時停止'],
  ] as const)('localizes skip state labels in %s', async (locale, coolingLabel, retryLabel, pausedLabel) => {
    await i18n.changeLanguage(locale)

    const { unmount } = render(
      <ScheduleSkipStateNotice
        skipState={{
          kind: 'deferred',
          code: 'session_blocked',
          reason: 'Rate limited',
          retryAtMs: NOW + 5 * 60_000,
          sinceMs: NOW - 60_000,
        }}
        nowMs={NOW}
      />,
    )
    expect(screen.getByText(coolingLabel)).toBeTruthy()
    expect(screen.getByText(retryLabel)).toBeTruthy()
    unmount()

    render(
      <ScheduleSkipPill
        skipState={{
          kind: 'parked',
          code: 'session_blocked',
          reason: 'Fault block',
          sinceMs: NOW - 60_000,
        }}
        nowMs={NOW}
      />,
    )
    expect(screen.getByTestId('schedule-skip-pill').textContent).toBe(pausedLabel)
  })
})
