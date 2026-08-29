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

const launchMocks = vi.hoisted(() => ({
  recentChatWorkspaceId: 'ws-b' as string | null,
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [
      {
        id: 'ws-a',
        tag: 'alpha',
        displayName: 'Alpha desk',
        createdAt: '2026-01-01T00:00:00.000Z',
        template: 'auto-quant-v2',
        sessions: [],
      },
      {
        id: 'ws-b',
        tag: 'beta',
        displayName: 'Beta desk',
        createdAt: '2026-06-01T00:00:00.000Z',
        template: 'chat',
        sessions: [],
      },
      {
        id: 'ws-c',
        tag: 'gamma',
        displayName: 'Gamma desk',
        createdAt: '2026-07-01T00:00:00.000Z',
        template: 'chat',
        sessions: [],
      },
    ],
  }),
}))

vi.mock('../hooks/useAgentLaunchConfig', () => ({
  useAgentLaunchPreferences: () => ({
    recentChatWorkspaceId: launchMocks.recentChatWorkspaceId,
    lastCredentialByAgent: {},
    recentLaunch: null,
    loaded: true,
    rememberLaunch: vi.fn(),
    adoptRecentChatWorkspace: vi.fn(),
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
  launchMocks.recentChatWorkspaceId = 'ws-b'
  vi.clearAllMocks()
})

afterEach(() => cleanup())

describe('TelegramDeskPanel', () => {
  it('asks for a linked bot before enabling an unbound desk', () => {
    render(<TelegramDeskPanel linked={false} label="Telegram" />)
    expect(screen.getByText(/Finish linking the bot/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enable phone desk' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('defaults the unbound picker to the Ask Alice Chat workspace', () => {
    render(<TelegramDeskPanel linked label="Telegram" />)
    expect((screen.getByLabelText('Workspace') as HTMLSelectElement).value).toBe('ws-b')
  })

  it('falls back to the active Chat workspace when Ask Alice has no remembered target', () => {
    launchMocks.recentChatWorkspaceId = null
    render(<TelegramDeskPanel linked label="Telegram" />)
    expect((screen.getByLabelText('Workspace') as HTMLSelectElement).value).toBe('ws-c')
  })

  it('enables the desk in the Ask Alice workspace without a manual pick', async () => {
    render(<TelegramDeskPanel linked label="Telegram" />)
    fireEvent.click(screen.getByRole('button', { name: 'Enable phone desk' }))
    await waitFor(() => expect(mocks.desk.enable).toHaveBeenCalledWith('ws-b'))
  })

  it('enables the desk in the selected workspace once linked', async () => {
    render(<TelegramDeskPanel linked label="Telegram" />)
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'ws-c' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enable phone desk' }))
    await waitFor(() => expect(mocks.desk.enable).toHaveBeenCalledWith('ws-c'))
  })

  it('opens the bound Issue detail and confirms disable', async () => {
    mocks.desk.desk = boundDesk()
    render(<TelegramDeskPanel linked label="Telegram" />)

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
