/**
 * Offline model-semantics registry.
 *
 * Credentials answer "how can Alice reach this provider?". This registry
 * answers the separate question "what does this exact model support?". Keep
 * fields optional: an absent fact is unknown, never an implicit `false`.
 *
 * Runtime-specific request knobs do not belong here. `reasoning` records the
 * model contract; Pi/opencode project that contract into their native custom-
 * model capability bit, while every adapter projects a resolved effort into
 * its own native field only when the registry or user supplies one.
 */

export type ModelReasoningMode = 'none' | 'optional' | 'adaptive' | 'required'

export type ModelReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export const MODEL_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export function isModelReasoningEffort(value: unknown): value is ModelReasoningEffort {
  return typeof value === 'string' && MODEL_REASONING_EFFORTS.includes(value as ModelReasoningEffort)
}

export interface ModelReasoningSemantics {
  /**
   * none: no reasoning capability
   * optional: reasoning can be enabled/disabled
   * adaptive: the model/runtime dynamically chooses how much to reason
   * required: requests cannot disable reasoning
   */
  mode: ModelReasoningMode
  /** Provider-native effort levels, when the official contract documents them. */
  efforts?: ModelReasoningEffort[]
  /** Provider default. Omitted when the provider does not publish one. */
  defaultEffort?: ModelReasoningEffort
  /** Provider default for protocols that expose only a thinking on/off switch. */
  defaultEnabled?: boolean
  /** Reasoning may continue across tool calls / message boundaries. */
  interleaved?: boolean
}

export interface ModelSemantics {
  /** Maximum total/input context advertised by the provider, in tokens. */
  contextWindow?: number
  /** Maximum generated output advertised by the provider, in tokens. */
  maxOutputTokens?: number
  reasoning?: ModelReasoningSemantics
}

type Registry = Readonly<Record<string, Readonly<Record<string, ModelSemantics>>>>

const OPENAI_56_REASONING: ModelReasoningSemantics = {
  mode: 'optional',
  efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultEffort: 'medium',
}

const GEMINI_3_CONTEXT = 1_048_576

/**
 * Facts are sourced from provider documentation and live compatibility checks:
 *
 * - OpenAI model/reasoning guides: https://developers.openai.com/api/docs/guides/latest-model
 * - Anthropic extended/adaptive thinking: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
 * - Gemini thinking: https://ai.google.dev/gemini-api/docs/generate-content/thinking
 * - MiniMax Anthropic API: https://platform.minimax.io/docs/api-reference/text-anthropic-api
 * - MiniMax OpenAI `reasoning_split`: https://platform.minimax.io/docs/api-reference/text-openai-api
 * - Kimi thinking models: https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model
 * - DeepSeek thinking: https://api-docs.deepseek.com/guides/thinking_mode
 * - LongCat Chat API: https://longcat.chat/platform/docs/api/chat.html
 *
 * GLM 5.2's reasoning capability is also covered by the provider announcement;
 * its exact context limit is intentionally omitted because public surfaces do
 * not currently agree. Kimi K2.7's required mode is additionally verified by
 * OpenAlice's live provider probe (the API rejects `thinking: disabled`).
 */
export const MODEL_SEMANTICS_BY_VENDOR: Registry = {
  anthropic: {
    'claude-fable-5': {
      contextWindow: 1_000_000,
      reasoning: {
        mode: 'required',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'high',
        interleaved: true,
      },
    },
    'claude-opus-4-8': {
      contextWindow: 1_000_000,
      reasoning: {
        mode: 'adaptive',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'high',
        interleaved: true,
      },
    },
    'claude-sonnet-5': {
      contextWindow: 1_000_000,
      reasoning: {
        mode: 'adaptive',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'high',
        interleaved: true,
      },
    },
    'claude-haiku-4-5': {
      contextWindow: 200_000,
      reasoning: { mode: 'optional', interleaved: true },
    },
    'claude-sonnet-4-6': {
      contextWindow: 1_000_000,
      reasoning: {
        mode: 'adaptive',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
        interleaved: true,
      },
    },
  },
  openai: {
    'gpt-5.6': { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: OPENAI_56_REASONING },
    'gpt-5.6-sol': { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: OPENAI_56_REASONING },
    'gpt-5.6-terra': { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: OPENAI_56_REASONING },
    'gpt-5.6-luna': { contextWindow: 1_050_000, maxOutputTokens: 128_000, reasoning: OPENAI_56_REASONING },
    'gpt-5.5': {
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      reasoning: {
        mode: 'optional',
        efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'medium',
      },
    },
    'gpt-5.4': {
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      reasoning: {
        mode: 'optional',
        efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'none',
      },
    },
  },
  google: {
    'gemini-3.5-flash': {
      contextWindow: GEMINI_3_CONTEXT,
      maxOutputTokens: 65_536,
      reasoning: {
        mode: 'adaptive',
        efforts: ['minimal', 'low', 'medium', 'high'],
        defaultEffort: 'medium',
      },
    },
    'gemini-3.1-pro-preview': {
      contextWindow: GEMINI_3_CONTEXT,
      maxOutputTokens: 65_536,
      reasoning: {
        mode: 'adaptive',
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'high',
      },
    },
    'gemini-3.1-flash-lite': {
      contextWindow: GEMINI_3_CONTEXT,
      maxOutputTokens: 65_536,
      reasoning: {
        mode: 'adaptive',
        efforts: ['minimal', 'low', 'medium', 'high'],
        defaultEffort: 'minimal',
      },
    },
    'gemini-2.5-pro': {
      contextWindow: GEMINI_3_CONTEXT,
      reasoning: { mode: 'required' },
    },
    'gemini-2.5-flash': {
      contextWindow: GEMINI_3_CONTEXT,
      reasoning: { mode: 'optional' },
    },
    'gemini-2.5-flash-lite': {
      contextWindow: GEMINI_3_CONTEXT,
      reasoning: { mode: 'optional' },
    },
  },
  minimax: {
    'MiniMax-M3': {
      contextWindow: 1_000_000,
      reasoning: { mode: 'adaptive', interleaved: true },
    },
    'MiniMax-M2.7': {
      contextWindow: 204_800,
      reasoning: { mode: 'adaptive', interleaved: true },
    },
    'MiniMax-M2.7-highspeed': {
      contextWindow: 204_800,
      reasoning: { mode: 'adaptive', interleaved: true },
    },
    'MiniMax-M2.5': {
      contextWindow: 204_800,
      reasoning: { mode: 'adaptive', interleaved: true },
    },
    'MiniMax-M2.5-highspeed': {
      contextWindow: 204_800,
      reasoning: { mode: 'adaptive', interleaved: true },
    },
  },
  glm: {
    'glm-5.2': { reasoning: { mode: 'adaptive', efforts: ['high', 'max'] } },
  },
  kimi: {
    'kimi-k2.7-code': {
      contextWindow: 256_000,
      reasoning: { mode: 'required', interleaved: true },
    },
    'kimi-k2.6': {
      contextWindow: 256_000,
      reasoning: { mode: 'optional', interleaved: true },
    },
  },
  deepseek: {
    'deepseek-v4-pro': {
      contextWindow: 1_000_000,
      maxOutputTokens: 384_000,
      reasoning: {
        mode: 'optional',
        efforts: ['high', 'max'],
        defaultEffort: 'high',
        interleaved: true,
      },
    },
  },
  longcat: {
    'LongCat-2.0': {
      maxOutputTokens: 131_072,
      // LongCat documents thinking as enabled by default, but does not expose
      // provider-native effort tiers. Keep that distinct from an effort value.
      reasoning: { mode: 'optional', defaultEnabled: true },
    },
  },
}

/** Exact vendor + model lookup. Unknown aliases/models deliberately return null. */
export function resolveModelSemantics(
  vendor: string | null | undefined,
  model: string | null | undefined,
): ModelSemantics | null {
  const vendorId = vendor?.trim()
  const modelId = model?.trim()
  if (!vendorId || !modelId) return null
  return MODEL_SEMANTICS_BY_VENDOR[vendorId]?.[modelId] ?? null
}

/** Coarse capability required by Pi and opencode custom-model registrations. */
export function modelSupportsReasoning(semantics: ModelSemantics | null | undefined): boolean | null {
  const mode = semantics?.reasoning?.mode
  if (mode === undefined) return null
  return mode !== 'none'
}

/** Human-readable registry summary used by both docs-oriented UI surfaces. */
export function describeModelSemantics(semantics: ModelSemantics | null | undefined): string | null {
  if (!semantics) return null
  const parts: string[] = []
  if (semantics.reasoning) {
    const labels: Record<ModelReasoningMode, string> = {
      none: 'No reasoning mode',
      optional: 'Reasoning optional',
      adaptive: 'Adaptive reasoning',
      required: 'Reasoning always on',
    }
    parts.push(labels[semantics.reasoning.mode])
    if (semantics.reasoning.defaultEffort) parts.push(`default effort ${semantics.reasoning.defaultEffort}`)
    else if (semantics.reasoning.defaultEnabled !== undefined) {
      parts.push(`thinking default ${semantics.reasoning.defaultEnabled ? 'on' : 'off'}`)
    }
    if (semantics.reasoning.interleaved) parts.push('interleaved thinking')
  }
  if (semantics.contextWindow) parts.push(`${formatTokenCount(semantics.contextWindow)} context`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(2)}M`
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}
