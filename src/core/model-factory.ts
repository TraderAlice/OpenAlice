/**
 * Model factory — creates Vercel AI SDK LanguageModel instances from config.
 *
 * Reads model.json and api-keys.json from disk on each call so that model
 * changes take effect without a restart.  Uses dynamic imports so unused
 * provider packages don't prevent startup.
 */

import type { LanguageModel } from 'ai'
import { readModelConfig, readApiKeysConfig } from './config.js'

/** Result includes the model plus a cache key for change detection. */
export interface ModelFromConfig {
  model: LanguageModel
  /** `provider:modelId` — use this to detect config changes. */
  key: string
}

export async function createModelFromConfig(): Promise<ModelFromConfig> {
  const mc = await readModelConfig()
  const keys = await readApiKeysConfig()
  const key = `${mc.provider}:${mc.model}`

  switch (mc.provider) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      const client = createAnthropic({ apiKey: keys.anthropic || undefined })
      return { model: client(mc.model), key }
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const client = createOpenAI({ apiKey: keys.openai || undefined })
      return { model: client(mc.model), key }
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const client = createGoogleGenerativeAI({ apiKey: keys.google || undefined })
      return { model: client(mc.model), key }
    }
    default:
      throw new Error(`Unsupported model provider: "${mc.provider}". Supported: anthropic, openai, google`)
  }
}
