/**
 * Twstock config — standalone reader for data/config/twstock.json.
 *
 * The MCP URL is kept in the config file (gitignored) to avoid
 * leaking the endpoint in source code.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { z } from 'zod'

const CONFIG_PATH = resolve('data/config/twstock.json')

const twstockConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mcpUrl: z.string().default(''),
})

export type TwstockConfig = z.infer<typeof twstockConfigSchema>

/** Read twstock config from disk. Seeds defaults if file is missing. */
export async function readTwstockConfig(): Promise<TwstockConfig> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'))
    return twstockConfigSchema.parse(raw)
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      const defaults = twstockConfigSchema.parse({})
      await mkdir(resolve('data/config'), { recursive: true })
      await writeFile(CONFIG_PATH, JSON.stringify(defaults, null, 2) + '\n')
      return defaults
    }
    return twstockConfigSchema.parse({})
  }
}
