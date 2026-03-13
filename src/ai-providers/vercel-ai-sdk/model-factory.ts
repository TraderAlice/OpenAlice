/**
 * Model factory — creates Vercel AI SDK LanguageModel instances from config.
 *
 * Reads ai-provider.json from disk on each call so that model
 * changes take effect without a restart.  Uses dynamic imports so unused
 * provider packages don't prevent startup.
 */

import type { LanguageModel } from 'ai'
import { readAIProviderConfig } from '../../core/config.js'

/** Result includes the model plus a cache key for change detection. */
export interface ModelFromConfig {
  model: LanguageModel
  /** `provider:modelId:baseUrl` — use this to detect config changes. */
  key: string
}

/** Per-request model override (e.g. from a sub-channel's vercelAiSdk config). */
export interface ModelOverride {
  provider: string
  model: string
  baseUrl?: string
  apiKey?: string
}

export async function createModelFromConfig(override?: ModelOverride): Promise<ModelFromConfig> {
  // Resolve effective values: override takes precedence over global config
  const config = await readAIProviderConfig()
  const p = override?.provider ?? config.provider
  const m = override?.model ?? config.model
  const url = override?.baseUrl ?? config.baseUrl
  const key = `${p}:${m}:${url ?? ''}`

  // Resolve API key: override.apiKey > global config.apiKeys[provider]
  const resolveApiKey = (provider: string) => {
    if (override?.apiKey) return override.apiKey
    return (config.apiKeys as Record<string, string | undefined>)[provider] || undefined
  }

  switch (p) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      const client = createAnthropic({ apiKey: resolveApiKey('anthropic'), baseURL: url || undefined })
      return { model: client(m), key }
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const client = createOpenAI({ apiKey: resolveApiKey('openai'), baseURL: url || undefined })
      return { model: client(m), key }
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const client = createGoogleGenerativeAI({ apiKey: resolveApiKey('google'), baseURL: url || undefined })
      return { model: client(m), key }
    }
    default:
      throw new Error(`Unsupported model provider: "${p}". Supported: anthropic, openai, google`)
  }
}
