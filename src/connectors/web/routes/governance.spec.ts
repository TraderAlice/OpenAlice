import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EngineContext } from '../../../core/types.js'
import { createGovernanceRoutes } from './governance.js'

interface GovernanceServiceMock {
  buildDecisionPacket: ReturnType<typeof vi.fn>
  validateDecisionPacket: ReturnType<typeof vi.fn>
  replayRuntimeState: ReturnType<typeof vi.fn>
  verifyFreezeManifest: ReturnType<typeof vi.fn>
  listReasonCodes: ReturnType<typeof vi.fn>
}

function createGovernanceServiceMock(): GovernanceServiceMock {
  return {
    buildDecisionPacket: vi.fn(),
    validateDecisionPacket: vi.fn(),
    replayRuntimeState: vi.fn(),
    verifyFreezeManifest: vi.fn(),
    listReasonCodes: vi.fn(),
  }
}

function buildContext(
  statusPath: string,
  governanceService: GovernanceServiceMock | undefined,
): EngineContext {
  return {
    config: {
      governance: {
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
      },
    },
    governance: governanceService as EngineContext['governance'],
  } as unknown as EngineContext
}

async function requestJson(
  app: ReturnType<typeof createGovernanceRoutes>,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  return app.request(`http://localhost${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('governance routes', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        await rm(dir, { recursive: true, force: true })
      }
    }
  })

  it('returns release gate status details in /status', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'openalice-gov-route-status-'))
    tempDirs.push(tempDir)
    const releaseGateStatusPath = resolve(tempDir, 'release_gate_status.json')
    await writeFile(
      releaseGateStatusPath,
      JSON.stringify(
        {
          generatedAt: '2026-03-01T00:00:00.000Z',
          expiresAt: '2026-03-02T00:00:00.000Z',
          allowPaperTrading: true,
          allowLiveTrading: false,
          reasonCodes: ['HARD_RELEASE_GATE_BLOCKED'],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )

    const mockService = createGovernanceServiceMock()
    const app = createGovernanceRoutes(buildContext(releaseGateStatusPath, mockService))
    const res = await requestJson(app, 'GET', '/status')
    const payload = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(payload.serviceAvailable).toBe(true)
    expect(payload.governance).toBeTruthy()
    expect(payload.releaseGate).toMatchObject({
      exists: true,
      allowPaperTrading: true,
      allowLiveTrading: false,
    })
  })

  it('maps /build to governance service and applies default packet dir', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'openalice-gov-route-build-'))
    tempDirs.push(tempDir)
    const releaseGateStatusPath = resolve(tempDir, 'release_gate_status.json')
    const mockService = createGovernanceServiceMock()
    mockService.buildDecisionPacket.mockResolvedValue({
      ok: true,
      packetDir: 'decision_packet',
      missingArtifacts: [],
      exitCode: 0,
    })

    const app = createGovernanceRoutes(buildContext(releaseGateStatusPath, mockService))
    const res = await requestJson(app, 'POST', '/build', {})
    expect(res.status).toBe(200)
    expect(mockService.buildDecisionPacket).toHaveBeenCalledTimes(1)

    const [input] = mockService.buildDecisionPacket.mock.calls[0]
    expect(input.outDir).toBe('decision_packet')
    expect(typeof input.campaignId).toBe('string')
    expect(input.campaignId.startsWith('manual-')).toBe(true)
  })

  it('returns 409 for policy failure from validate endpoint', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'openalice-gov-route-validate-'))
    tempDirs.push(tempDir)
    const releaseGateStatusPath = resolve(tempDir, 'release_gate_status.json')
    const mockService = createGovernanceServiceMock()
    mockService.validateDecisionPacket.mockResolvedValue({
      ok: false,
      verdict: 'NO_GO',
      reasonCodes: ['HARD_THRESHOLD_BREACH'],
      exitCode: 2,
    })

    const app = createGovernanceRoutes(buildContext(releaseGateStatusPath, mockService))
    const res = await requestJson(app, 'POST', '/validate', { packetDir: 'decision_packet' })
    const payload = await res.json() as Record<string, unknown>

    expect(res.status).toBe(409)
    expect(payload.verdict).toBe('NO_GO')
  })

  it('returns 501 when governance service is unavailable', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'openalice-gov-route-no-service-'))
    tempDirs.push(tempDir)
    const releaseGateStatusPath = resolve(tempDir, 'release_gate_status.json')
    const app = createGovernanceRoutes(buildContext(releaseGateStatusPath, undefined))

    const res = await requestJson(app, 'POST', '/build', {})
    expect(res.status).toBe(501)
  })
})

