// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api'
import type { TelegramConnectorDesk } from '../api/connectors'
import { useTelegramConnectorDesk } from './useTelegramConnectorDesk'

vi.mock('../api', () => ({
  api: {
    connectors: {
      desk: {
        load: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        disable: vi.fn(),
      },
    },
  },
}))

function desk(what = 'Wake and read comments.'): TelegramConnectorDesk {
  return {
    wsId: 'ws-a',
    issue: {
      id: 'telegram-phone-desk',
      title: 'Telegram phone desk',
      what,
      status: 'todo',
      priority: 'none',
      assignee: '@new-then-resume',
      when: { kind: 'every', every: '4h' },
      telegramConnector: true,
    },
  }
}

describe('useTelegramConnectorDesk', () => {
  beforeEach(() => {
    vi.mocked(api.connectors.desk.load).mockReset()
    vi.mocked(api.connectors.desk.create).mockReset()
    vi.mocked(api.connectors.desk.update).mockReset()
    vi.mocked(api.connectors.desk.disable).mockReset()
    vi.mocked(api.connectors.desk.load).mockResolvedValue({ desk: null })
  })

  it('loads an unbound desk and then binds one workspace', async () => {
    const { result } = renderHook(() => useTelegramConnectorDesk())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.desk).toBeNull()

    vi.mocked(api.connectors.desk.create).mockResolvedValue(desk())
    await act(async () => {
      await expect(result.current.enable('ws-a')).resolves.toBe(true)
    })
    expect(result.current.desk?.wsId).toBe('ws-a')
    expect(api.connectors.desk.create).toHaveBeenCalledWith('ws-a', 'telegram')
  })

  it('keeps the bound desk when a later save fails', async () => {
    vi.mocked(api.connectors.desk.load).mockResolvedValue({ desk: desk('old') })
    const { result } = renderHook(() => useTelegramConnectorDesk())
    await waitFor(() => expect(result.current.desk?.issue.what).toBe('old'))

    vi.mocked(api.connectors.desk.update).mockRejectedValue(new Error('unavailable'))
    await act(async () => {
      await expect(result.current.saveWhat('new prompt')).resolves.toBe(false)
    })
    expect(result.current.desk?.issue.what).toBe('old')
    expect(result.current.error).toBe('unavailable')
  })
})
