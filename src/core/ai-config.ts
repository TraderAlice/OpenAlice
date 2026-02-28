import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readAIProviderConfig } from './config.js'

export type AIBackend = 'claude-code' | 'vercel-ai-sdk'

const CONFIG_PATH = resolve('data/config/ai-provider.json')

export async function readAIConfig() {
  const config = await readAIProviderConfig()
  return { backend: config.backend }
}

export async function writeAIConfig(backend: AIBackend): Promise<void> {
  const current = await readAIProviderConfig()
  const updated = { ...current, backend }
  await mkdir(resolve('data/config'), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(updated, null, 2) + '\n')
}
