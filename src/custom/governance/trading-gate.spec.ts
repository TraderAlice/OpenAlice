import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { EventLog } from '../../core/event-log.js'
import type { Config } from '../../core/config.js'
import { createGovernanceGatedDispatcher, enforceGovernanceReleaseGate } from './trading-gate.js'

function makeGovernanceConfig(statusPath: string): Config['governance'] {
  return {
    enabled: true,
    fallbackConfigId: 'H0',
    releaseGate: {
      enabled: true,
      statusPath,
      maxStatusAgeHours: 24,
      blockOnExpired: true,
    },
    liveGate: {
      enabled: true,
      quoteAgeP95MsMax: 2000,
      decisionToSubmitP95MsMax: 800,
      decisionToFirstFillP95MsMax: 2500,
    },
    statsGate: {
      fdrQMax: 0.1,
      transferPassRatioRolling14dMin: 0.25,
      winnerEligibleRatioRolling14dMin: 0.35,
      meanPboMax: 0.2,
      meanDsrProbabilityMin: 0.5,
    },
  }
}

function makeEventLogSpy(): { eventLog: EventLog; append: ReturnType<typeof vi.fn> } {
  const append = vi.fn().mockResolvedValue({ seq: 1, ts: Date.now(), type: '', payload: {} })
  return {
    eventLog: {
      append,
    } as unknown as EventLog,
    append,
  }
}

describe('governance trading gate', () => {
  it('skips non-placeOrder actions', async () => {
    const { eventLog, append } = makeEventLogSpy()
    const governance = makeGovernanceConfig('does/not/matter.json')

    await expect(
      enforceGovernanceReleaseGate({
        market: 'crypto',
        action: 'closePosition',
        paperTrading: false,
        governance,
        eventLog,
      }),
    ).resolves.toBeUndefined()

    expect(append).not.toHaveBeenCalled()
  })

  it('blocks placeOrder when live trading is disabled by release gate', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'openalice-gate-block-'))
    try {
      const statusPath = resolve(tempDir, 'release_gate_status.json')
      await writeFile(
        statusPath,
        JSON.stringify(
          {
            generatedAt: '2026-03-01T00:00:00.000Z',
            expiresAt: '2026-03-02T00:00:00.000Z',
            allowPaperTrading: true,
            allowLiveTrading: false,
          },
          null,
          2,
        ) + '\n',
        'utf-8',
      )

      const { eventLog, append } = makeEventLogSpy()
      const governance = makeGovernanceConfig(statusPath)

      await expect(
        enforceGovernanceReleaseGate({
          market: 'securities',
          action: 'placeOrder',
          paperTrading: false,
          governance,
          eventLog,
        }),
      ).rejects.toThrow('[governance:release-gate]')

      expect(append).toHaveBeenCalledWith(
        'governance.block',
        expect.objectContaining({ reason: 'allowLiveTrading=false' }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('warns instead of blocking on expired status when blockOnExpired=false', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'openalice-gate-warn-'))
    try {
      const statusPath = resolve(tempDir, 'release_gate_status.json')
      await writeFile(
        statusPath,
        JSON.stringify(
          {
            generatedAt: '2026-02-20T00:00:00.000Z',
            expiresAt: '2026-02-21T00:00:00.000Z',
            allowPaperTrading: true,
            allowLiveTrading: true,
          },
          null,
          2,
        ) + '\n',
        'utf-8',
      )

      const { eventLog, append } = makeEventLogSpy()
      const governance = makeGovernanceConfig(statusPath)
      governance.releaseGate.blockOnExpired = false

      await expect(
        enforceGovernanceReleaseGate({
          market: 'crypto',
          action: 'placeOrder',
          paperTrading: true,
          governance,
          eventLog,
        }),
      ).resolves.toBeUndefined()

      expect(append).toHaveBeenCalledWith(
        'governance.warn',
        expect.objectContaining({ reason: expect.stringContaining('status') }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('gated dispatcher blocks only placeOrder and passes through close/cancel paths', async () => {
    const dispatch = vi.fn().mockResolvedValue({ success: true })
    const { eventLog } = makeEventLogSpy()
    const governance = makeGovernanceConfig('missing_status.json')
    const gatedDispatch = createGovernanceGatedDispatcher({
      market: 'crypto',
      paperTrading: false,
      governance,
      eventLog,
      dispatch,
    })

    await expect(
      gatedDispatch({ action: 'closePosition', params: { symbol: 'BTC/USD' } }),
    ).resolves.toEqual({ success: true })
    expect(dispatch).toHaveBeenCalledTimes(1)

    await expect(
      gatedDispatch({ action: 'placeOrder', params: { symbol: 'BTC/USD' } }),
    ).rejects.toThrow('[governance:release-gate]')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
