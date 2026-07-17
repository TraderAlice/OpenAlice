import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readAppearancePreferences, saveAppearancePreferences } from '../preferences.js'
import { migrateThemeFileState } from '../../migrations/0024_theme_file_state/index.js'
import { createThemeRoutes } from '../../webui/routes/themes.js'
import {
  deleteThemeFamily,
  listThemeFamilies,
  readThemeFamily,
  replaceThemeFamily,
  saveThemeFamily,
} from './store.js'
import type { ThemeFamily } from './types.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('file-backed theme lifecycle e2e', () => {
  it('previews, saves, selects, restarts, protects, switches, and deletes a family', async () => {
    const root = await mkdtemp(join(tmpdir(), 'theme-lifecycle-e2e-'))
    roots.push(root)
    const data = join(root, 'data')
    const directory = join(data, 'themes')
    const preferences = join(data, 'preferences.json')
    await migrateThemeFileState(data)

    const firstApp = createThemeRoutes(deps(directory, preferences))
    expect((await firstApp.request('/')).status).toBe(200)

    const previewResponse = await firstApp.request('/imports/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'runtime.json', contents: tintedDocument() }),
    })
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as { family: ThemeFamily }

    expect((await firstApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(preview.family),
    })).status).toBe(201)
    expect((await firstApp.request('/appearance', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        activeFamilyId: preview.family.id,
        mode: 'dark',
        terminal: { mode: 'follow' },
        marketColors: 'protected',
        marketDirection: 'green-up-red-down',
        statusColors: 'protected',
      }),
    })).status).toBe(200)
    expect((await firstApp.request(`/${preview.family.id}`, { method: 'DELETE' })).status).toBe(409)

    // A new route graph with fresh closures represents an Alice process restart.
    const restartedApp = createThemeRoutes(deps(directory, preferences))
    expect(await (await restartedApp.request('/appearance')).json()).toMatchObject({
      activeFamilyId: preview.family.id,
      mode: 'dark',
    })
    expect((await restartedApp.request(`/${preview.family.id}`)).status).toBe(200)

    const appearance = await (await restartedApp.request('/appearance')).json()
    expect((await restartedApp.request('/appearance', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...appearance, activeFamilyId: 'builtin-openalice', mode: 'system' }),
    })).status).toBe(200)
    expect((await restartedApp.request(`/${preview.family.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await restartedApp.request(`/${preview.family.id}`)).status).toBe(404)
  })
})

function deps(directory: string, preferences: string) {
  return {
    listFamilies: () => listThemeFamilies(directory),
    readFamily: (familyId: string) => readThemeFamily(familyId, directory),
    saveFamily: (family: ThemeFamily) => saveThemeFamily(family, directory),
    replaceFamily: (family: ThemeFamily) => replaceThemeFamily(family, directory),
    deleteFamily: (familyId: string, activeFamilyId: string) => deleteThemeFamily(familyId, activeFamilyId, directory),
    readAppearance: () => readAppearancePreferences(preferences),
    saveAppearance: (appearance: Parameters<typeof saveAppearancePreferences>[0]) => (
      saveAppearancePreferences(appearance, preferences)
    ),
  }
}

function tintedDocument(): string {
  return JSON.stringify({
    system: 'base16', name: 'E2E Eighties', author: 'OpenAlice E2E', variant: 'dark',
    palette: {
      base00: '101010', base01: '181818', base02: '282828', base03: '585858',
      base04: 'b8b8b8', base05: 'd8d8d8', base06: 'e8e8e8', base07: 'f8f8f8',
      base08: 'ab4642', base09: 'dc9656', base0A: 'f7ca88', base0B: 'a1b56c',
      base0C: '86c1b9', base0D: '7cafc2', base0E: 'ba8baf', base0F: 'a16946',
    },
  })
}
