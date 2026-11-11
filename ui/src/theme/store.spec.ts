// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { migrateThemePreferences, normalizeThemePreferences } from './store'

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
      uiStyle: 'default',
      stylePaletteMode: 'saved',
      fontSize: 'default',
      zoomRatio: 100,
    })
  })

  it('allows either slot to select any palette', () => {
    expect(normalizeThemePreferences({
      theme: 'day',
      dayPalette: 'moss',
      nightPalette: 'linen',
      uiStyle: 'default',
      stylePaletteMode: 'saved',
    })).toEqual({
      theme: 'day',
      dayPalette: 'moss',
      nightPalette: 'linen',
      uiStyle: 'default',
      stylePaletteMode: 'saved',
      fontSize: 'default',
      zoomRatio: 100,
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
      uiStyle: 'win98',
      stylePaletteMode: 'recommended',
      fontSize: 'default',
      zoomRatio: 100,
    })).toEqual({
      theme: 'auto',
      dayPalette: 'porcelain',
      nightPalette: 'graphite',
      uiStyle: 'win98',
      stylePaletteMode: 'recommended',
      fontSize: 'default',
      zoomRatio: 100,
    })
  })

  it('persists known styles and repairs an unknown style independently', () => {
    expect(normalizeThemePreferences({
      theme: 'auto',
      dayPalette: 'paper',
      nightPalette: 'graphite',
      uiStyle: 'outline',
    }).uiStyle).toBe('outline')

    expect(normalizeThemePreferences({ uiStyle: 'aqua' }).uiStyle).toBe('default')
    expect(normalizeThemePreferences({ stylePaletteMode: 'recommended' }).stylePaletteMode)
      .toBe('recommended')
  })

  it('accepts Windows Classic in either palette slot', () => {
    expect(normalizeThemePreferences({
      theme: 'auto',
      dayPalette: 'windows-classic',
      nightPalette: 'windows-classic',
      uiStyle: 'win98',
      stylePaletteMode: 'saved',
    })).toEqual({
      theme: 'auto',
      dayPalette: 'windows-classic',
      nightPalette: 'windows-classic',
      uiStyle: 'win98',
      stylePaletteMode: 'saved',
      fontSize: 'default',
      zoomRatio: 100,
    })
  })

  it('persists font size and zoom ratio preferences and repairs invalid values', () => {
    expect(normalizeThemePreferences({ fontSize: 'large', zoomRatio: 125 })).toMatchObject({
      fontSize: 'large',
      zoomRatio: 125,
    })
    expect(normalizeThemePreferences({ fontSize: 'huge', zoomRatio: 1000 })).toMatchObject({
      fontSize: 'default',
      zoomRatio: 100,
    })
    expect(normalizeThemePreferences({ zoomRatio: 40 })).toMatchObject({
      zoomRatio: 100,
    })
  })

  it('migrates the briefly global Win98 pair into a scoped recommendation', () => {
    expect(migrateThemePreferences({
      theme: 'day',
      dayPalette: 'windows-classic',
      nightPalette: 'windows-classic',
      uiStyle: 'default',
    }, 1)).toEqual({
      theme: 'day',
      dayPalette: 'codex',
      nightPalette: 'graphite',
      uiStyle: 'default',
      stylePaletteMode: 'recommended',
    })
  })
})

it('defaults to Codex without replacing an explicit Paper preference', () => {
  expect(normalizeThemePreferences({}).dayPalette).toBe('codex')
  expect(normalizeThemePreferences({ dayPalette: 'paper' }).dayPalette).toBe('paper')
})
