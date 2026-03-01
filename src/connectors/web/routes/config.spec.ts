import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadConfig = vi.fn()
const mockWriteConfigSection = vi.fn()
const mockReadAIProviderConfig = vi.fn()
const mockReadOpenbbConfig = vi.fn()

vi.mock('../../../core/config.js', () => ({
  loadConfig: mockLoadConfig,
  writeConfigSection: mockWriteConfigSection,
  readAIProviderConfig: mockReadAIProviderConfig,
  readOpenbbConfig: mockReadOpenbbConfig,
  validSections: [
    'engine',
    'agent',
    'crypto',
    'securities',
    'openbb',
    'compaction',
    'aiProvider',
    'heartbeat',
    'connectors',
    'newsCollector',
    'governance',
  ],
}))

vi.mock('../../../core/ai-config.js', () => ({
  readAIConfig: vi.fn(),
  writeAIConfig: vi.fn(),
}))

const { createConfigRoutes } = await import('./config.js')

const BASE_GOVERNANCE = {
  enabled: true,
  fallbackConfigId: 'H0',
  releaseGate: {
    enabled: true,
    statusPath: 'data/runtime/release_gate_status.json',
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

async function putJson(path: string, body: Record<string, unknown>): Promise<Response> {
  const app = createConfigRoutes()
  return app.request(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('config routes governance alias mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteConfigSection.mockImplementation(async (_section: string, data: unknown) => data)
    mockReadAIProviderConfig.mockResolvedValue({ apiKeys: {} })
    mockReadOpenbbConfig.mockResolvedValue({ apiUrl: 'http://localhost:6900' })
    mockLoadConfig.mockResolvedValue({ governance: BASE_GOVERNANCE })
  })

  it('maps governance alias section to canonical governance payload', async () => {
    const response = await putJson('/live_gate', {
      payload: {
        governance_config: {
          governance_enabled: false,
          fallback: 'H2',
          live_gate: {
            release_gate_status_age_hours_max: 12,
            thresholds: {
              quote_age_p95_ms_max: 1500,
              decision_to_submit_p95_ms_max: 700,
              decision_to_first_fill_p95_ms_max: 1700,
              fdr_q_max: 0.07,
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockLoadConfig).toHaveBeenCalledTimes(1)
    expect(mockWriteConfigSection).toHaveBeenCalledTimes(1)

    const [section, payload] = mockWriteConfigSection.mock.calls[0]
    expect(section).toBe('governance')
    expect(payload).toMatchObject({
      enabled: false,
      fallbackConfigId: 'H2',
      releaseGate: {
        enabled: true,
        maxStatusAgeHours: 12,
        blockOnExpired: true,
      },
      liveGate: {
        enabled: true,
        quoteAgeP95MsMax: 1500,
        decisionToSubmitP95MsMax: 700,
        decisionToFirstFillP95MsMax: 1700,
      },
      statsGate: {
        fdrQMax: 0.07,
      },
    })
  })

  it('keeps canonical governance section write path unchanged', async () => {
    const canonicalPayload = {
      ...BASE_GOVERNANCE,
      enabled: false,
      fallbackConfigId: 'H3',
      releaseGate: {
        ...BASE_GOVERNANCE.releaseGate,
        maxStatusAgeHours: 8,
      },
    }

    const response = await putJson('/governance', canonicalPayload)
    expect(response.status).toBe(200)
    expect(mockLoadConfig).not.toHaveBeenCalled()
    expect(mockWriteConfigSection).toHaveBeenCalledWith('governance', canonicalPayload)
  })
})

