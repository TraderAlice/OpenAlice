import { describe, expect, it, vi } from 'vitest'
import type { UTAConfig } from '@/core/config.js'
import { MockBroker } from './brokers/mock/index.js'

vi.mock('./git-persistence.js', () => ({
  loadGitState: vi.fn(async () => undefined),
  createGitPersister: vi.fn(() => vi.fn(async () => undefined)),
}))

const broker = new MockBroker({ id: 'ibkr-tws-b9646326', label: 'ibkr' })

vi.mock('./brokers/factory.js', () => ({
  createBroker: vi.fn(() => broker),
}))

describe('UTAManager.initUTA approvalGate wiring', () => {
  it('passes cfg.approvalGate into UnifiedTradingAccount options', async () => {
    const { UTAManager } = await import('./uta-manager.js')
    const manager = new UTAManager()
    const cfg: UTAConfig = {
      id: 'ibkr-tws-b9646326',
      label: 'ibkr',
      presetId: 'ibkr-tws',
      enabled: true,
      guards: [],
      presetConfig: { host: '127.0.0.1', port: '7497', clientId: '0' },
      keyless: false,
      readOnly: false,
      editable: true,
      approvalGate: {
        enabled: true,
        ticketDirectory: 'autonomy/tickets',
        publicKeyPath: 'autonomy/ticket-signing.ed25519.public.pem',
        allowedAccountRole: 'paper',
        requireTicket: true,
      },
    }

    const uta = await manager.initUTA(cfg)

    expect(uta.id).toBe('ibkr-tws-b9646326')
    uta.stagePlaceOrder({ aliceId: 'ibkr-tws-b9646326|AAPL', symbol: 'AAPL', action: 'BUY', orderType: 'LMT', totalQuantity: '1', lmtPrice: '150' })
    uta.commit('message without signed ticket')
    await expect(uta.push()).rejects.toThrow()
  })
})
