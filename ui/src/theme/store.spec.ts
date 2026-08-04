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
    })).toEqual({
      theme: 'auto',
      dayPalette: 'porcelain',
      nightPalette: 'graphite',
      uiStyle: 'win98',
      stylePaletteMode: 'recommended',
    })
  })

  it('persists known styles and repairs an unknown style independently', () => {
    expect(normalizeThemePreferences({
      theme: 'auto',
      dayPalette: 'paper',
      nightPalette: 'graphite',
      uiStyle: 'broker-classic',
    }).uiStyle).toBe('broker-classic')

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
      dayPalette: 'paper',
      nightPalette: 'graphite',
      uiStyle: 'default',
      stylePaletteMode: 'recommended',
    })
  })
})
