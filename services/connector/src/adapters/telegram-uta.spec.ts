import { describe, expect, it } from 'vitest'
import type { ConnectorUtaAccountReview, ConnectorUtaReview } from '@traderalice/connector-protocol'
import {
  TELEGRAM_BUTTON_TEXT_MAX,
  TELEGRAM_CALLBACK_DATA_MAX,
  assertTelegramFormBounds,
} from './telegram-controls.js'
import {
  formatTelegramUtaConfirmPage,
  formatTelegramUtaDetailPage,
  formatTelegramUtaListPage,
  formatTelegramUtaLoadingPage,
  parseTelegramUtaControl,
  transitionTelegramUta,
} from './telegram-uta.js'

function account(overrides: Partial<ConnectorUtaAccountReview> = {}): ConnectorUtaAccountReview {
  return {
    id: 'alpaca-paper',
    label: 'Alpaca paper',
    pendingMessage: 'long AAPL',
    pendingHash: 'abc12345',
    stagedCount: 1,
    operations: [{
      action: 'placeOrder',
      symbol: 'AAPL',
      side: 'BUY',
      orderType: 'MKT',
      quantity: '10',
      summary: 'BUY AAPL MKT × 10',
    }],
    ...overrides,
  }
}

function review(overrides: Partial<ConnectorUtaReview> = {}): ConnectorUtaReview {
  return {
    generatedAt: '2026-08-19T12:00:00.000Z',
    accounts: [account()],
    ...overrides,
  }
}

describe('Telegram UTA controls', () => {
  it('parses short page-local payloads and ignores inbox/settings buttons', () => {
    expect(parseTelegramUtaControl('u:r')).toEqual({ kind: 'refresh' })
    expect(parseTelegramUtaControl('u:a:0')).toEqual({ kind: 'account', index: 0 })
    expect(parseTelegramUtaControl('u:a:7')).toEqual({ kind: 'account', index: 7 })
    expect(parseTelegramUtaControl('u:p')).toEqual({ kind: 'push' })
    expect(parseTelegramUtaControl('u:x')).toEqual({ kind: 'reject' })
    expect(parseTelegramUtaControl('u:y')).toEqual({ kind: 'confirm' })
    expect(parseTelegramUtaControl('u:c')).toEqual({ kind: 'cancel' })
    expect(parseTelegramUtaControl('u:b')).toEqual({ kind: 'back' })
    expect(parseTelegramUtaControl('u:a:8')).toBeUndefined()
    expect(parseTelegramUtaControl('u:a:alpaca-paper')).toBeUndefined()
    expect(parseTelegramUtaControl('s:p:1')).toBeUndefined()
    expect(parseTelegramUtaControl('i:e:0')).toBeUndefined()
    expect(parseTelegramUtaControl('x'.repeat(TELEGRAM_CALLBACK_DATA_MAX + 1))).toBeUndefined()
  })

  it('lists waiting accounts without embedding account ids in callback data', () => {
    const page = formatTelegramUtaListPage(review({
      accounts: [
        account(),
        account({ id: 'ibkr-demo', label: 'IBKR demo', pendingMessage: null, pendingHash: null, stagedCount: 0, operations: [] }),
      ],
    }))
    expect(page.text).toContain('UTA · 1 waiting')
    expect(page.text).toContain('Updated 12:00 UTC')
    expect(page.text).toContain('1. Alpaca paper')
    expect(page.text).toContain('waiting for approval')
    expect(page.text).toContain('2. IBKR demo')
    expect(page.text).toContain('idle')
    expect(page.actions.flat().map((action) => action.data)).toEqual(['u:a:0', 'u:a:1', 'u:r'])
    assertTelegramFormBounds(page)
  })

  it('confirms a live push before enqueueing', () => {
    const confirm = formatTelegramUtaConfirmPage(account(), 'push')
    expect(confirm.text).toContain('Push to Alpaca paper?')
    expect(confirm.text).toContain('sends the committed operations')
    expect(confirm.actions).toEqual([[
      { text: 'Push', data: 'u:y' },
      { text: 'Cancel', data: 'u:c' },
    ]])
    assertTelegramFormBounds(confirm)
  })

  it('hides Approve in readonly mode', () => {
    const detail = formatTelegramUtaDetailPage(account(), { readonly: true })
    expect(detail.actions.flat().map((action) => action.data)).toEqual(['u:x', 'u:b'])
  })

  it('enqueues review from Refresh even without a prior session', () => {
    const resolution = transitionTelegramUta(undefined, { kind: 'refresh' }, { isOwner: true })
    expect(resolution).toMatchObject({ kind: 'enqueue', action: 'review' })
    if (resolution.kind !== 'enqueue') return
    expect(resolution.form.text).toContain('Asking OpenAlice')
    expect(resolution.session.view).toEqual({
      kind: 'loading',
      reason: 'Asking OpenAlice for the current UTA review…',
    })
  })

  it('enqueues push with the pending hash from the reviewed account', () => {
    const session = {
      accountIds: ['alpaca-paper'],
      review: review(),
      view: { kind: 'confirm-push' as const, index: 0 },
    }
    const resolution = transitionTelegramUta(session, { kind: 'confirm' }, { isOwner: true })
    expect(resolution).toEqual({
      kind: 'enqueue',
      action: 'push',
      utaId: 'alpaca-paper',
      pendingHash: 'abc12345',
      form: formatTelegramUtaLoadingPage('Pushing to the broker…'),
      session: {
        ...session,
        view: { kind: 'loading', reason: 'Pushing to the broker…' },
      },
    })
  })

  it('rejects non-owners and expired pages', () => {
    expect(transitionTelegramUta(undefined, { kind: 'account', index: 0 }, { isOwner: false }))
      .toEqual({ kind: 'forbidden' })
    expect(transitionTelegramUta(undefined, { kind: 'account', index: 0 }, { isOwner: true }))
      .toEqual({ kind: 'expired' })
  })

  it('keeps button labels and callback data inside Telegram limits', () => {
    const page = formatTelegramUtaListPage(review({
      accounts: Array.from({ length: 8 }, (_, index) => account({
        id: `acct-${index}`,
        label: `Very long trading account label ${index} `.repeat(4).trim(),
      })),
    }))
    for (const action of page.actions.flat()) {
      expect(action.text.length).toBeLessThanOrEqual(TELEGRAM_BUTTON_TEXT_MAX)
      expect(Buffer.byteLength(action.data, 'utf8')).toBeLessThanOrEqual(TELEGRAM_CALLBACK_DATA_MAX)
    }
    assertTelegramFormBounds(page)
    assertTelegramFormBounds(formatTelegramUtaLoadingPage())
    assertTelegramFormBounds(formatTelegramUtaDetailPage(account()))
  })
})
