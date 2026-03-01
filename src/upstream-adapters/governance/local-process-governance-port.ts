import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  GovernanceBuildDecisionPacketInput,
  GovernanceBuildDecisionPacketResult,
  GovernancePort,
  GovernanceReasonCode,
  GovernanceReplayRuntimeStateInput,
  GovernanceReplayRuntimeStateResult,
  GovernanceValidateDecisionPacketInput,
  GovernanceValidateDecisionPacketResult,
  GovernanceVerifyFreezeManifestInput,
  GovernanceVerifyFreezeManifestResult,
  GovernanceVerdict,
} from '../../core/ports/governance-port.js'

interface LocalProcessGovernancePortOptions {
  repoRoot?: string
  reasonCodesPath?: string
}

interface ScriptExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

async function readJson(path: string): Promise<JsonRecord | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function resolveGovernanceVerdict(value: unknown): GovernanceVerdict {
  if (value === 'GO' || value === 'GO_WITH_CONSTRAINTS' || value === 'NO_GO') {
    return value
  }
  return 'NO_GO'
}

export class LocalProcessGovernancePort implements GovernancePort {
  private readonly repoRoot: string
  private readonly reasonCodesPath: string

  constructor(options: LocalProcessGovernancePortOptions = {}) {
    this.repoRoot = resolve(options.repoRoot ?? '.')
    this.reasonCodesPath = resolve(
      this.repoRoot,
      options.reasonCodesPath ?? 'docs/research/templates/verdict_reason_codes.v1.json',
    )
  }

  async buildDecisionPacket(
    input: GovernanceBuildDecisionPacketInput,
  ): Promise<GovernanceBuildDecisionPacketResult> {
    const packetDir = resolve(this.repoRoot, input.outDir)
    const exec = await this.runScript('scripts/build_decision_packet.py', [
      '--output-dir',
      packetDir,
    ])

    const manifest = await readJson(resolve(packetDir, 'manifest.json'))
    const missingArtifacts = asStringArray(manifest?.missing)

    return {
      ok: exec.exitCode === 0,
      packetDir,
      missingArtifacts,
      exitCode: exec.exitCode,
    }
  }

  async validateDecisionPacket(
    input: GovernanceValidateDecisionPacketInput,
  ): Promise<GovernanceValidateDecisionPacketResult> {
    const packetDir = resolve(this.repoRoot, input.packetDir)
    const verdictPath = resolve(packetDir, 'verdict.json')
    const args = ['--packet-dir', packetDir, '--output', verdictPath]
    if (input.freezeManifestPath) {
      args.push('--freeze-manifest', resolve(this.repoRoot, input.freezeManifestPath))
    }

    const exec = await this.runScript('scripts/validate_decision_packet.py', args)
    const verdictPayload = await readJson(verdictPath)
    const reasonCodeSection = isRecord(verdictPayload?.reasonCodes)
      ? verdictPayload.reasonCodes
      : {}

    return {
      ok: exec.exitCode === 0,
      verdict: resolveGovernanceVerdict(verdictPayload?.verdict),
      reasonCodes: asStringArray(isRecord(reasonCodeSection) ? reasonCodeSection.all : undefined),
      exitCode: exec.exitCode,
    }
  }

  async replayRuntimeState(
    input: GovernanceReplayRuntimeStateInput,
  ): Promise<GovernanceReplayRuntimeStateResult> {
    const outputPath = resolve(this.repoRoot, 'data/runtime/replay_runtime_report.json')
    const exec = await this.runScript('scripts/replay_runtime_state.py', [
      '--log-file',
      resolve(this.repoRoot, input.stateLogPath),
      '--output',
      outputPath,
    ])

    const replayPayload = await readJson(outputPath)
    return {
      ok: exec.exitCode === 0,
      deterministic: replayPayload?.valid === true,
      violations: asStringArray(replayPayload?.errors),
      exitCode: exec.exitCode,
    }
  }

  async verifyFreezeManifest(
    input: GovernanceVerifyFreezeManifestInput,
  ): Promise<GovernanceVerifyFreezeManifestResult> {
    const outputPath = resolve(this.repoRoot, 'data/runtime/freeze_manifest_verify_report.json')
    const args = [
      '--manifest',
      resolve(this.repoRoot, input.manifestPath),
      '--output',
      outputPath,
    ]
    if (input.schemaPath) {
      args.push('--schema', resolve(this.repoRoot, input.schemaPath))
    }

    const exec = await this.runScript('scripts/verify_freeze_manifest.py', args)
    const report = await readJson(outputPath)
    const issues = [
      ...asStringArray(report?.failures),
      ...asStringArray(report?.schemaValidationErrors),
    ]

    return {
      ok: exec.exitCode === 0,
      issues,
      exitCode: exec.exitCode,
    }
  }

  async listReasonCodes(): Promise<GovernanceReasonCode[]> {
    const payload = await readJson(this.reasonCodesPath)
    const codes = Array.isArray(payload?.codes) ? payload.codes : []

    return codes.flatMap((entry): GovernanceReasonCode[] => {
      if (!isRecord(entry) || typeof entry.code !== 'string') {
        return []
      }
      const severityRaw = typeof entry.severity === 'string' ? entry.severity.trim().toUpperCase() : ''
      const severity: GovernanceReasonCode['severity'] = severityRaw === 'HARD' ? 'hard' : 'soft'
      const description = typeof entry.descriptionEn === 'string'
        ? entry.descriptionEn
        : typeof entry.descriptionZh === 'string'
          ? entry.descriptionZh
          : undefined
      return [{ code: entry.code, severity, description }]
    })
  }

  private async runScript(scriptPath: string, args: string[]): Promise<ScriptExecResult> {
    return new Promise((resolvePromise) => {
      const child = spawn(
        'node',
        ['--import', 'tsx', 'scripts/python_fallback.ts', scriptPath, ...args],
        {
          cwd: this.repoRoot,
          env: process.env,
        },
      )

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (err) => {
        resolvePromise({
          exitCode: 3,
          stdout,
          stderr: `${stderr}\n${err.message}`.trim(),
        })
      })
      child.on('close', (code) => {
        resolvePromise({
          exitCode: typeof code === 'number' ? code : 3,
          stdout,
          stderr,
        })
      })
    })
  }
}

export function createLocalProcessGovernancePort(
  options: LocalProcessGovernancePortOptions = {},
): GovernancePort {
  return new LocalProcessGovernancePort(options)
}
