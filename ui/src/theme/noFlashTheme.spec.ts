import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

const repoRoot = basename(process.cwd()) === 'ui' ? resolve(process.cwd(), '..') : process.cwd()
const html = readFileSync(resolve(repoRoot, 'ui/index.html'), 'utf8')
const script = html.match(/<script>\s*(\/\/ No-flash theme[\s\S]*?)<\/script>/)?.[1]

function applyNoFlashTheme(
  state: Record<string, unknown>,
  systemDark: boolean,
  version = 2,
): Record<string, string> & { colorSchemeMeta?: string } {
  expect(script).toBeDefined()
  const dataset: Record<string, string> = {}
  const meta = {
    content: 'light dark',
    setAttribute(name: string, value: string) {
      if (name === 'content') this.content = value
    },
  }
  runInNewContext(script!, {
    document: {
      documentElement: { dataset },
      querySelector: (selector: string) => (selector === 'meta[name="color-scheme"]' ? meta : null),
    },
    localStorage: { getItem: () => JSON.stringify({ state, version }) },
    matchMedia: () => ({ matches: systemDark }),
  })
  Object.defineProperty(dataset, 'colorSchemeMeta', {
    value: meta.content,
    enumerable: false,
  })
  return dataset
}

describe('no-flash theme bootstrap', () => {
  it('migrates legacy fields before first paint', () => {
    const result = applyNoFlashTheme({
      theme: 'dark',
      lightPalette: 'porcelain',
      darkPalette: 'midnight',
    }, false)
    expect(result).toEqual({
      theme: 'night',
      dayPalette: 'porcelain',
      nightPalette: 'midnight',
      uiStyle: 'default',
      stylePaletteMode: 'saved',
      palette: 'midnight',
      appearance: 'dark',
    })
    expect(result.colorSchemeMeta).toBe('dark')
  })

  it('allows a dark card in Day and a light card in Night', () => {
    const dayDark = applyNoFlashTheme({
      theme: 'day',
      dayPalette: 'midnight',
      nightPalette: 'paper',
    }, true)
    expect(dayDark).toEqual({
      theme: 'day',
      dayPalette: 'midnight',
      nightPalette: 'paper',
      uiStyle: 'default',
      stylePaletteMode: 'saved',
      palette: 'midnight',
      appearance: 'dark',
    })
    expect(dayDark.colorSchemeMeta).toBe('dark')

    const nightLight = applyNoFlashTheme({
      theme: 'night',
      dayPalette: 'midnight',
      nightPalette: 'paper',
    }, false)
    expect(nightLight.palette).toBe('paper')
    expect(nightLight.appearance).toBe('light')
    expect(nightLight.colorSchemeMeta).toBe('light')
  })

  it('uses the system only to select a slot in Auto', () => {
    const state = { theme: 'auto', dayPalette: 'linen', nightPalette: 'iris' }
    const dayResult = applyNoFlashTheme(state, false)
    expect(dayResult.palette).toBe('linen')
    expect(dayResult.appearance).toBe('light')
    expect(dayResult.colorSchemeMeta).toBe('light')

    const nightResult = applyNoFlashTheme(state, true)
    expect(nightResult.palette).toBe('iris')
    expect(nightResult.appearance).toBe('dark')
    expect(nightResult.colorSchemeMeta).toBe('dark')
  })

  it('applies a valid style profile before first paint and repairs invalid values', () => {
    expect(applyNoFlashTheme({ uiStyle: 'studio' }, false).uiStyle).toBe('studio')
    expect(applyNoFlashTheme({ uiStyle: 'aqua' }, false).uiStyle).toBe('default')
  })

  it('restores a scoped Windows Classic recommendation before first paint', () => {
    const state = {
      theme: 'auto',
      dayPalette: 'paper',
      nightPalette: 'graphite',
      uiStyle: 'win98',
      stylePaletteMode: 'recommended',
    }
    const result = applyNoFlashTheme(state, false)
    expect(result).toEqual({
      theme: 'auto',
      dayPalette: 'paper',
      nightPalette: 'graphite',
      uiStyle: 'win98',
      stylePaletteMode: 'recommended',
      palette: 'windows-classic',
      appearance: 'light',
    })
    expect(result.colorSchemeMeta).toBe('light')
  })

  it('repairs the version 1 global Windows Classic pair before first paint', () => {
    const result = applyNoFlashTheme({
      theme: 'day',
      dayPalette: 'windows-classic',
      nightPalette: 'windows-classic',
      uiStyle: 'default',
    }, false, 1)
    expect(result).toEqual({
      theme: 'day',
      dayPalette: 'codex',
      nightPalette: 'graphite',
      uiStyle: 'default',
      stylePaletteMode: 'recommended',
      palette: 'codex',
      appearance: 'light',
    })
    expect(result.colorSchemeMeta).toBe('light')
  })

  it('synchronizes appearance and color-scheme meta across every light and dark palette', () => {
    for (const lightPalette of ['codex', 'paper', 'porcelain', 'linen', 'windows-classic']) {
      const res = applyNoFlashTheme({ theme: 'day', dayPalette: lightPalette }, true)
      expect(res.palette).toBe(lightPalette)
      expect(res.appearance).toBe('light')
      expect(res.colorSchemeMeta).toBe('light')
    }
    for (const darkPalette of ['graphite', 'midnight', 'moss', 'iris']) {
      const res = applyNoFlashTheme({ theme: 'day', dayPalette: darkPalette }, false)
      expect(res.palette).toBe(darkPalette)
      expect(res.appearance).toBe('dark')
      expect(res.colorSchemeMeta).toBe('dark')
    }
  })

  it('falls back to light appearance and light dark color-scheme meta when storage throws', () => {
    const dataset: Record<string, string> = {}
    const meta = {
      content: 'dark',
      setAttribute(name: string, value: string) {
        if (name === 'content') this.content = value
      },
    }
    runInNewContext(script!, {
      document: {
        documentElement: { dataset },
        querySelector: (selector: string) => (selector === 'meta[name="color-scheme"]' ? meta : null),
      },
      localStorage: {
        getItem: () => {
          throw new Error('storage blocked')
        },
      },
      matchMedia: () => ({ matches: true }),
    })
    expect(dataset.palette).toBe('codex')
    expect(dataset.appearance).toBe('light')
    expect(meta.content).toBe('light dark')
  })
})

it('starts with Codex by day and Graphite by night while preserving saved Paper', () => {
  expect(applyNoFlashTheme({}, false).palette).toBe('codex')
  expect(applyNoFlashTheme({}, false).appearance).toBe('light')
  expect(applyNoFlashTheme({}, true).palette).toBe('graphite')
  expect(applyNoFlashTheme({}, true).appearance).toBe('dark')
  expect(applyNoFlashTheme({ dayPalette: 'paper' }, false).palette).toBe('paper')
  expect(applyNoFlashTheme({ dayPalette: 'paper' }, false).appearance).toBe('light')
})
