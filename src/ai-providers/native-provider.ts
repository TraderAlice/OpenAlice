import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { CliAdapter } from '../workspaces/cli-adapter.js'
import { detectAgentBinary } from '../workspaces/agent-detect.js'
import { buildSpawnEnv } from '../workspaces/spawn-env.js'
import { AIProvider } from './provider.js'
import { PRESET_CATALOG, type ModelOption } from './preset-catalog.js'
import { runtimeModelOptions } from './runtime-model-options.js'
import { mergeModelSemantics } from './model-semantics.js'
import type { DiscoveredModel } from './discovered-model.js'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** A native access source delegates credentials and configuration to the runtime. */
export class NativeAIProvider extends AIProvider {
  readonly id: string
  readonly cwd: string
  constructor(readonly adapter: CliAdapter, cwd: string) {
    super()
    this.id = `native:${adapter.id}`
    this.cwd = resolve(cwd)
  }
  override get persistCatalog() { return false }
  override get catalogTtlMs() { return 60_000 }
  get catalogSlot() { return digest([this.id, this.cwd]) }
  get catalogIdentity() {
    const env = buildSpawnEnv(process.env, {}, this.cwd)
    return digest([this.catalogSlot, detectAgentBinary(this.adapter.id, this.adapter.binary ?? this.adapter.id, { env }).fingerprint, env])
  }
  override get discoverModels() {
    const discover = this.adapter.discoverModels
    return discover ? () => discover.call(this.adapter, this.cwd) : undefined
  }
  get models(): ModelOption[] {
    return runtimeModelOptions({ agent: this.adapter.id, credential: null, defaultModel: null, presets: PRESET_CATALOG })
  }
  override describeModel(model: DiscoveredModel): ModelOption {
    // Native aliases/menus belong to this runtime, never the vendor's API catalog.
    const fallback = this.models.find((entry) => entry.id === model.id)?.semantics
    const semantics = mergeModelSemantics(fallback, model.semantics)
    return { ...model, ...(semantics ? { semantics } : {}) }
  }
  override resolveModel(id: string): ModelOption {
    // Native injection only sends the explicitly selected model/effort. It must
    // not read a credential-backed snapshot or infer a provider from an alias.
    return this.describeModel({ id, label: id })
  }
}
