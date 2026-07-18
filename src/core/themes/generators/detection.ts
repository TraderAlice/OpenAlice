import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { buildCliPath } from '../../../workspaces/spawn-env.js'
import { createControlledStage, runManagedProcess } from './process.js'

export type ThemeGeneratorId = 'matugen' | 'hellwal'

const MATUGEN_TARGET_SCHEMES = [
  'scheme-content', 'scheme-expressive', 'scheme-fidelity', 'scheme-fruit-salad',
  'scheme-monochrome', 'scheme-neutral', 'scheme-rainbow', 'scheme-tonal-spot',
  'scheme-vibrant', 'scheme-smart',
] as const

export interface MatugenCapabilities {
  readonly kind: 'matugen'
  readonly dryRunJson: true
  readonly modes: readonly ['light', 'dark']
  readonly schemes: readonly string[]
}

export interface HellwalCapabilities {
  readonly kind: 'hellwal'
  readonly json: true
  readonly noCache: true
  readonly skipTermColors: true
  readonly modes: readonly ['light', 'dark']
  readonly offsets: readonly ['dark', 'bright']
}

export type GeneratorCapabilities = MatugenCapabilities | HellwalCapabilities

export type GeneratorDetection =
  | { readonly kind: 'unavailable'; readonly generator: ThemeGeneratorId; readonly reason: 'not-on-path' }
  | { readonly kind: 'unsupported'; readonly generator: ThemeGeneratorId; readonly executablePath: string; readonly reason: string }
  | {
      readonly kind: 'available'
      readonly generator: ThemeGeneratorId
      readonly detectionId: string
      readonly executablePath: string
      readonly version: string
      readonly binarySha256: string
      readonly capabilities: GeneratorCapabilities
    }

export interface GeneratorDetectionSnapshot {
  readonly refreshedAt: string
  readonly generators: Readonly<Record<ThemeGeneratorId, GeneratorDetection>>
}

function executableCandidates(name: string): readonly string[] {
  if (process.platform !== 'win32') return [name]
  const extensions = (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';')
  return [name, ...extensions.map((extension) => `${name}${extension.toLowerCase()}`)]
}

export async function resolveFirstExecutable(name: ThemeGeneratorId, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const cliPath = buildCliPath(env)
  for (const directory of cliPath.split(delimiter)) {
    if (!directory) continue
    for (const candidate of executableCandidates(name)) {
      const path = join(directory, candidate)
      try {
        await access(path, constants.X_OK)
        const resolved = await realpath(path)
        if (isAbsolute(resolved)) return resolved
      } catch { /* this PATH entry is not an executable match */ }
    }
  }
  return null
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

interface ProbeResult {
  readonly kind: 'ok' | 'failed'
  readonly output: string
}

async function probe(executablePath: string, argv: readonly string[], env: NodeJS.ProcessEnv): Promise<ProbeResult> {
  const stage = await createControlledStage('openalice-generator-probe-')
  try {
    const stdoutPath = stage.path('stdout')
    const stderrPath = stage.path('stderr')
    const probeEnv: NodeJS.ProcessEnv = { ...env, PATH: buildCliPath(env) }
    delete probeEnv['Path']
    const result = await runManagedProcess({ executablePath, argv, cwd: stage.directory, stdoutPath, stderrPath, env: probeEnv })
    const output = `${await readFile(stdoutPath, 'utf8')}\n${await readFile(stderrPath, 'utf8')}`.trim()
    return { kind: result.kind === 'succeeded' ? 'ok' : 'failed', output }
  } finally {
    await stage.cleanup()
  }
}

function includesFlag(help: string, flag: string): boolean {
  return new RegExp(`(^|[\\s,])${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s,=<]|$)`, 'm').test(help)
}

/** Parse clap-style possible-values wherever the installed binary prints it. */
export function parseMatugenSchemes(help: string): readonly string[] {
  const exposed = new Set<string>()
  for (const match of help.matchAll(/scheme-[a-z][a-z-]*/g)) exposed.add(match[0])
  return MATUGEN_TARGET_SCHEMES.filter((scheme) => exposed.has(scheme)).map((scheme) => scheme.slice('scheme-'.length))
}

function firstVersionLine(output: string): string | null {
  const line = output.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean)
  return line && /\d/.test(line) ? line : null
}

export async function detectThemeGenerator(generator: ThemeGeneratorId, env: NodeJS.ProcessEnv = process.env): Promise<GeneratorDetection> {
  const executablePath = await resolveFirstExecutable(generator, env)
  if (executablePath === null) return { kind: 'unavailable', generator, reason: 'not-on-path' }

  const versionProbe = await probe(executablePath, ['--version'], env)
  const helpProbe = await probe(executablePath, ['--help'], env)
  const version = versionProbe.kind === 'ok' ? firstVersionLine(versionProbe.output) : null
  if (version === null) return { kind: 'unsupported', generator, executablePath, reason: 'version probe failed or returned no recognizable version' }
  if (helpProbe.kind !== 'ok') return { kind: 'unsupported', generator, executablePath, reason: 'help probe failed' }

  let capabilities: GeneratorCapabilities
  if (generator === 'matugen') {
    const imageHelp = await probe(executablePath, ['image', '--help'], env)
    if (imageHelp.kind !== 'ok') return { kind: 'unsupported', generator, executablePath, reason: 'image help probe failed' }
    const help = imageHelp.output
    const schemes = parseMatugenSchemes(help)
    const missing = ['--dry-run', '--json', '--mode', '--type', '--source-color-index', '--include-image-in-json']
      .filter((flag) => !includesFlag(help, flag))
    if (!/(^|[\s,])light(?=[\s,\]]|$)/m.test(help) || !/(^|[\s,])dark(?=[\s,\]]|$)/m.test(help)) {
      missing.push('light/dark mode values')
    }
    if (missing.length > 0 || schemes.length === 0) {
      return { kind: 'unsupported', generator, executablePath, reason: `missing required image capability: ${[...missing, ...(schemes.length === 0 ? ['supported scheme values'] : [])].join(', ')}` }
    }
    capabilities = { kind: 'matugen', dryRunJson: true, modes: ['light', 'dark'], schemes }
  } else {
    const missing = ['--json', '--no-cache', '--skip-term-colors', '--dark', '--light', '--dark-offset', '--bright-offset']
      .filter((flag) => !includesFlag(helpProbe.output, flag))
    if (missing.length > 0) return { kind: 'unsupported', generator, executablePath, reason: `missing required capability: ${missing.join(', ')}` }
    capabilities = { kind: 'hellwal', json: true, noCache: true, skipTermColors: true, modes: ['light', 'dark'], offsets: ['dark', 'bright'] }
  }

  return {
    kind: 'available', generator, detectionId: randomUUID(), executablePath, version,
    binarySha256: await sha256File(executablePath), capabilities,
  }
}

export type DetectionRevalidation =
  | { readonly kind: 'valid'; readonly detection: Extract<GeneratorDetection, { kind: 'available' }> }
  | { readonly kind: 'changed'; readonly reason: 'missing' | 'path-changed' | 'digest-changed' }

/** Revalidate the exact selected binary; never silently switch to another PATH match. */
export async function revalidateGeneratorDetection(
  detection: Extract<GeneratorDetection, { kind: 'available' }>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DetectionRevalidation> {
  try {
    await access(detection.executablePath, constants.X_OK)
  } catch {
    return { kind: 'changed', reason: 'missing' }
  }
  const currentPath = await resolveFirstExecutable(detection.generator, env)
  if (currentPath !== detection.executablePath) return { kind: 'changed', reason: 'path-changed' }
  const digest = await sha256File(detection.executablePath)
  return digest === detection.binarySha256 ? { kind: 'valid', detection } : { kind: 'changed', reason: 'digest-changed' }
}

export class ThemeGeneratorDetectionManager {
  #snapshot: GeneratorDetectionSnapshot | null = null

  get snapshot(): GeneratorDetectionSnapshot | null { return this.#snapshot }

  async refresh(env: NodeJS.ProcessEnv = process.env): Promise<GeneratorDetectionSnapshot> {
    const [matugen, hellwal] = await Promise.all([
      detectThemeGenerator('matugen', env), detectThemeGenerator('hellwal', env),
    ])
    this.#snapshot = { refreshedAt: new Date().toISOString(), generators: { matugen, hellwal } }
    return this.#snapshot
  }
}
