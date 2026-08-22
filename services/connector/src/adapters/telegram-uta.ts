import type {
  ConnectorUtaAccountReview,
  ConnectorUtaResult,
  ConnectorUtaReview,
} from '@traderalice/connector-protocol'
import {
  TELEGRAM_BUTTON_TEXT_MAX,
  TELEGRAM_CALLBACK_DATA_MAX,
  TELEGRAM_INBOX_PAGE_HARD_MAX,
  truncateTelegramText,
  type TelegramForm,
  type TelegramFormAction,
} from './telegram-controls.js'

export type TelegramUtaControl =
  | { kind: 'refresh' }
  | { kind: 'account'; index: number }
  | { kind: 'back' }
  | { kind: 'push' }
  | { kind: 'reject' }
  | { kind: 'confirm' }
  | { kind: 'cancel' }

export interface TelegramUtaSession {
  accountIds: string[]
  review?: ConnectorUtaReview
  result?: ConnectorUtaResult
  requestId?: string
  consumed?: boolean
  view?:
    | { kind: 'list' }
    | { kind: 'detail'; index: number }
    | { kind: 'confirm-push'; index: number }
    | { kind: 'confirm-reject'; index: number }
    | { kind: 'loading'; reason: string }
}

export type TelegramUtaResolution =
  | { kind: 'forbidden' }
  | { kind: 'ignored' }
  | { kind: 'expired' }
  | { kind: 'show'; form: TelegramForm; session: TelegramUtaSession }
  | {
      kind: 'enqueue'
      action: 'review' | 'push' | 'reject'
      utaId?: string
      pendingHash?: string
      form: TelegramForm
      session: TelegramUtaSession
    }

const ACCOUNT_CONTROL = /^u:a:([0-7])$/

export function parseTelegramUtaControl(data: string): TelegramUtaControl | undefined {
  if (data.length === 0 || data.length > TELEGRAM_CALLBACK_DATA_MAX) return undefined
  if (data === 'u:r') return { kind: 'refresh' }
  if (data === 'u:b') return { kind: 'back' }
  if (data === 'u:p') return { kind: 'push' }
  if (data === 'u:x') return { kind: 'reject' }
  if (data === 'u:y') return { kind: 'confirm' }
  if (data === 'u:c') return { kind: 'cancel' }
  const account = ACCOUNT_CONTROL.exec(data)
  if (account) return { kind: 'account', index: Number(account[1]) }
  return undefined
}

export function formatTelegramUtaLoadingPage(reason = 'Asking OpenAlice for the current UTA review…'): TelegramForm {
  return { text: ['UTA', '', reason].join('\n'), actions: [] }
}

export function formatTelegramUtaListPage(
  review: ConnectorUtaReview,
  result?: ConnectorUtaResult,
): TelegramForm {
  if (review.unavailable) {
    return {
      text: fitPageText(['UTA', '', review.unavailable].join('\n')),
      actions: [[button('Refresh', 'u:r')]],
    }
  }
  if (review.accounts.length === 0) {
    return {
      text: fitPageText([
        'UTA',
        '',
        'No trading accounts. Add one in OpenAlice → Trading.',
      ].join('\n')),
      actions: [[button('Refresh', 'u:r')]],
    }
  }

  const waiting = review.accounts.filter((account) => account.pendingMessage).length
  const lines = [
    waiting > 0 ? `UTA · ${waiting} waiting` : 'UTA · nothing waiting',
    `Updated ${formatWhen(review.generatedAt)}`,
    ...(review.readonly ? ['Readonly mode: reject is available, push is not.'] : []),
    ...(result ? ['', `Last: ${result.message}`] : []),
    '',
  ]
  const accountButtons: TelegramFormAction[][] = []
  for (const [index, account] of review.accounts.entries()) {
    lines.push(`${index + 1}. ${account.label}`)
    lines.push(accountStatusLine(account))
    if ((account.hiddenOperationCount ?? 0) > 0) {
      lines.push(`   ${account.stagedCount} operations · ${account.hiddenOperationCount} not shown`)
    }
    const preview = account.operations[0]?.summary
    if (preview) lines.push(`   ${preview}`)
    lines.push('')
    accountButtons.push([button(`${index + 1} · ${account.label}`, `u:a:${index}`)])
  }
  if (review.hiddenAccountCount) {
    lines.push(`And ${review.hiddenAccountCount} more in OpenAlice → Trading as Git.`)
  }
  return {
    text: fitPageText(lines.join('\n')),
    actions: [...accountButtons, [button('Refresh', 'u:r')]],
  }
}

export function formatTelegramUtaDetailPage(
  account: ConnectorUtaAccountReview,
  options: { readonly?: boolean } = {},
): TelegramForm {
  const lines = [
    account.label,
    accountStatusLine(account),
    ...(account.pendingMessage ? [`Commit: ${account.pendingMessage}`] : []),
    '',
    ...operationLines(account),
    ...((account.hiddenOperationCount ?? 0) > 0
      ? [
        '',
        `${account.stagedCount} operations · ${account.hiddenOperationCount} not shown.`,
        'Approve from OpenAlice → Trading as Git.',
      ]
      : []),
  ]
  const actions: TelegramFormAction[][] = []
  if (isRemoteActionable(account) && !options.readonly) {
    actions.push([button('Approve', 'u:p'), button('Reject', 'u:x')])
  } else if (isRemoteActionable(account) && options.readonly) {
    actions.push([button('Reject', 'u:x')])
  }
  actions.push([button('Back', 'u:b')])
  return { text: fitPageText(lines.join('\n')), actions }
}

export function formatTelegramUtaConfirmPage(
  account: ConnectorUtaAccountReview,
  kind: 'push' | 'reject',
): TelegramForm {
  const lines = kind === 'push'
    ? [
        `Push to ${account.label}?`,
        '',
        ...(account.pendingMessage ? [account.pendingMessage, ''] : []),
        ...operationLines(account),
        '',
        'This sends the committed operations to the broker.',
      ]
    : [
        `Reject the pending commit on ${account.label}?`,
        '',
        ...(account.pendingMessage ? [account.pendingMessage, ''] : []),
        'Nothing is sent to the broker.',
      ]
  return {
    text: fitPageText(lines.join('\n')),
    actions: [[
      button(kind === 'push' ? 'Push' : 'Reject', 'u:y'),
      button('Cancel', 'u:c'),
    ]],
  }
}

export function transitionTelegramUta(
  session: TelegramUtaSession | undefined,
  control: TelegramUtaControl,
  deps: { isOwner: boolean },
): TelegramUtaResolution {
  if (!deps.isOwner) return { kind: 'forbidden' }
  if (control.kind === 'refresh') {
    const next: TelegramUtaSession = {
      accountIds: session?.accountIds ?? [],
      review: session?.review,
      view: { kind: 'loading', reason: 'Asking OpenAlice for the current UTA review…' },
    }
    return {
      kind: 'enqueue',
      action: 'review',
      form: formatTelegramUtaLoadingPage(),
      session: next,
    }
  }
  if (!session?.review) return { kind: 'expired' }
  if (session.view?.kind === 'loading') return { kind: 'ignored' }
  if (session.consumed && (control.kind === 'push' || control.kind === 'reject' || control.kind === 'confirm')) {
    return { kind: 'expired' }
  }

  if (control.kind === 'account') {
    const account = session.review.accounts[control.index]
    if (!account) return { kind: 'expired' }
    const next: TelegramUtaSession = { ...session, view: { kind: 'detail', index: control.index } }
    return {
      kind: 'show',
      form: formatTelegramUtaDetailPage(account, { readonly: session.review.readonly }),
      session: next,
    }
  }

  if (control.kind === 'back') {
    const next: TelegramUtaSession = { ...session, view: { kind: 'list' } }
    return {
      kind: 'show',
      form: formatTelegramUtaListPage(session.review, session.result),
      session: next,
    }
  }

  const selectedIndex = selectedAccountIndex(session)
  if (selectedIndex === undefined) return { kind: 'expired' }
  const account = session.review.accounts[selectedIndex]
  if (!account) return { kind: 'expired' }

  if (control.kind === 'push') {
    if (!isRemoteActionable(account) || session.review.readonly) {
      return {
        kind: 'show',
        form: formatTelegramUtaDetailPage(account, { readonly: session.review.readonly }),
        session: { ...session, view: { kind: 'detail', index: selectedIndex } },
      }
    }
    const next: TelegramUtaSession = { ...session, view: { kind: 'confirm-push', index: selectedIndex } }
    return { kind: 'show', form: formatTelegramUtaConfirmPage(account, 'push'), session: next }
  }

  if (control.kind === 'reject') {
    if (!isRemoteActionable(account)) {
      return {
        kind: 'show',
        form: formatTelegramUtaDetailPage(account, { readonly: session.review.readonly }),
        session: { ...session, view: { kind: 'detail', index: selectedIndex } },
      }
    }
    const next: TelegramUtaSession = { ...session, view: { kind: 'confirm-reject', index: selectedIndex } }
    return { kind: 'show', form: formatTelegramUtaConfirmPage(account, 'reject'), session: next }
  }

  if (control.kind === 'cancel') {
    const next: TelegramUtaSession = { ...session, view: { kind: 'detail', index: selectedIndex } }
    return {
      kind: 'show',
      form: formatTelegramUtaDetailPage(account, { readonly: session.review.readonly }),
      session: next,
    }
  }

  if (control.kind === 'confirm') {
    const view = session.view
    if (view?.kind !== 'confirm-push' && view?.kind !== 'confirm-reject') return { kind: 'expired' }
    const action = view.kind === 'confirm-push' ? 'push' : 'reject'
    if (!isRemoteActionable(account) || !account.pendingHash) return { kind: 'expired' }
    const reason = action === 'push' ? 'Pushing to the broker…' : 'Rejecting the pending commit…'
    const next: TelegramUtaSession = {
      ...session,
      consumed: true,
      view: { kind: 'loading', reason },
    }
    return {
      kind: 'enqueue',
      action,
      utaId: account.id,
      pendingHash: account.pendingHash,
      form: formatTelegramUtaLoadingPage(reason),
      session: next,
    }
  }

  return { kind: 'ignored' }
}

function selectedAccountIndex(session: TelegramUtaSession): number | undefined {
  const view = session.view
  if (
    view?.kind === 'detail'
    || view?.kind === 'confirm-push'
    || view?.kind === 'confirm-reject'
  ) return view.index
  return undefined
}

export function isRemoteActionable(account: ConnectorUtaAccountReview): boolean {
  return Boolean(
    account.pendingMessage
    && account.pendingHash
    && (account.hiddenOperationCount ?? 0) === 0,
  )
}

function accountStatusLine(account: ConnectorUtaAccountReview): string {
  if (account.pendingMessage && (account.hiddenOperationCount ?? 0) > 0) {
    return 'waiting · too large for Telegram'
  }
  if (account.pendingMessage) return 'waiting for approval'
  if (account.stagedCount > 0) return `staged · ${account.stagedCount} not committed`
  return 'idle'
}

function operationLines(account: ConnectorUtaAccountReview): string[] {
  if (account.operations.length === 0) return ['No operations listed.']
  return account.operations.map((operation) => `· ${operation.summary}`)
}

function button(text: string, data: string): TelegramFormAction {
  if (Buffer.byteLength(data, 'utf8') > TELEGRAM_CALLBACK_DATA_MAX) {
    throw new Error('Telegram callback data exceeds 64 bytes')
  }
  return { text: truncateTelegramText(text, TELEGRAM_BUTTON_TEXT_MAX), data }
}

function fitPageText(text: string): string {
  return truncateTelegramText(text.trimEnd(), TELEGRAM_INBOX_PAGE_HARD_MAX)
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'just now'
  return date.toISOString().slice(11, 16) + ' UTC'
}
