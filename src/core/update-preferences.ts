/** Update behavior is installation-owned, independent of Workspace content. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { dataPath } from './paths.js'

const schema = z.object({
  autoCheckApp: z.boolean().default(true),
  autoUpdateAutoQuant: z.boolean().default(true),
  autoUpdateAutoPrediction: z.boolean().default(true),
})

export type UpdatePreferences = z.infer<typeof schema>
export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = schema.parse({})

export function updatePreferencesPath(): string {
  return dataPath('update-preferences.json')
}

export async function readUpdatePreferences(path = updatePreferencesPath()): Promise<UpdatePreferences> {
  try { return schema.parse(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_UPDATE_PREFERENCES }
    throw error
  }
}

let pending: Promise<unknown> = Promise.resolve()
export function saveUpdatePreferences(input: UpdatePreferences, path = updatePreferencesPath()): Promise<UpdatePreferences> {
  const run = pending.catch(() => undefined).then(async () => {
    const value = schema.parse(input)
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await rename(temp, path)
    return value
  })
  pending = run
  return run
}
