// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { normalizeThemePreferences } from './store'

describe('theme preference persistence', () => {
  it('migrates the legacy light/dark shape into day/night slots', () => {
    expect(normalizeThemePreferences({
      theme: 'dark',
      lightPalette: 'porcelain',
      darkPalette: 'midnight',
    })).toEqual({
      theme: 'night',
      dayPalette: 'porcelain',
      nightPalette: 'midnight',
    })
  })

  it('allows either slot to select any palette', () => {
    expect(normalizeThemePreferences({
      theme: 'day',
      dayPalette: 'moss',
      nightPalette: 'linen',
    })).toEqual({
      theme: 'day',
      dayPalette: 'moss',
      nightPalette: 'linen',
    })
  })

  it('repairs malformed fields independently', () => {
    expect(normalizeThemePreferences({
      theme: 'sepia',
      dayPalette: 'unknown',
      nightPalette: 'graphite',
    }, {
      theme: 'auto',
      dayPalette: 'porcelain',
      nightPalette: 'midnight',
    })).toEqual({
      theme: 'auto',
      dayPalette: 'porcelain',
      nightPalette: 'graphite',
    })
  })
})
