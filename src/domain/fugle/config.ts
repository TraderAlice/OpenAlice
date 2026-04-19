/**
 * Fugle config — reads from data/config/fugle.json.
 * API key and MCP URL are kept in gitignored config file.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { z } from 'zod'

const CONFIG_PATH = resolve('data/config/fugle.json')

const fugleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mcpUrl: z.string().default(''),
})

export type FugleConfig = z.infer<typeof fugleConfigSchema>

export async function readFugleConfig(): Promise<FugleConfig> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'))
    return fugleConfigSchema.parse(raw)
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      const defaults = fugleConfigSchema.parse({})
      await mkdir(resolve('data/config'), { recursive: true })
      await writeFile(CONFIG_PATH, JSON.stringify(defaults, null, 2) + '\n')
      return defaults
    }
    return fugleConfigSchema.parse({})
  }
}
