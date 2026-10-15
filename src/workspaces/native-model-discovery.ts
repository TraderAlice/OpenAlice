/** Native CLI directories: no prompts, Vault injection, or auth-file parsing. */
import { StringDecoder } from 'node:string_decoder'
import { spawn } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import { z } from 'zod'
import { terminateProcessTree } from '@traderalice/guardian-runtime'
import { detectAgentBinary } from './agent-detect.js'
import { buildSpawnEnv } from './spawn-env.js'
import { resolveLaunchCommand } from './win-command.js'
import { runtimeProfileFromEnv } from '../core/runtime-profile.js'
import { discoveredModelSchema, type DiscoveredModel } from '../ai-providers/discovered-model.js'
import { MODEL_REASONING_EFFORTS, type ModelReasoningEffort } from '../ai-providers/model-semantics.js'

const object = z.record(z.string(), z.unknown())
const row = z.object({ id: z.string().min(1), name: z.string().optional(), provider: z.string().optional() }).passthrough()
const efforts = (value: unknown): ModelReasoningEffort[] | undefined => Array.isArray(value)
  ? [...new Set(value.map((v) => v === 'off' ? 'none' : v).filter((v): v is ModelReasoningEffort => MODEL_REASONING_EFFORTS.includes(v as ModelReasoningEffort)))] : undefined
const positive = (v: unknown): number | undefined => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined
const bool = (v: unknown): boolean | undefined => typeof v === 'boolean' ? v : undefined
const optionalObject = (v: unknown): Record<string, unknown> => object.safeParse(v).data ?? {}

/** Pi's native thinkingLevelMap: null disables a tier; extended tiers need an explicit mapping. */
function piEfforts(model: Record<string, unknown>): ModelReasoningEffort[] | undefined {
  if (model.reasoning !== true) return undefined
  const map = optionalObject(model.thinkingLevelMap)
  return efforts(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].filter((level) =>
    map[level] !== null && (!['xhigh', 'max'].includes(level) || map[level] !== undefined)))
}

export function parseNativeModels(kind: string, value: unknown): DiscoveredModel[] {
  if (!Array.isArray(value)) throw new Error('Invalid native model directory')
  return value.map((value) => {
    const m = object.parse(value)
    if (kind === 'claude') {
      const id = z.string().min(1).parse(m.value)
      const levels = efforts(m.supportedEffortLevels)
      const adaptive = bool(m.supportsAdaptiveThinking)
      const reasoning = { ...(adaptive === true ? { supported: true, mode: 'adaptive' } : {}),
        ...(levels !== undefined ? { efforts: levels } : m.supportsEffort === false ? { efforts: [] } : {}) }
      return discoveredModelSchema.parse({ id, label: m.displayName ?? id,
        ...(Object.keys(reasoning).length ? { semantics: { reasoning } } : {}),
      })
    }
    if (kind === 'codex') {
      const id = z.string().min(1).parse(m.model)
      const levels = efforts(Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts.map((v) => optionalObject(v).reasoningEffort) : undefined)
      const defaultEffort = efforts([m.defaultReasoningEffort])?.[0]
      return discoveredModelSchema.parse({ id, label: m.displayName ?? id, semantics: { reasoning: {
        ...(levels !== undefined ? { efforts: levels } : {}),
        ...(defaultEffort && levels?.includes(defaultEffort) ? { defaultEffort } : {}),
      } } })
    }
    const parsed = row.parse(m)
    const provider = z.string().min(1).parse(kind === 'opencode' ? m.providerID : parsed.provider)
    const id = typeof m.selector === 'string' ? m.selector : `${provider}/${parsed.id}`
    const capabilities = optionalObject(m.capabilities)
    const limits = optionalObject(m.limit)
    const levels = kind === 'opencode' ? (m.variants === undefined ? undefined : efforts(Object.keys(optionalObject(m.variants)))) : kind === 'pi' ? piEfforts(m) : efforts(m.thinking)
    const reasoning = bool(kind === 'opencode' ? capabilities.reasoning : m.reasoning)
    const contextWindow = positive(kind === 'opencode' ? limits.context : m.contextWindow)
    const maxOutputTokens = positive(kind === 'opencode' ? limits.output : m.maxTokens)
    const semantics = {
      ...(contextWindow ? { contextWindow } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(reasoning !== undefined || levels !== undefined ? { reasoning: {
        ...(reasoning !== undefined ? { supported: reasoning } : {}),
        ...(reasoning === false ? { mode: 'none', efforts: [] } : levels !== undefined ? { efforts: levels } : {}),
      } } : {}),
    }
    return discoveredModelSchema.parse({ id, label: parsed.name ? `${parsed.name} (${provider})` : id,
      ...(Object.keys(semantics).length ? { semantics } : {}),
    })
  })
}

export function parseNativeModelText(kind: string, stdout: string): DiscoveredModel[] {
  const text = stripVTControlCharacters(stdout)
  if (kind === 'opencode') {
    // --verbose emits a selector line followed by one pretty-printed JSON object.
    const rows: unknown[] = []
    let buffer = ''
    for (const line of text.split('\n')) {
      if (!buffer && line !== '{') continue
      buffer += line + '\n'
      if (line === '}') { rows.push(JSON.parse(buffer)); buffer = '' }
    }
    if (buffer || (!rows.length && text.trim())) throw new Error('Invalid opencode directory')
    return parseNativeModels(kind, rows)
  }
  const models: DiscoveredModel[] = []
  for (const line of text.split('\n')) {
    const match = kind === 'cursor' ? /^([\w./:[\]-]+) - (.+)$/.exec(line.trim())
      : kind === 'grok' ? /^\s*[-*] ([\w./:-]+)(?:\s+\(default\))?\s*$/.exec(line)
      : /^([\w./:-]+)\t(.+)$/.exec(line)
    if (match) models.push({ id: match[1]!, label: (match[2] ?? match[1]!).replace(/ \(current, default\)$| \(default\)$/, '') })
  }
  if (!models.length) throw new Error('No parseable native model directory')
  return models
}

type Frame = Record<string, unknown>
/** Bounded child lifetime shared by directory commands and read-only protocol handshakes. */
export async function queryNativeModels(input: {
  argv: readonly string[]; cwd: string;
  initial?: Frame;
  onFrame?: (frame: Frame, send: (frame: Frame) => void) => DiscoveredModel[] | undefined;
  parse?: (stdout: string) => DiscoveredModel[];
}): Promise<DiscoveredModel[]> {
  const env = buildSpawnEnv(process.env, {}, input.cwd)
  const command = resolveLaunchCommand(input.argv, { cwd: input.cwd, env })
  const child = spawn(command.argv[0]!, command.argv.slice(1), { cwd: input.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    return await new Promise((resolve, reject) => {
      const decoder = new StringDecoder('utf8')
      let output = '', pending = '', bytes = 0, done = false
      const finish = (error?: Error, models?: DiscoveredModel[]) => {
        if (done) return
        done = true; clearTimeout(timer)
        if (error) reject(error); else resolve(models!)
      }
      const fail = () => finish(new Error('Could not load native models; check the runtime login/configuration and retry.'))
      const timer = setTimeout(fail, 30_000)
      const send = (frame: Frame) => { if (!done) child.stdin.write(JSON.stringify(frame) + '\n') }
      child.on('error', fail); child.stdin.on('error', fail)
      child.stderr.on('data', () => { /* Never expose raw runtime diagnostics or credentials. */ })
      child.stdout.on('data', (chunk: Buffer) => {
        if (done) return
        bytes += chunk.length
        if (bytes > 8 * 1024 * 1024) { fail(); return }
        const text = decoder.write(chunk)
        if (!input.onFrame) { output += text; return }
        pending += text
        let newline: number
        while (!done && (newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
          if (!line.trim()) continue
          try {
            const models = input.onFrame(object.parse(JSON.parse(line)), send)
            if (models) finish(undefined, models)
          } catch { fail() }
        }
      })
      child.on('close', (code) => {
        if (done) return
        try {
          if (code !== 0 || !input.parse) { fail(); return }
          finish(undefined, input.parse(output))
        } catch { fail() }
      })
      if (input.initial) send(input.initial)
      else if (!input.onFrame) child.stdin.end()
    })
  } finally {
    if (child.pid && child.exitCode === null) await terminateProcessTree(child.pid, { gracefulMs: 500, forceMs: 500 })
  }
}

export async function discoverNativeModels(agent: string, binaryName: string, cwd: string): Promise<DiscoveredModel[]> {
  const env = buildSpawnEnv(process.env, {}, cwd)
  const binary = detectAgentBinary(agent, binaryName, { env })
  if (!binary.path) throw new Error('Agent runtime is not installed')
  const profile = runtimeProfileFromEnv(env)
  const head = agent === 'pi' && profile.managedPiPath === binary.path && profile.managedPiNodePath
    ? [profile.managedPiNodePath, binary.path] : [binary.path]
  if (agent === 'codex') {
    const models: DiscoveredModel[] = []
    let page = 0
    return queryNativeModels({ argv: [...head, 'app-server'], cwd,
      initial: { id: 'init', method: 'initialize', params: { clientInfo: { name: 'openalice_models', version: '1' }, capabilities: {} } },
      onFrame(frame, send) {
        if (frame.error) throw new Error('Model query failed')
        if (frame.id === 'init') {
          send({ method: 'initialized', params: {} }); send({ id: 'models', method: 'model/list', params: { limit: 100 } })
        } else if (frame.id === 'models') {
          const result = object.parse(frame.result)
          models.push(...parseNativeModels(agent, result.data))
          if (!result.nextCursor) return models
          if (++page >= 20) throw new Error('Too many model pages')
          send({ id: 'models', method: 'model/list', params: { limit: 100, cursor: result.nextCursor } })
        }
      },
    })
  }
  if (agent === 'claude') return queryNativeModels({
    argv: [...head, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'], cwd,
    initial: { type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } },
    onFrame(frame) {
      if (frame.type !== 'control_response') return
      const response = object.parse(frame.response)
      if (response.request_id !== 'models') return
      if (response.subtype === 'error') throw new Error('Model query failed')
      return parseNativeModels(agent, object.parse(response.response).models)
    },
  })
  if (agent === 'pi') return queryNativeModels({ argv: [...head, '--mode', 'rpc', '--no-session'], cwd,
    initial: { id: 'models', type: 'get_available_models' },
    onFrame(frame) {
      if (frame.type !== 'response' || frame.id !== 'models') return
      if (frame.success === false) throw new Error('Model query failed')
      return parseNativeModels(agent, object.parse(frame.data).models)
    },
  })
  const args = agent === 'omp' ? ['models', '--json'] : agent === 'opencode' ? ['models', '--verbose'] : ['models']
  return queryNativeModels({ argv: [...head, ...args], cwd,
    parse: (stdout) => agent === 'omp' ? parseNativeModels(agent, object.parse(JSON.parse(stdout)).models) : parseNativeModelText(agent, stdout),
  })
}
