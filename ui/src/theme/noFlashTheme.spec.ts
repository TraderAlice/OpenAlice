import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

const repoRoot = basename(process.cwd()) === 'ui' ? resolve(process.cwd(), '..') : process.cwd()
const html = readFileSync(resolve(repoRoot, 'ui/index.html'), 'utf8')
const script = html.match(/<script>\s*(\/\/ No-flash theme[\s\S]*?)<\/script>/)?.[1]

function applyNoFlashTheme(state: Record<string, unknown>, systemDark: boolean): Record<string, string> {
  expect(script).toBeDefined()
  const dataset: Record<string, string> = {}
  runInNewContext(script!, {
    document: { documentElement: { dataset } },
    localStorage: { getItem: () => JSON.stringify({ state }) },
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
})
