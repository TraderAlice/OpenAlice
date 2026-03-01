import { describe, expect, it } from 'vitest'
import {
  buildGovernanceRouteWritePayload,
  isGovernanceSectionParam,
  normalizeGovernanceRouteRequest,
  normalizeGovernanceSectionParam,
} from '../web/upstream-config-route-adapter.js'

describe('upstream config route adapter contract', () => {
  it('normalizes governance section aliases and rejects unknown sections', () => {
    expect(normalizeGovernanceSectionParam(' governance ')).toBe('governance')
    expect(normalizeGovernanceSectionParam('governance_config')).toBe('governance')
    expect(normalizeGovernanceSectionParam('live-gate')).toBe('governance')
    expect(normalizeGovernanceSectionParam('unknown')).toBeNull()

    expect(isGovernanceSectionParam('live_gate')).toBe(true)
    expect(isGovernanceSectionParam('unknown')).toBe(false)
  })

  it('normalizes route payload and shapes canonical upstream payload', () => {
    const normalized = normalizeGovernanceRouteRequest({
      section: 'live_gate',
      body: {
        payload: {
          governance_config: {
            governance_enabled: 'false',
            decision_mode: 'warn',
            fallback: 'H2',
            live_gate: {
              thresholds: {
                fdr_q_max: '0.07',
              },
            },
            state_machine: {
              override_ttl_minutes: '15',
            },
          },
        },
      },
    })

    expect(normalized).not.toBeNull()
    expect(normalized).toMatchObject({
      section: 'governance',
      config: {
        schemaVersion: 'v1',
        enabled: false,
        mode: 'warn_only',
        fallbackConfigId: 'H2',
        liveGate: {
          enabled: true,
          releaseGateStatusAgeHoursMax: 24,
          requireComparabilityPass: true,
          requireProtocolHashMatch: true,
          requireChampionRegistryValid: true,
          requireStateReplayValid: true,
          metrics: {
            quoteAgeP95MsMax: 2000,
            decisionToSubmitP95MsMax: 800,
            decisionToFirstFillP95MsMax: 2500,
            fdrQMax: 0.07,
          },
        },
        runtime: {
          degradeToH0Enabled: true,
          pauseNewOpensOnHardFail: true,
          overrideTtlMinutes: 15,
        },
      },
      upstreamPayload: {
        schemaVersion: 'v1',
        enabled: false,
        mode: 'warn_only',
        fallbackConfigId: 'H2',
        liveGate: {
          enabled: true,
          releaseGateStatusAgeHoursMax: 24,
          requireComparabilityPass: true,
          requireProtocolHashMatch: true,
          requireChampionRegistryValid: true,
          requireStateReplayValid: true,
          metrics: {
            quoteAgeP95MsMax: 2000,
            decisionToSubmitP95MsMax: 800,
            decisionToFirstFillP95MsMax: 2500,
            fdrQMax: 0.07,
          },
        },
        runtime: {
          degradeToH0Enabled: true,
          pauseNewOpensOnHardFail: true,
          overrideTtlMinutes: 15,
        },
      },
    })
  })

  it('uses top-level governance body before generic envelope payload', () => {
    const payload = buildGovernanceRouteWritePayload({
      governance: {
        enabled: false,
        mode: 'warn',
        fallbackConfigId: 'TOP_LEVEL',
      },
      payload: {
        governance: {
          enabled: true,
          mode: 'hard_gate',
          fallbackConfigId: 'INNER_ENVELOPE',
        },
      },
    })

    expect(payload).toMatchObject({
      enabled: false,
      mode: 'warn_only',
      fallbackConfigId: 'TOP_LEVEL',
    })
  })
})
