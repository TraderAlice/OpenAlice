import { describe, expect, it } from 'vitest'
import {
  extractGovernanceConfigFromUpstream,
  GOVERNANCE_CONFIG_DEFAULTS,
  normalizeGovernanceConfig,
} from '../config/upstream-config-adapter.js'

describe('upstream config adapter contract', () => {
  it('extracts canonical defaults when upstream governance payload is missing', () => {
    expect(extractGovernanceConfigFromUpstream(undefined)).toEqual(GOVERNANCE_CONFIG_DEFAULTS)
    expect(normalizeGovernanceConfig({})).toEqual(GOVERNANCE_CONFIG_DEFAULTS)
  })

  it('normalizes aliases and scalar types from upstream governance section', () => {
    const normalized = extractGovernanceConfigFromUpstream({
      governance_config: {
        schema_version: 'V1',
        governance_enabled: 'no',
        decision_mode: 'warn-only',
        fallback_config_id: '  H1  ',
        live_gate: {
          live_gate_enabled: '1',
          release_gate_status_age_hours_max: '36',
          require_comparability_pass: 'false',
          require_protocol_hash_match: 0,
          require_champion_registry_valid: 'yes',
          require_state_replay_valid: 1,
          thresholds: {
            quote_age_p95_ms_max: '2100',
            decision_to_submit_p95_ms_max: '900',
            decision_to_first_fill_p95_ms_max: '2600',
            fdr_q_max: '0.2',
          },
        },
        state_machine: {
          degrade_to_h0_enabled: 0,
          pause_new_opens_on_hard_fail: 'off',
          override_ttl_minutes: '45',
        },
      },
    })

    expect(normalized).toEqual({
      schemaVersion: 'v1',
      enabled: false,
      mode: 'warn_only',
      fallbackConfigId: 'H1',
      liveGate: {
        enabled: true,
        releaseGateStatusAgeHoursMax: 36,
        requireComparabilityPass: false,
        requireProtocolHashMatch: false,
        requireChampionRegistryValid: true,
        requireStateReplayValid: true,
        metrics: {
          quoteAgeP95MsMax: 2100,
          decisionToSubmitP95MsMax: 900,
          decisionToFirstFillP95MsMax: 2600,
          fdrQMax: 0.2,
        },
      },
      runtime: {
        degradeToH0Enabled: false,
        pauseNewOpensOnHardFail: false,
        overrideTtlMinutes: 45,
      },
    })
  })

  it('uses defaults for invalid direct-section values', () => {
    const normalized = extractGovernanceConfigFromUpstream({
      mode: 'unsupported-mode',
      liveGate: {
        metrics: {
          quoteAgeP95MsMax: 'not-a-number',
        },
      },
      runtime: {
        overrideTtlMinutes: 'NaN',
      },
    })

    expect(normalized.mode).toBe(GOVERNANCE_CONFIG_DEFAULTS.mode)
    expect(normalized.liveGate.metrics.quoteAgeP95MsMax).toBe(
      GOVERNANCE_CONFIG_DEFAULTS.liveGate.metrics.quoteAgeP95MsMax,
    )
    expect(normalized.runtime.overrideTtlMinutes).toBe(
      GOVERNANCE_CONFIG_DEFAULTS.runtime.overrideTtlMinutes,
    )
  })
})
