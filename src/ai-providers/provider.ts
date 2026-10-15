/** A provider projects one AI access source: a Vault credential or native runtime. */
import { cachedProviderModel, MODEL_CATALOG_TTL_MS } from './model-catalog.js'
import { createHash } from 'node:crypto'
import { credentialWires, type Credential, type CredentialWireShape } from '../core/config.js'
import { discoverModels, type DiscoveredModel } from './model-discovery.js'
import { PRESET_CATALOG, DEFAULT_MODEL_BY_VENDOR, type ModelOption } from './preset-catalog.js'
import { mergeModelSemantics, resolveModelSemantics } from './model-semantics.js'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export abstract class AIProvider {
  abstract readonly id: string
  abstract get models(): ModelOption[]
  abstract get catalogSlot(): string
  abstract get catalogIdentity(): string
  get discoverModels(): (() => Promise<DiscoveredModel[]>) | undefined { return undefined }
  get persistCatalog(): boolean { return true }
  get catalogTtlMs(): number { return MODEL_CATALOG_TTL_MS }
  describeModel(model: DiscoveredModel): ModelOption { return model }
  resolveModel(model: string): ModelOption { return cachedProviderModel(this, model) }
}

/** Existing vault records keep their credential-bound provider projection. */
export abstract class CredentialAIProvider extends AIProvider {
  readonly #credential: Credential
  abstract readonly presetId: string

  constructor(readonly id: string, credential: Credential) {
    super()
    this.#credential = structuredClone(credential)
  }

  get vendor() { return this.#credential.vendor }
  get label() { return this.#credential.label ?? this.preset?.label ?? this.vendor }
  get wires() { return { ...credentialWires(this.#credential) } }
  get preset() { return PRESET_CATALOG.find((preset) => preset.id === this.presetId) }
  get defaultModel() { return DEFAULT_MODEL_BY_VENDOR[this.vendor] }
  get models(): ModelOption[] { return (this.preset?.models ?? []).map((model) => this.describeModel(model)) }
  describeModel(model: DiscoveredModel): ModelOption {
    const semantics = mergeModelSemantics(resolveModelSemantics(this.vendor, model.id), model.semantics)
    return { ...model, ...(semantics ? { semantics } : {}) }
  }

  protected get apiKey() { return this.#credential.apiKey }
  protected get isApiKey() { return this.#credential.authType === 'api-key' }
  get catalogSlot(): string { return digest([this.id, null]) }
  get catalogIdentity(): string { return digest([this.vendor, null]) }
}

/** Shared transport mechanics; vendors choose which configured directory to use. */
abstract class ModelAPIProvider extends CredentialAIProvider {
  readonly #discover: (() => Promise<DiscoveredModel[]>) | undefined
  override get discoverModels() { return this.#discover }
  readonly #shape: CredentialWireShape | undefined
  constructor(id: string, credential: Credential, preference: readonly CredentialWireShape[], semanticsProtocol?: 'anthropic' | 'google' | 'openai') {
    super(id, credential)
    this.#shape = preference.find((shape) => shape in this.wires)
    if (this.isApiKey && this.apiKey?.trim() && this.#shape) {
      const input = { wireShape: this.#shape, baseUrl: this.wires[this.#shape], apiKey: this.apiKey.trim() }
      this.#discover = () => discoverModels(input, semanticsProtocol)
    }
  }
  get catalogSlot() { return digest([this.id, this.#shape]) }
  get catalogIdentity() { return digest([this.vendor, this.#shape, this.#shape ? this.wires[this.#shape] ?? '' : '', this.apiKey?.trim()]) }
}

const openaiWires = ['openai-chat', 'openai-responses', 'anthropic'] as const
export class OpenAIProvider extends ModelAPIProvider {
  readonly presetId = 'codex-api'
  constructor(id: string, credential: Credential) { super(id, credential, openaiWires) }
}
export class AnthropicProvider extends ModelAPIProvider {
  readonly presetId = 'claude-api'
  constructor(id: string, credential: Credential) { super(id, credential, ['anthropic', ...openaiWires]) }
}
export class GoogleProvider extends ModelAPIProvider {
  readonly presetId = 'gemini'
  constructor(id: string, credential: Credential) { super(id, credential, ['google-generative-ai']) }
}
export class XAIProvider extends ModelAPIProvider {
  readonly presetId = 'xai-api'
  constructor(id: string, credential: Credential) { super(id, credential, openaiWires) }
}
export class DeepSeekProvider extends ModelAPIProvider {
  readonly presetId = 'deepseek'
  constructor(id: string, credential: Credential) { super(id, credential, openaiWires) }
}
export class OpenRouterProvider extends ModelAPIProvider {
  readonly presetId = 'openrouter'
  constructor(id: string, credential: Credential) { super(id, credential, openaiWires, 'openai') }
}
export class MiniMaxProvider extends ModelAPIProvider {
  readonly presetId = 'minimax'
  constructor(id: string, credential: Credential) { super(id, credential, openaiWires) }
}
export class KimiProvider extends ModelAPIProvider {
  readonly presetId = 'kimi'
  constructor(id: string, credential: Credential) { super(id, credential, openaiWires) }
}
export class LongCatProvider extends ModelAPIProvider {
  readonly presetId = 'longcat'
  constructor(id: string, credential: Credential) { super(id, credential, openaiWires) }
}
/** No model-directory contract: use bundled suggestions and manual model IDs. */
export class GLMProvider extends CredentialAIProvider {
  readonly presetId = 'glm'
}
export class CursorProvider extends CredentialAIProvider {
  readonly presetId = 'cursor-dashboard'
}
export class CustomProvider extends ModelAPIProvider {
  readonly presetId = 'custom'
  constructor(id: string, credential: Credential) { super(id, credential, [...openaiWires, 'google-generative-ai']) }
}

const providers = {
  anthropic: AnthropicProvider, openai: OpenAIProvider, google: GoogleProvider, xai: XAIProvider,
  deepseek: DeepSeekProvider, openrouter: OpenRouterProvider, minimax: MiniMaxProvider,
  kimi: KimiProvider, longcat: LongCatProvider, glm: GLMProvider, cursor: CursorProvider, custom: CustomProvider,
} satisfies Record<Credential['vendor'], new (id: string, credential: Credential) => CredentialAIProvider>

/** Existing vault records remain the only persisted account identity. */
export function createAIProvider(id: string, credential: Credential): CredentialAIProvider {
  return new providers[credential.vendor](id, credential)
}
