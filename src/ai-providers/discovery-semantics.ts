/** Protocol metadata adapters. Missing fields never mean unsupported. */
import type { ModelSemantics } from './model-semantics.js'
import { MODEL_REASONING_EFFORTS, isModelReasoningEffort } from './model-semantics.js'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
const positive = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
const supported = (value: unknown): boolean | undefined => typeof object(value).supported === 'boolean' ? object(value).supported as boolean : undefined

export function discoverModelSemantics(value: unknown, protocol: 'anthropic' | 'google' | 'openai'): ModelSemantics | undefined {
  const model = object(value)
  const semantics: ModelSemantics = {}
  const context = positive(protocol === 'google' ? model.inputTokenLimit : protocol === 'anthropic' ? model.max_input_tokens : model.context_length)
  const output = positive(protocol === 'google' ? model.outputTokenLimit : protocol === 'anthropic' ? model.max_tokens : object(model.top_provider).max_completion_tokens)
  if (context !== undefined) semantics.contextWindow = context
  if (output !== undefined) semantics.maxOutputTokens = output
  if (protocol === 'anthropic') {
    const capabilities = object(model.capabilities)
    const thinking = object(capabilities.thinking)
    const thinkingSupported = supported(thinking)
    const effort = object(capabilities.effort)
    if (thinkingSupported !== undefined || supported(effort) !== undefined) {
      semantics.reasoning = {}
      if (thinkingSupported !== undefined) semantics.reasoning.supported = thinkingSupported
      if (thinkingSupported === false) semantics.reasoning.mode = 'none'
      // Supported thinking types do not tell us whether disabling is allowed.
      if (supported(effort) === false) semantics.reasoning.efforts = []
      else if (supported(effort) === true) {
        const entries = MODEL_REASONING_EFFORTS.filter((level) => supported(effort[level]) !== undefined)
        if (entries.length) semantics.reasoning.efforts = entries.filter((level) => supported(effort[level]) === true)
      }
    }
  } else if (protocol === 'openai') {
    // OpenRouter extensions are optional on OpenAI-compatible directories.
    const parameters = model.supported_parameters
    if (Array.isArray(parameters) && parameters.every((p) => typeof p === 'string')) {
      if (parameters.includes('reasoning') || parameters.includes('reasoning_effort')) semantics.reasoning = { supported: true }
      // Lack of a request knob is not proof that a model cannot reason.
    }
    if (Array.isArray(model.supported_efforts) && model.supported_efforts.every(isModelReasoningEffort)) {
      semantics.reasoning = { ...semantics.reasoning, efforts: model.supported_efforts }
    }
    const defaultEffort = object(model.default_parameters).reasoning_effort
    if (isModelReasoningEffort(defaultEffort)) semantics.reasoning = { ...semantics.reasoning, defaultEffort }
  } else if (typeof model.thinking === 'boolean') {
    // Google's model resource advertises thinking separately from its limits.
    semantics.reasoning = { supported: model.thinking, ...(model.thinking ? {} : { mode: 'none' }) }
  }
  return Object.keys(semantics).length ? semantics : undefined
}
