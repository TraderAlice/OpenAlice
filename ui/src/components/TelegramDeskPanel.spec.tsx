// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TelegramConnectorDesk } from '../api/connectors'
import type { UseTelegramConnectorDesk } from '../hooks/useTelegramConnectorDesk'
import { i18n } from '../i18n'
import { TelegramDeskPanel } from './TelegramDeskPanel'

const mocks = vi.hoisted(() => ({
  desk: {
    desk: null as TelegramConnectorDesk | null,
    loading: false,
    error: null as string | null,
    enable: vi.fn(async () => true),
    disable: vi.fn(async () => true),
    saveWhat: vi.fn(async () => true),
    saveCadence: vi.fn(async () => true),
  } satisfies UseTelegramConnectorDesk,
  openOrFocus: vi.fn(),
}))

vi.mock('../hooks/useTelegramConnectorDesk', () => ({
  useTelegramConnectorDesk: () => mocks.desk,
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [
      { id: 'ws-a', tag: 'alpha', displayName: 'Alpha desk' },
      { id: 'ws-b', tag: 'beta', displayName: 'Beta desk' },
    ],
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('./MarkdownWhatEditor', () => ({
  MarkdownWhatEditor: ({ value }: { value: string }) => <div>{value}</div>,
}))

function boundDesk(): TelegramConnectorDesk {
  return {
    wsId: 'ws-a',
    issue: {
      id: 'telegram-phone-desk',
      title: 'Telegram phone desk',
      what: 'Read comments and reply.',
      status: 'todo',
      priority: 'none',
      assignee: '@new-then-resume',
      when: { kind: 'every', every: '4h' },
      telegramConnector: true,
    },
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.desk.desk = null
  mocks.desk.loading = false
  mocks.desk.error = null
  vi.clearAllMocks()
})

afterEach(() => cleanup())

describe('TelegramDeskPanel', () => {
  it('asks for a linked bot before enabling an unbound desk', () => {
    render(<TelegramDeskPanel linked={false} />)
    expect(screen.getByText(/Finish linking the bot/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enable phone desk' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables the desk in the selected workspace once linked', async () => {
    render(<TelegramDeskPanel linked />)
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'ws-b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enable phone desk' }))
    await waitFor(() => expect(mocks.desk.enable).toHaveBeenCalledWith('ws-b'))
  })

  it('opens the bound Issue detail and confirms disable', async () => {
    mocks.desk.desk = boundDesk()
    render(<TelegramDeskPanel linked />)

    fireEvent.click(screen.getByRole('button', { name: 'Open phone desk' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'issue-detail',
      params: { wsId: 'ws-a', id: 'telegram-phone-desk' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Disable phone desk' }))
    expect(screen.getByRole('heading', { name: 'Disable Telegram phone desk?' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Disable phone desk' }).at(-1)!)
    await waitFor(() => expect(mocks.desk.disable).toHaveBeenCalled())
  })
})
