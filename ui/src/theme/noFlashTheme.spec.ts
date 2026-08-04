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
): Record<string, string> {
  expect(script).toBeDefined()
  const dataset: Record<string, string> = {}
  runInNewContext(script!, {
    document: { documentElement: { dataset } },
    localStorage: { getItem: () => JSON.stringify({ state, version }) },
    matchMedia: () => ({ matches: systemDark }),
  })
  return dataset
}

describe('no-flash theme bootstrap', () => {
  it('migrates legacy fields before first paint', () => {
    expect(applyNoFlashTheme({
      theme: 'dark',
      lightPalette: 'porcelain',
      darkPalette: 'midnight',
    }, false)).toEqual({
      theme: 'night',
      dayPalette: 'porcelain',
      nightPalette: 'midnight',
      uiStyle: 'default',
      stylePaletteMode: 'saved',
      palette: 'midnight',
    })
  })

  it('allows a dark card in Day and a light card in Night', () => {
    expect(applyNoFlashTheme({
      theme: 'day',
      dayPalette: 'midnight',
      nightPalette: 'paper',
    }, true)).toEqual({
      theme: 'day',
      dayPalette: 'midnight',
      nightPalette: 'paper',
      uiStyle: 'default',
      stylePaletteMode: 'saved',
      palette: 'midnight',
    })

    expect(applyNoFlashTheme({
      theme: 'night',
      dayPalette: 'midnight',
      nightPalette: 'paper',
    }, false).palette).toBe('paper')
  })

  it('uses the system only to select a slot in Auto', () => {
    const state = { theme: 'auto', dayPalette: 'linen', nightPalette: 'iris' }
    expect(applyNoFlashTheme(state, false).palette).toBe('linen')
    expect(applyNoFlashTheme(state, true).palette).toBe('iris')
  })

  it('applies a valid style profile before first paint and repairs invalid values', () => {
    expect(applyNoFlashTheme({ uiStyle: 'win98' }, false).uiStyle).toBe('win98')
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
    expect(applyNoFlashTheme(state, false)).toEqual({
      theme: 'auto',
      dayPalette: 'paper',
      nightPalette: 'graphite',
      uiStyle: 'win98',
      stylePaletteMode: 'recommended',
      palette: 'windows-classic',
    })
  })

  it('repairs the version 1 global Windows Classic pair before first paint', () => {
    expect(applyNoFlashTheme({
      theme: 'day',
      dayPalette: 'windows-classic',
      nightPalette: 'windows-classic',
      uiStyle: 'default',
    }, false, 1)).toEqual({
      theme: 'day',
      dayPalette: 'paper',
      nightPalette: 'graphite',
      uiStyle: 'default',
      stylePaletteMode: 'recommended',
      palette: 'paper',
    })
  })
})
