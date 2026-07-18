import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'

import { buildCliPath } from '../../../workspaces/spawn-env.js'
import { ThemeContrastError } from '../colors.js'
import {
  THEME_MAPPING_VERSION,
  themeFamilySchema,
  type ThemeFamily,
  type ThemeVariant,
  type ThemeVariantMode,
} from '../types.js'
import {
  revalidateGeneratorDetection,
  ThemeGeneratorDetectionManager,
  type GeneratorDetection,
  type ThemeGeneratorId,
} from './detection.js'
import {
  parseHellwalOutput,
  parseMatugenOutput,
  ThemeGeneratorOutputError,
} from './mapping.js'
import { createControlledStage, runManagedProcess, type ControlledStage } from './process.js'

const modesSchema = z.union([
  z.tuple([z.literal('light')]),
  z.tuple([z.literal('dark')]),
  z.tuple([z.literal('light'), z.literal('dark')]),
])

const requestBase = {
  detectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(128),
  modes: modesSchema,
} as const

export const themeGenerationRequestSchema = z.discriminatedUnion('generator', [
  z.object({
    ...requestBase,
    generator: z.literal('matugen'),
    scheme: z.string().trim().min(1).max(128).regex(/^[a-z][a-z-]*$/),
  }).strict(),
  z.object({
    ...requestBase,
    generator: z.literal('hellwal'),
    darkOffset: z.number().finite().min(0).max(1),
    brightOffset: z.number().finite().min(0).max(1),
  }).strict(),
])
export type ThemeGenerationRequest = z.infer<typeof themeGenerationRequestSchema>

export type ThemeGenerationErrorCode =
  | 'generator_unavailable'
  | 'generator_unsupported'
  | 'detection_stale'
  | 'invalid_parameters'
  | 'spawn_failed'
  | 'cancelled'
  | 'non_zero_exit'
  | 'invalid_output'
  | 'contrast_failed'
  | 'staging_cleanup_failed'

export class ThemeGenerationError extends Error {
  constructor(
    readonly code: ThemeGenerationErrorCode,
    readonly generator: ThemeGeneratorId,
    readonly diagnostics: readonly string[],
    readonly process?: { readonly exitCode: number | null; readonly signal: NodeJS.Signals | null },
  ) {
    super(`${code}: ${diagnostics.join('; ')}`)
    this.name = 'ThemeGenerationError'
  }
}

type AvailableDetection = Extract<GeneratorDetection, { kind: 'available' }>

export interface ThemeGeneratorServiceOptions {
  readonly manager?: ThemeGeneratorDetectionManager
  readonly env?: NodeJS.ProcessEnv
  readonly now?: () => Date
  readonly createStage?: () => Promise<ControlledStage>
}

/** Owns generator detection snapshots and preview-only generation lifecycle. */
export class ThemeGeneratorService {
  readonly manager: ThemeGeneratorDetectionManager
  readonly #env: NodeJS.ProcessEnv
  readonly #now: () => Date
  readonly #createStage: () => Promise<ControlledStage>

  constructor(options: ThemeGeneratorServiceOptions = {}) {
    this.manager = options.manager ?? new ThemeGeneratorDetectionManager()
    this.#env = options.env ?? process.env
    this.#now = options.now ?? (() => new Date())
    this.#createStage = options.createStage ?? (() => createControlledStage())
  }

  async availability(refresh = false) {
    if (refresh || this.manager.snapshot === null) return this.manager.refresh(this.#env)
    return this.manager.snapshot
  }

  async preview(
    untrustedRequest: unknown,
    image: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ThemeFamily> {
    const parsed = themeGenerationRequestSchema.safeParse(untrustedRequest)
    const generator = generatorFromUnknown(untrustedRequest)
    if (!parsed.success) {
      throw new ThemeGenerationError('invalid_parameters', generator, parsed.error.issues.map((issue) => (
        `${issue.path.join('.') || 'request'}: ${issue.message}`
      )))
    }
    const request = parsed.data
    if (image.byteLength === 0) {
      throw new ThemeGenerationError('invalid_parameters', request.generator, ['image: empty upload'])
    }

    const detection = await this.#selectedDetection(request.generator, request.detectionId)
    const validation = await revalidateGeneratorDetection(detection, this.#env)
    if (validation.kind !== 'valid') {
      throw new ThemeGenerationError('detection_stale', request.generator, [validation.reason])
    }
    if (request.generator === 'matugen') {
      const capabilities = detection.capabilities
      if (capabilities.kind !== 'matugen' || !capabilities.schemes.includes(request.scheme)) {
        throw new ThemeGenerationError('invalid_parameters', request.generator, [`scheme: unsupported ${request.scheme}`])
      }
    }

    const imageSha256 = createHash('sha256').update(image).digest('hex')
    const familyId = generatedFamilyId(request, imageSha256)
    const timestamp = this.#now().toISOString()
    const stage = await this.#createStage()
    let primaryFailure: unknown
    try {
      const imagePath = stage.path('input-image')
      await writeFile(imagePath, image, { mode: 0o600, flag: 'wx' })
      const variants: Partial<Record<ThemeVariantMode, ThemeVariant>> = {}
      for (const mode of request.modes) {
        const stdoutPath = stage.path(`${mode}.stdout.json`)
        const stderrPath = stage.path(`${mode}.stderr.log`)
        const result = await runManagedProcess({
          executablePath: detection.executablePath,
          argv: generationArgv(request, mode, imagePath),
          cwd: stage.directory,
          stdoutPath,
          stderrPath,
          env: { ...this.#env, PATH: buildCliPath(this.#env) },
          signal,
        })
        if (result.kind === 'cancelled') {
          throw new ThemeGenerationError('cancelled', request.generator, ['generation cancelled'], result)
        }
        if (result.kind === 'spawn-failed') {
          throw new ThemeGenerationError('spawn_failed', request.generator, [result.code ?? 'spawn failed', result.message])
        }
        if (result.kind === 'nonzero') {
          throw new ThemeGenerationError('non_zero_exit', request.generator, [
            sanitizeDiagnostic(await readFile(stderrPath, 'utf8')),
          ], result)
        }

        const raw = await readFile(stdoutPath, 'utf8')
        try {
          const mapped = request.generator === 'matugen'
            ? parseMatugenOutput(raw, mode)
            : parseHellwalOutput(raw)
          variants[mode] = {
            id: `${familyId}-${mode}`,
            name: `${request.name} (${mode})`,
            mode,
            ...mapped,
            provenance: request.generator === 'matugen' ? {
              kind: 'generated', generator: 'matugen', mappingVersion: THEME_MAPPING_VERSION,
              executablePath: detection.executablePath, executableVersion: detection.version,
              imageSha256, parameters: { mode, scheme: request.scheme }, generatedAt: timestamp,
            } : {
              kind: 'generated', generator: 'hellwal', mappingVersion: THEME_MAPPING_VERSION,
              executablePath: detection.executablePath, executableVersion: detection.version,
              imageSha256,
              parameters: { mode, darkOffset: request.darkOffset, brightOffset: request.brightOffset },
              generatedAt: timestamp,
            },
            createdAt: timestamp,
          }
        } catch (error) {
          const contrastError = findContrastError(error)
          if (contrastError !== null) {
            throw new ThemeGenerationError('contrast_failed', request.generator, [contrastError.message])
          }
          if (error instanceof ThemeGeneratorOutputError) {
            throw new ThemeGenerationError('invalid_output', request.generator, [error.message])
          }
          throw error
        }
      }
      const family = themeFamilySchema.parse({ schemaVersion: 1, id: familyId, name: request.name, variants })
      return family
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      try {
        await stage.cleanup()
      } catch (error) {
        const diagnostics = [`cleanup: ${String(error)}`]
        if (primaryFailure !== undefined) diagnostics.push(`generation: ${String(primaryFailure)}`)
        throw new ThemeGenerationError(
          'staging_cleanup_failed',
          request.generator,
          diagnostics,
          primaryFailure instanceof ThemeGenerationError ? primaryFailure.process : undefined,
        )
      }
    }
  }

  async #selectedDetection(generator: ThemeGeneratorId, detectionId: string): Promise<AvailableDetection> {
    const snapshot = await this.availability()
    const selected = snapshot.generators[generator]
    if (selected.kind === 'unavailable') {
      throw new ThemeGenerationError('generator_unavailable', generator, [selected.reason])
    }
    if (selected.kind === 'unsupported') {
      throw new ThemeGenerationError('generator_unsupported', generator, [selected.reason])
    }
    if (selected.detectionId !== detectionId) {
      throw new ThemeGenerationError('detection_stale', generator, ['detection id no longer matches current snapshot'])
    }
    return selected
  }
}

function generationArgv(
  request: ThemeGenerationRequest,
  mode: ThemeVariantMode,
  imagePath: string,
): readonly string[] {
  if (request.generator === 'matugen') {
    return [
      'image', imagePath, '--type', `scheme-${request.scheme}`, '--mode', mode,
      '--dry-run', '--json', 'hex', '--source-color-index', '0',
      '--include-image-in-json', 'false',
    ]
  }
  return [
    '--image', imagePath, mode === 'light' ? '--light' : '--dark',
    '--dark-offset', canonicalNumber(request.darkOffset),
    '--bright-offset', canonicalNumber(request.brightOffset),
    '--json', '--no-cache', '--skip-term-colors',
  ]
}

function generatedFamilyId(request: ThemeGenerationRequest, imageSha256: string): string {
  const parameters = request.generator === 'matugen'
    ? { generator: request.generator, scheme: request.scheme }
    : { generator: request.generator, darkOffset: request.darkOffset, brightOffset: request.brightOffset }
  const identity = createHash('sha256').update(JSON.stringify({
    imageSha256, parameters, mappingVersion: THEME_MAPPING_VERSION,
  })).digest('hex').slice(0, 24)
  return `generated-${request.generator}-${identity}`
}

function canonicalNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value)
}

function findContrastError(error: unknown): ThemeContrastError | null {
  let current: unknown = error
  const visited = new Set<unknown>()
  while (current instanceof Error && !visited.has(current)) {
    if (current instanceof ThemeContrastError) return current
    visited.add(current)
    current = current.cause
  }
  return null
}

function generatorFromUnknown(value: unknown): ThemeGeneratorId {
  if (typeof value === 'object' && value !== null && (value as { generator?: unknown }).generator === 'hellwal') {
    return 'hellwal'
  }
  return 'matugen'
}

function sanitizeDiagnostic(raw: string): string {
  const withoutAnsi = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  return withoutAnsi.trim().slice(0, 2_000) || 'generator exited without diagnostics'
}
