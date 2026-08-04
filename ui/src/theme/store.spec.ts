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
      uiStyle: 'default',
    })
  })

  it('allows either slot to select any palette', () => {
    expect(normalizeThemePreferences({
      theme: 'day',
      dayPalette: 'moss',
      nightPalette: 'linen',
      uiStyle: 'default',
    })).toEqual({
      theme: 'day',
      dayPalette: 'moss',
      nightPalette: 'linen',
      uiStyle: 'default',
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
    })).toEqual({
      theme: 'auto',
      dayPalette: 'porcelain',
      nightPalette: 'graphite',
      uiStyle: 'win98',
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
  })
})
