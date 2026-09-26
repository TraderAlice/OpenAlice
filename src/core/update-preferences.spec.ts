import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { readUpdatePreferences, saveUpdatePreferences } from './update-preferences.js'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

it('defaults all three policies on and persists an explicit opt-out', async () => {
  const home = await mkdtemp(join(tmpdir(), 'update-preferences-'))
  homes.push(home)
  const path = join(home, 'data', 'update-preferences.json')
  expect(await readUpdatePreferences(path)).toEqual({ autoCheckApp: true, autoUpdateAutoQuant: true, autoUpdateAutoPrediction: true })
  await saveUpdatePreferences({ autoCheckApp: false, autoUpdateAutoQuant: true, autoUpdateAutoPrediction: false }, path)
  expect(await readUpdatePreferences(path)).toEqual({ autoCheckApp: false, autoUpdateAutoQuant: true, autoUpdateAutoPrediction: false })
  await writeFile(path, JSON.stringify({ autoCheckApp: 'off' }))
  await expect(readUpdatePreferences(path)).rejects.toThrow()
})
