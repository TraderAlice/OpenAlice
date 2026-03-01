type JsonRecord = Record<string, unknown>

export type GovernanceMode = 'hard_gate' | 'warn_only'
export type GovernanceSchemaVersion = 'v1'

export interface GovernanceLiveGateMetricThresholds {
  quoteAgeP95MsMax: number
  decisionToSubmitP95MsMax: number
  decisionToFirstFillP95MsMax: number
  fdrQMax: number
}

export interface GovernanceLiveGateConfig {
  enabled: boolean
  releaseGateStatusAgeHoursMax: number
  requireComparabilityPass: boolean
  requireProtocolHashMatch: boolean
  requireChampionRegistryValid: boolean
  requireStateReplayValid: boolean
  metrics: GovernanceLiveGateMetricThresholds
}

export interface GovernanceRuntimeSafetyConfig {
  degradeToH0Enabled: boolean
  pauseNewOpensOnHardFail: boolean
  overrideTtlMinutes: number
}

export interface GovernanceConfig {
  schemaVersion: GovernanceSchemaVersion
  enabled: boolean
  mode: GovernanceMode
  fallbackConfigId: string
  liveGate: GovernanceLiveGateConfig
  runtime: GovernanceRuntimeSafetyConfig
}

export const GOVERNANCE_CONFIG_DEFAULTS: GovernanceConfig = {
  schemaVersion: 'v1',
  enabled: true,
  mode: 'hard_gate',
  fallbackConfigId: 'H0',
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
      fdrQMax: 0.1,
    },
  },
  runtime: {
    degradeToH0Enabled: true,
    pauseNewOpensOnHardFail: true,
    overrideTtlMinutes: 60,
  },
}

const GOVERNANCE_SECTION_KEYS = [
  'governance',
  'governanceConfig',
  'governance_config',
] as const

const LIVE_GATE_KEYS = ['liveGate', 'live_gate', 'live-gate'] as const
const RUNTIME_KEYS = ['runtime', 'stateMachine', 'state_machine'] as const
const METRICS_KEYS = ['metrics', 'thresholds', 'limits'] as const

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickRecord(source: JsonRecord, keys: readonly string[]): JsonRecord | undefined {
  for (const key of keys) {
    const candidate = source[key]
    if (isRecord(candidate)) {
      return candidate
    }
  }
  return undefined
}

function pickValue(source: JsonRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key]
    }
  }
  return undefined
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
      return true
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
      return false
    }
  }
  return fallback
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function parseString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

function parseMode(value: unknown, fallback: GovernanceMode): GovernanceMode {
  if (typeof value !== 'string') {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'hard_gate' || normalized === 'hard-gate' || normalized === 'hardgate') {
    return 'hard_gate'
  }
  if (normalized === 'warn_only' || normalized === 'warn-only' || normalized === 'warning' || normalized === 'warn') {
    return 'warn_only'
  }
  return fallback
}

function parseSchemaVersion(value: unknown, fallback: GovernanceSchemaVersion): GovernanceSchemaVersion {
  if (typeof value !== 'string') {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  return normalized === 'v1' ? 'v1' : fallback
}

function pickGovernanceSource(input: unknown): JsonRecord | undefined {
  if (!isRecord(input)) {
    return undefined
  }

  const section = pickRecord(input, GOVERNANCE_SECTION_KEYS)
  if (section) {
    return section
  }

  // Also support direct section payloads posted by route handlers.
  if (pickRecord(input, LIVE_GATE_KEYS) || 'fallbackConfigId' in input || 'fallback_config_id' in input) {
    return input
  }

  return undefined
}

export function extractGovernanceConfigFromUpstream(input: unknown): GovernanceConfig {
  const defaults = GOVERNANCE_CONFIG_DEFAULTS
  const source = pickGovernanceSource(input) ?? {}
  const liveGateSource = pickRecord(source, LIVE_GATE_KEYS) ?? source
  const runtimeSource = pickRecord(source, RUNTIME_KEYS) ?? source
  const metricsSource = pickRecord(liveGateSource, METRICS_KEYS) ?? liveGateSource

  const schemaVersion = parseSchemaVersion(
    pickValue(source, ['schemaVersion', 'schema_version', 'version']),
    defaults.schemaVersion,
  )

  const enabled = parseBoolean(
    pickValue(source, ['enabled', 'governanceEnabled', 'governance_enabled']),
    defaults.enabled,
  )

  const mode = parseMode(
    pickValue(source, ['mode', 'decisionMode', 'decision_mode']),
    defaults.mode,
  )

  const fallbackConfigId = parseString(
    pickValue(source, ['fallbackConfigId', 'fallback_config_id', 'fallback']),
    defaults.fallbackConfigId,
  )

  const liveGate: GovernanceLiveGateConfig = {
    enabled: parseBoolean(
      pickValue(liveGateSource, ['enabled', 'liveGateEnabled', 'live_gate_enabled']),
      defaults.liveGate.enabled,
    ),
    releaseGateStatusAgeHoursMax: parseNumber(
      pickValue(liveGateSource, [
        'releaseGateStatusAgeHoursMax',
        'release_gate_status_age_hours_max',
        'releaseGateMaxAgeHours',
      ]),
      defaults.liveGate.releaseGateStatusAgeHoursMax,
    ),
    requireComparabilityPass: parseBoolean(
      pickValue(liveGateSource, ['requireComparabilityPass', 'require_comparability_pass']),
      defaults.liveGate.requireComparabilityPass,
    ),
    requireProtocolHashMatch: parseBoolean(
      pickValue(liveGateSource, ['requireProtocolHashMatch', 'require_protocol_hash_match']),
      defaults.liveGate.requireProtocolHashMatch,
    ),
    requireChampionRegistryValid: parseBoolean(
      pickValue(liveGateSource, ['requireChampionRegistryValid', 'require_champion_registry_valid']),
      defaults.liveGate.requireChampionRegistryValid,
    ),
    requireStateReplayValid: parseBoolean(
      pickValue(liveGateSource, ['requireStateReplayValid', 'require_state_replay_valid']),
      defaults.liveGate.requireStateReplayValid,
    ),
    metrics: {
      quoteAgeP95MsMax: parseNumber(
        pickValue(metricsSource, ['quoteAgeP95MsMax', 'quote_age_p95_ms_max']),
        defaults.liveGate.metrics.quoteAgeP95MsMax,
      ),
      decisionToSubmitP95MsMax: parseNumber(
        pickValue(metricsSource, ['decisionToSubmitP95MsMax', 'decision_to_submit_p95_ms_max']),
        defaults.liveGate.metrics.decisionToSubmitP95MsMax,
      ),
      decisionToFirstFillP95MsMax: parseNumber(
        pickValue(metricsSource, ['decisionToFirstFillP95MsMax', 'decision_to_first_fill_p95_ms_max']),
        defaults.liveGate.metrics.decisionToFirstFillP95MsMax,
      ),
      fdrQMax: parseNumber(
        pickValue(metricsSource, ['fdrQMax', 'fdr_q_max']),
        defaults.liveGate.metrics.fdrQMax,
      ),
    },
  }

  const runtime: GovernanceRuntimeSafetyConfig = {
    degradeToH0Enabled: parseBoolean(
      pickValue(runtimeSource, ['degradeToH0Enabled', 'degrade_to_h0_enabled']),
      defaults.runtime.degradeToH0Enabled,
    ),
    pauseNewOpensOnHardFail: parseBoolean(
      pickValue(runtimeSource, ['pauseNewOpensOnHardFail', 'pause_new_opens_on_hard_fail']),
      defaults.runtime.pauseNewOpensOnHardFail,
    ),
    overrideTtlMinutes: parseNumber(
      pickValue(runtimeSource, ['overrideTtlMinutes', 'override_ttl_minutes']),
      defaults.runtime.overrideTtlMinutes,
    ),
  }

  return {
    schemaVersion,
    enabled,
    mode,
    fallbackConfigId,
    liveGate,
    runtime,
  }
}

export function normalizeGovernanceConfig(input: unknown): GovernanceConfig {
  return extractGovernanceConfigFromUpstream(input)
}

export function toUpstreamGovernanceConfig(config: GovernanceConfig): JsonRecord {
  return {
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    mode: config.mode,
    fallbackConfigId: config.fallbackConfigId,
    liveGate: {
      enabled: config.liveGate.enabled,
      releaseGateStatusAgeHoursMax: config.liveGate.releaseGateStatusAgeHoursMax,
      requireComparabilityPass: config.liveGate.requireComparabilityPass,
      requireProtocolHashMatch: config.liveGate.requireProtocolHashMatch,
      requireChampionRegistryValid: config.liveGate.requireChampionRegistryValid,
      requireStateReplayValid: config.liveGate.requireStateReplayValid,
      metrics: {
        quoteAgeP95MsMax: config.liveGate.metrics.quoteAgeP95MsMax,
        decisionToSubmitP95MsMax: config.liveGate.metrics.decisionToSubmitP95MsMax,
        decisionToFirstFillP95MsMax: config.liveGate.metrics.decisionToFirstFillP95MsMax,
        fdrQMax: config.liveGate.metrics.fdrQMax,
      },
    },
    runtime: {
      degradeToH0Enabled: config.runtime.degradeToH0Enabled,
      pauseNewOpensOnHardFail: config.runtime.pauseNewOpensOnHardFail,
      overrideTtlMinutes: config.runtime.overrideTtlMinutes,
    },
  }
}
