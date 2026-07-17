import { describe, expect, it, vi } from 'vitest'

import type { AppearancePreferences } from '../../core/preferences.js'
import { BUILTIN_OPENALICE_FAMILY } from '../../core/themes/builtins.js'
import { importThemeScheme } from '../../core/themes/importer.js'
import { ThemeFamilyConflictError, ThemeFamilyDeleteError, ThemeFamilyNotFoundError } from '../../core/themes/store.js'
import type { ThemeFamily } from '../../core/themes/types.js'
import { createThemeRoutes } from './themes.js'

const defaultAppearance: AppearancePreferences = {
  activeFamilyId: 'builtin-openalice',
  mode: 'system',
  terminal: { mode: 'follow' },
  marketColors: 'protected',
  marketDirection: 'green-up-red-down',
  statusColors: 'protected',
}

describe('theme routes', () => {
  it('previews a strict import without persisting it', async () => {
    const deps = memoryDeps()
    const app = createThemeRoutes(deps)
    const response = await app.request('/imports/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: tintedDocument(), filename: 'theme.json' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ format: 'tinted-base16', family: { name: 'Eighties' } })
    expect(deps.saveFamily).not.toHaveBeenCalled()
  })

  it('persists a preview explicitly and exposes stable-id conflicts', async () => {
    const deps = memoryDeps()
    const app = createThemeRoutes(deps)
    const family = importThemeScheme(tintedDocument(), { filename: 'theme.json' }).family
    expect((await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(family) })).status).toBe(201)
    expect((await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(family) })).status).toBe(409)
  })

  it('rejects system mode for a single-variant family and validates terminal overrides', async () => {
    const deps = memoryDeps()
    const family = importThemeScheme(tintedDocument(), { filename: 'theme.json' }).family
    await deps.saveFamily(family)
    const app = createThemeRoutes(deps)
    const response = await app.request('/appearance', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...defaultAppearance, activeFamilyId: family.id }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'system_requires_complete_family' })
    expect(deps.saveAppearance).not.toHaveBeenCalled()
  })

  it('fails loudly when persisted appearance references a missing family', async () => {
    const deps = memoryDeps()
    deps.appearance.activeFamilyId = 'missing-family'
    const response = await createThemeRoutes(deps).request('/appearance')
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'theme_family_not_found',
      familyId: 'missing-family',
    })
  })

  it('protects active and built-in families from deletion', async () => {
    const deps = memoryDeps()
    const family = importThemeScheme(tintedDocument(), { filename: 'theme.json' }).family
    await deps.saveFamily(family)
    deps.appearance.activeFamilyId = family.id
    const app = createThemeRoutes(deps)
    expect((await app.request(`/${family.id}`, { method: 'DELETE' })).status).toBe(409)
    expect((await app.request('/builtin-openalice', { method: 'DELETE' })).status).toBe(409)
  })
})

function memoryDeps() {
  const families = new Map<string, ThemeFamily>([[BUILTIN_OPENALICE_FAMILY.id, BUILTIN_OPENALICE_FAMILY]])
  const appearance = structuredClone(defaultAppearance)
  return {
    appearance,
    listFamilies: vi.fn(async () => [...families.values()]),
    readFamily: vi.fn(async (familyId: string) => {
      const family = families.get(familyId)
      if (family === undefined) throw new ThemeFamilyNotFoundError(familyId)
      return family
    }),
    saveFamily: vi.fn(async (family: ThemeFamily) => {
      if (families.has(family.id)) throw new ThemeFamilyConflictError(family.id)
      families.set(family.id, family)
      return family
    }),
    replaceFamily: vi.fn(async (family: ThemeFamily) => {
      if (!families.has(family.id)) throw new ThemeFamilyNotFoundError(family.id)
      families.set(family.id, family)
      return family
    }),
    deleteFamily: vi.fn(async (familyId: string, activeFamilyId: string) => {
      if (familyId === 'builtin-openalice') throw new ThemeFamilyDeleteError('builtin', familyId)
      if (familyId === activeFamilyId) throw new ThemeFamilyDeleteError('active', familyId)
      if (!families.delete(familyId)) throw new ThemeFamilyNotFoundError(familyId)
    }),
    readAppearance: vi.fn(async () => structuredClone(appearance)),
    saveAppearance: vi.fn(async (next: AppearancePreferences) => {
      Object.assign(appearance, next)
      return structuredClone(appearance)
    }),
  }
}

function tintedDocument(): string {
  return JSON.stringify({
    system: 'base16', name: 'Eighties', author: 'Chris Kempson', variant: 'dark',
    palette: {
      base00: '101010', base01: '181818', base02: '282828', base03: '585858',
      base04: 'b8b8b8', base05: 'd8d8d8', base06: 'e8e8e8', base07: 'f8f8f8',
      base08: 'ab4642', base09: 'dc9656', base0A: 'f7ca88', base0B: 'a1b56c',
      base0C: '86c1b9', base0D: '7cafc2', base0E: 'ba8baf', base0F: 'a16946',
    },
  })
}
