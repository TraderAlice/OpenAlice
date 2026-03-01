import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'

function statusFromExitCode(ok: boolean, exitCode: number): number {
  if (ok) {
    return 200
  }
  if (exitCode === 2) {
    return 409
  }
  return 500
}

function parseIsoToMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** Governance routes: /status /build /validate /replay /verify-freeze /reason-codes */
export function createGovernanceRoutes(ctx: EngineContext) {
  const app = new Hono()

  app.get('/status', async (c) => {
    const releaseGatePath = resolve(ctx.config.governance.releaseGate.statusPath)
    const releaseGateStatus = await readJsonFile(releaseGatePath)
    const generatedAtMs = parseIsoToMs(releaseGateStatus?.generatedAt)
    const expiresAtMs = parseIsoToMs(releaseGateStatus?.expiresAt)
    const nowMs = Date.now()
    const ageHours = generatedAtMs === null ? null : (nowMs - generatedAtMs) / 3_600_000

    return c.json({
      serviceAvailable: !!ctx.governance,
      governance: ctx.config.governance,
      releaseGate: {
        path: releaseGatePath,
        exists: releaseGateStatus !== null,
        generatedAt: releaseGateStatus?.generatedAt ?? null,
        expiresAt: releaseGateStatus?.expiresAt ?? null,
        allowPaperTrading: releaseGateStatus?.allowPaperTrading ?? null,
        allowLiveTrading: releaseGateStatus?.allowLiveTrading ?? null,
        reasonCodes: Array.isArray(releaseGateStatus?.reasonCodes)
          ? releaseGateStatus?.reasonCodes
          : [],
        ageHours,
        isExpired: expiresAtMs === null ? null : nowMs > expiresAtMs,
      },
    })
  })

  app.post('/build', async (c) => {
    if (!ctx.governance) return c.json({ error: 'Governance service not available' }, 501)
    try {
      const body = await c.req.json<{
        campaignId?: string
        outDir?: string
        freezeManifestPath?: string
        allowMissingSoft?: boolean
      }>()
      const result = await ctx.governance.buildDecisionPacket({
        campaignId: body.campaignId ?? `manual-${new Date().toISOString()}`,
        outDir: body.outDir ?? 'decision_packet',
        freezeManifestPath: body.freezeManifestPath,
        allowMissingSoft: body.allowMissingSoft,
      })
      return c.json(result, statusFromExitCode(result.ok, result.exitCode))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/validate', async (c) => {
    if (!ctx.governance) return c.json({ error: 'Governance service not available' }, 501)
    try {
      const body = await c.req.json<{
        packetDir?: string
        thresholdsPath?: string
        freezeManifestPath?: string
      }>()
      const result = await ctx.governance.validateDecisionPacket({
        packetDir: body.packetDir ?? 'decision_packet',
        thresholdsPath: body.thresholdsPath,
        freezeManifestPath: body.freezeManifestPath,
      })
      return c.json(result, statusFromExitCode(result.ok, result.exitCode))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/replay', async (c) => {
    if (!ctx.governance) return c.json({ error: 'Governance service not available' }, 501)
    try {
      const body = await c.req.json<{
        stateLogPath?: string
        stateSpecVersion?: string
      }>()
      const result = await ctx.governance.replayRuntimeState({
        stateLogPath: body.stateLogPath ?? 'decision_packet/state_machine_log.jsonl',
        stateSpecVersion: body.stateSpecVersion,
      })
      return c.json(result, statusFromExitCode(result.ok, result.exitCode))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/verify-freeze', async (c) => {
    if (!ctx.governance) return c.json({ error: 'Governance service not available' }, 501)
    try {
      const body = await c.req.json<{
        manifestPath?: string
        schemaPath?: string
      }>()
      const result = await ctx.governance.verifyFreezeManifest({
        manifestPath: body.manifestPath ?? 'docs/research/freeze_manifest.json',
        schemaPath: body.schemaPath,
      })
      return c.json(result, statusFromExitCode(result.ok, result.exitCode))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/reason-codes', async (c) => {
    if (!ctx.governance) return c.json({ error: 'Governance service not available' }, 501)
    try {
      const codes = await ctx.governance.listReasonCodes()
      return c.json({ codes })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return app
}

