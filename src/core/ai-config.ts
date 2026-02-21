import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export type AIProvider = 'claude-code' | 'vercel-ai-sdk'

interface AIConfig {
  provider: AIProvider
}

const CONFIG_PATH = resolve('data/config/ai-provider.json')
const DEFAULT_PROVIDER: AIProvider = 'vercel-ai-sdk'

export async function readAIConfig(): Promise<AIConfig> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf-8')) as AIConfig
  } catch {
    const config: AIConfig = { provider: DEFAULT_PROVIDER }
    await mkdir(dirname(CONFIG_PATH), { recursive: true })
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
    return config
  }
}

export async function writeAIConfig(provider: AIProvider): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify({ provider }, null, 2) + '\n')
}
