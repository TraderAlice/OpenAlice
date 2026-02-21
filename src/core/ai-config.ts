import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { aiProviderSchema } from './config.js'

export type AIProvider = 'claude-code' | 'vercel-ai-sdk'

const CONFIG_PATH = resolve('data/config/ai-provider.json')

export async function readAIConfig() {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'))
    return aiProviderSchema.parse(raw)
  } catch {
    // File missing or corrupt → return schema defaults
    return aiProviderSchema.parse({})
  }
}

export async function writeAIConfig(provider: AIProvider): Promise<void> {
  await mkdir(resolve('data/config'), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify({ provider }, null, 2) + '\n')
}
