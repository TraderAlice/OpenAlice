import {
  extractGovernanceConfigFromUpstream,
  toUpstreamGovernanceConfig,
  type GovernanceConfig,
} from '../config/upstream-config-adapter.js'

type JsonRecord = Record<string, unknown>

export type GovernanceConfigRouteSection = 'governance'

export interface GovernanceRouteRequestInput {
  section?: string | null
  body: unknown
}

export interface NormalizedGovernanceRouteRequest {
  section: GovernanceConfigRouteSection
  config: GovernanceConfig
  upstreamPayload: JsonRecord
}

const GOVERNANCE_SECTION_KEYS = [
  'governance',
  'governanceConfig',
  'governance_config',
  'live-gate',
  'live_gate',
  'liveGate',
] as const

const GOVERNANCE_SECTION_TOKENS = new Set([
  'governance',
  'governanceconfig',
  'livegate',
])

const ROUTE_BODY_ENVELOPE_KEYS = [
  'payload',
  'config',
  'data',
  'value',
] as const

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSectionToken(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim().toLowerCase().replace(/[-_\s]/g, '')
}

function pickRoutePayload(body: unknown): unknown {
  if (!isRecord(body)) {
    return body
  }

  for (const key of GOVERNANCE_SECTION_KEYS) {
    const candidate = body[key]
    if (isRecord(candidate)) {
      return candidate
    }
  }

  for (const key of ROUTE_BODY_ENVELOPE_KEYS) {
    const candidate = body[key]
    if (isRecord(candidate)) {
      return candidate
    }
  }

  return body
}

export function normalizeGovernanceSectionParam(section: string | null | undefined): GovernanceConfigRouteSection | null {
  const token = normalizeSectionToken(section)
  if (token.length === 0) {
    return null
  }
  return GOVERNANCE_SECTION_TOKENS.has(token) ? 'governance' : null
}

export function isGovernanceSectionParam(section: string | null | undefined): boolean {
  return normalizeGovernanceSectionParam(section) !== null
}

export function extractGovernanceConfigFromRouteBody(body: unknown): GovernanceConfig {
  return extractGovernanceConfigFromUpstream(pickRoutePayload(body))
}

export function buildGovernanceRouteWritePayload(body: unknown): JsonRecord {
  const config = extractGovernanceConfigFromRouteBody(body)
  return toUpstreamGovernanceConfig(config)
}

export function normalizeGovernanceRouteRequest(
  input: GovernanceRouteRequestInput,
): NormalizedGovernanceRouteRequest | null {
  const section = normalizeGovernanceSectionParam(input.section)
  if (section === null) {
    return null
  }

  const config = extractGovernanceConfigFromRouteBody(input.body)
  return {
    section,
    config,
    upstreamPayload: toUpstreamGovernanceConfig(config),
  }
}
