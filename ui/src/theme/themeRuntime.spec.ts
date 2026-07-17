// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThemeVariant } from '../api/themes'

const variant: ThemeVariant = {
  id: 'runtime-dark', name: 'Runtime Dark', mode: 'dark',
  palette: {
    base00: '#101010', base01: '#181818', base02: '#282828', base03: '#585858',
    base04: '#b8b8b8', base05: '#d8d8d8', base06: '#e8e8e8', base07: '#f8f8f8',
    base08: '#ab4642', base09: '#dc9656', base0A: '#f7ca88', base0B: '#a1b56c',
    base0C: '#86c1b9', base0D: '#7cafc2', base0E: '#ba8baf', base0F: '#a16946',
  },
  provenance: { kind: 'builtin', sourceName: 'Runtime', mappingVersion: 1 },
  tokens: {
    pageBackground: '#101010', secondarySurface: '#181818', cardSurface: '#282828', border: '#585858',
    mutedText: '#b8b8b8', bodyText: '#d8d8d8', strongText: '#e8e8e8', highestContrastText: '#f8f8f8',
    danger: '#ab4642', orange: '#dc9656', warning: '#f7ca88', success: '#a1b56c', info: '#86c1b9',
    accent: '#7cafc2', secondaryAccent: '#ba8baf', special: '#a16946', onAccent: '#101010',
    hoverSurface: '#252525', activeSurface: '#272d2f', selection: '#2c373b', focusRing: '#7cafc2',
    subtleSurface: '#171717', chartGrid: '#464646', overlay: '#1f1f1f',
  },
  createdAt: '2026-07-18T00:00:00.000Z',
}

let applyThemeVariant: typeof import('./index').applyThemeVariant

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
  applyThemeVariant = (await import('./index')).applyThemeVariant
})

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themeFamily
  delete document.documentElement.dataset.themeVariant
})

describe('canonical theme runtime', () => {
  it('applies canonical tokens and writes only the versioned first-paint cache', () => {
    applyThemeVariant('runtime-family', variant)
    expect(document.documentElement.dataset).toMatchObject({
      theme: 'dark', themeFamily: 'runtime-family', themeVariant: 'runtime-dark',
    })
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#101010')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#7cafc2')

    const cache = JSON.parse(localStorage.getItem('openalice.theme.first-paint.v1')!) as Record<string, unknown>
    expect(cache).toMatchObject({ schemaVersion: 1, mappingVersion: 1, familyId: 'runtime-family', mode: 'dark' })
    expect(cache).toHaveProperty('tokens')
    expect(cache).not.toHaveProperty('palette')
    expect(cache).not.toHaveProperty('provenance')
    expect(localStorage.getItem('openalice.theme.v1')).toBeNull()
  })
})
