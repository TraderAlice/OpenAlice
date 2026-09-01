// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrokerHealthInfo, BrokerPackReadinessResponse, UTAConfig } from '../api/types'

const apiMocks = vi.hoisted(() => ({
  getBrokerPacks: vi.fn(),
  installBrokerPack: vi.fn(),
}))
const authMocks = vi.hoisted(() => ({
  backendUnavailable: false,
  backendRecoveryGeneration: 0,
}))

vi.mock('../api', () => ({
  api: { trading: apiMocks },
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => authMocks,
}))

import {
  deriveAccountInteractionPolicy,
  selectAccountPackReadiness,
  useBrokerPackReadiness,
} from './useBrokerPackReadiness'

const account: UTAConfig = {
  id: 'main', label: 'Main', presetId: 'okx', enabled: true,
  guards: [], presetConfig: {}, readOnly: false, asVendor: true,
}
const ready = {
  accountId: 'main', label: 'Main', presetId: 'okx', configuredEnabled: true,
  engine: 'ccxt' as const, state: 'ready' as const, operational: true,
}
const health: BrokerHealthInfo = {
  status: 'healthy', reach: 'readable', tier: 'trading', consecutiveFailures: 0,
  recovering: false, connecting: false, disabled: false,
}
const response: BrokerPackReadinessResponse = {
  packs: [{ engine: 'ccxt', installed: true, source: 'downloaded', requiredBy: ['Main'] }],
  accounts: [ready],
}

beforeEach(() => {
  authMocks.backendUnavailable = false
  authMocks.backendRecoveryGeneration = 0
  apiMocks.getBrokerPacks.mockResolvedValue(response)
  apiMocks.installBrokerPack.mockResolvedValue(response.packs[0])
  vi.clearAllMocks()
})

describe('account Broker Pack readiness policy', () => {
  it('fails closed while support is missing or its status cannot be read', () => {
    const missing = { ...ready, state: 'needs-install' as const, operational: false, action: 'install' as const }
    expect(deriveAccountInteractionPolicy({ account, readiness: missing, health, tradingMode: 'pro' })).toMatchObject({
      canRead: false, canReconnect: false, canTrade: false,
    })

    expect(selectAccountPackReadiness(account, { data: null, loading: false, error: 'Runtime offline' })).toMatchObject({
      state: 'status-unavailable', operational: false, reason: 'Runtime offline',
    })
    expect(selectAccountPackReadiness(account, { data: response, loading: false, error: 'Runtime offline' })).toMatchObject({
      state: 'status-unavailable', operational: false, reason: 'Runtime offline',
    })
    expect(selectAccountPackReadiness(account, { data: response, loading: true, error: null })).toMatchObject({
      state: 'checking', operational: false,
    })
  })

  it('requires config, mode, health reach, tier, and writable account before trading', () => {
    expect(deriveAccountInteractionPolicy({ account, readiness: ready, health, tradingMode: 'pro' })).toEqual({
      canRead: true, canReconnect: true, canTrade: true,
    })
    expect(deriveAccountInteractionPolicy({ account: { ...account, readOnly: true }, readiness: ready, health, tradingMode: 'pro' })).toMatchObject({
      canRead: true, canReconnect: true, canTrade: false,
    })
    expect(deriveAccountInteractionPolicy({ account, readiness: ready, health, tradingMode: 'readonly' })).toMatchObject({ canTrade: false })
    expect(deriveAccountInteractionPolicy({ account, readiness: ready, health: { ...health, reach: 'down' }, tradingMode: 'pro' })).toMatchObject({ canTrade: false })
    expect(deriveAccountInteractionPolicy({ account, readiness: ready, health: { ...health, tier: 'account' }, tradingMode: 'pro' })).toMatchObject({ canTrade: false })
  })
})

describe('useBrokerPackReadiness', () => {
  it('discovers support without installing anything implicitly', async () => {
    const { result } = renderHook(() => useBrokerPackReadiness())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.forAccount(account)).toMatchObject({ state: 'ready', operational: true })
    expect(apiMocks.getBrokerPacks).toHaveBeenCalledOnce()
    expect(apiMocks.installBrokerPack).not.toHaveBeenCalled()

    await act(async () => { await result.current.install('ccxt') })
    expect(apiMocks.installBrokerPack).toHaveBeenCalledWith('ccxt')
    expect(apiMocks.getBrokerPacks).toHaveBeenCalledTimes(2)
  })

  it('fails closed after a refresh error and reloads on backend recovery', async () => {
    const { result, rerender } = renderHook(() => useBrokerPackReadiness())

    await waitFor(() => expect(result.current.forAccount(account).operational).toBe(true))

    apiMocks.getBrokerPacks.mockRejectedValueOnce(new Error('Runtime offline'))
    await act(async () => { await result.current.refresh() })

    expect(result.current.data).toBeNull()
    expect(result.current.forAccount(account)).toMatchObject({
      state: 'status-unavailable', operational: false, reason: 'Runtime offline',
    })

    authMocks.backendUnavailable = true
    rerender()
    expect(result.current.forAccount(account)).toMatchObject({
      state: 'status-unavailable', operational: false,
    })

    apiMocks.getBrokerPacks.mockResolvedValueOnce(response)
    authMocks.backendUnavailable = false
    authMocks.backendRecoveryGeneration += 1
    rerender()

    await waitFor(() => expect(result.current.forAccount(account).operational).toBe(true))
    expect(apiMocks.getBrokerPacks).toHaveBeenCalledTimes(3)
  })
})
