import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { importThemeScheme } from './importer.js'
import { TerminalThemeContrastError } from './colors.js'
import {
  ThemeFamilyConflictError,
  ThemeFamilyDeleteError,
  ThemeFamilyValidationError,
  deleteThemeFamily,
  listThemeFamilies,
  readThemeFamily,
  replaceThemeFamily,
  saveThemeFamily,
} from './store.js'

const roots: string[] = []

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-themes-'))
  roots.push(root)
  return join(root, 'themes')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('theme family store', () => {
  it('exposes built-ins through the same read boundary and never persists them', async () => {
    const dir = await directory()
    expect((await listThemeFamilies(dir)).map((family) => family.id)).toContain('builtin-openalice')
    expect((await readThemeFamily('builtin-openalice', dir)).variants.light).toBeDefined()
    await expect(deleteThemeFamily('builtin-openalice', 'other', dir)).rejects.toMatchObject({ code: 'builtin' })
  })

  it('saves normalized files without overwriting a stable id', async () => {
    const dir = await directory()
    const family = importedFamily()
    await saveThemeFamily(family, dir)
    expect(JSON.parse(await readFile(join(dir, `${family.id}.json`), 'utf8'))).toEqual(family)
    await expect(saveThemeFamily(family, dir)).rejects.toBeInstanceOf(ThemeFamilyConflictError)
  })

  it('refuses a family whose persisted semantic tokens do not derive from its palette', async () => {
    const dir = await directory()
    const family = importedFamily()
    const fabricated = structuredClone(family)
    fabricated.variants.dark!.tokens.bodyText = '#ffffff'
    await expect(saveThemeFamily(fabricated, dir)).rejects.toBeInstanceOf(ThemeFamilyValidationError)
  })

  it('refuses an exact ANSI override whose terminal pairs are unreadable', async () => {
    const dir = await directory()
    const family = importedFamily()
    const variant = family.variants.dark!
    variant.ansi16Override = {
      foreground: '#777777', background: '#777777', cursor: '#777777', cursorText: '#777777',
      selectionForeground: '#888888', selectionBackground: '#888888',
      colors: [
        '#777777', '#777777', '#777777', '#777777', '#777777', '#777777', '#777777', '#777777',
        '#777777', '#777777', '#777777', '#777777', '#777777', '#777777', '#777777', '#777777',
      ],
    }
    await expect(saveThemeFamily(family, dir)).rejects.toBeInstanceOf(TerminalThemeContrastError)
  })

  it('replaces an existing family explicitly and protects the active family', async () => {
    const dir = await directory()
    const family = importedFamily()
    await saveThemeFamily(family, dir)
    await replaceThemeFamily({ ...family, name: 'Renamed' }, dir)
    expect((await readThemeFamily(family.id, dir)).name).toBe('Renamed')
    await expect(deleteThemeFamily(family.id, family.id, dir)).rejects.toBeInstanceOf(ThemeFamilyDeleteError)
    await deleteThemeFamily(family.id, 'builtin-openalice', dir)
    expect((await listThemeFamilies(dir)).map((item) => item.id)).toEqual(['builtin-openalice'])
  })
})

function importedFamily() {
  const palette = {
    base00: '101010', base01: '181818', base02: '282828', base03: '585858',
    base04: 'b8b8b8', base05: 'd8d8d8', base06: 'e8e8e8', base07: 'f8f8f8',
    base08: 'ab4642', base09: 'dc9656', base0A: 'f7ca88', base0B: 'a1b56c',
    base0C: '86c1b9', base0D: '7cafc2', base0E: 'ba8baf', base0F: 'a16946',
  }
  return importThemeScheme(JSON.stringify({
    system: 'base16', name: 'Eighties', author: 'Chris Kempson', variant: 'dark', palette,
  }), { filename: 'eighties.json', now: new Date('2026-07-18T00:00:00.000Z') }).family
}
