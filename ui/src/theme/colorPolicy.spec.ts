import { describe, expect, it } from 'vitest'

import type { ThemeVariant } from '../api/themes'
import { projectColorPolicy } from './colorPolicy'

const palette = {
  base00: '#ffffff', base01: '#f0f0f0', base02: '#e0e0e0', base03: '#777777',
  base04: '#666666', base05: '#222222', base06: '#111111', base07: '#000000',
  base08: '#aa0000', base09: '#a05000', base0A: '#886600', base0B: '#007a30',
  base0C: '#007777', base0D: '#0055aa', base0E: '#770077', base0F: '#773300',
} as const

function makeVariant(mode: 'light' | 'dark'): ThemeVariant {
  const dark = mode === 'dark'
  return {
    id: mode, name: mode, mode,
    palette: { ...palette, base00: dark ? '#101010' : '#ffffff' },
    provenance: { kind: 'builtin', sourceName: 'test', mappingVersion: 1 },
    tokens: {
      pageBackground: dark ? '#101010' : '#ffffff', secondarySurface: dark ? '#181818' : '#f0f0f0',
      // Built-in OpenAlice chart/status surfaces (base02) are the protected
      // policy's concrete light/dark acceptance backgrounds.
      cardSurface: dark ? '#1a1b21' : '#e4dccb', border: dark ? '#666666' : '#777777',
      mutedText: dark ? '#aaaaaa' : '#666666', bodyText: dark ? '#eeeeee' : '#222222',
      strongText: dark ? '#ffffff' : '#111111', highestContrastText: dark ? '#ffffff' : '#000000',
      danger: '#aa0000', orange: '#a05000', warning: '#886600', success: '#007a30', info: '#0055aa',
      accent: '#0055aa', secondaryAccent: '#770077', special: '#773300', onAccent: '#ffffff',
      hoverSurface: dark ? '#282828' : '#eeeeee', activeSurface: dark ? '#303030' : '#dddddd',
      selection: dark ? '#304050' : '#ccddee', focusRing: '#0055aa', subtleSurface: dark ? '#181818' : '#f5f5f5',
      chartGrid: dark ? '#666666' : '#999999', overlay: dark ? '#101010' : '#000000',
    },
    createdAt: '2026-07-18T00:00:00.000Z',
  }
}

describe('protected color contrast', () => {
  it.each(['light', 'dark'] as const)('keeps graphical protected colors at least 3:1 in %s mode', (mode) => {
    const variant = makeVariant(mode)
    const variables = projectColorPolicy(variant, {
      marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected',
    })
    const surface = variant.tokens.cardSurface
    for (const name of [
      '--oa-market-up', '--oa-market-down', '--oa-status-success', '--oa-status-warning',
      '--oa-status-danger', '--oa-status-info', '--oa-risk-destructive',
    ]) expect(contrast(variables[name]!, surface), name).toBeGreaterThanOrEqual(3)
  })

  it.each(['light', 'dark'] as const)('covers every policy combination in %s mode', (mode) => {
    const variant = makeVariant(mode)
    for (const marketColors of ['protected', 'theme'] as const) {
      for (const marketDirection of ['green-up-red-down', 'red-up-green-down'] as const) {
        for (const statusColors of ['protected', 'theme'] as const) {
          const variables = projectColorPolicy(variant, { marketColors, marketDirection, statusColors })
          const green = marketColors === 'theme' ? variant.palette.base0B : mode === 'light' ? '#137333' : '#81c995'
          const red = marketColors === 'theme' ? variant.palette.base08 : mode === 'light' ? '#b3261e' : '#f28b82'
          const up = marketDirection === 'green-up-red-down' ? green : red
          const down = marketDirection === 'green-up-red-down' ? red : green
          expect(variables['--oa-market-up']).toBe(up)
          expect(variables['--oa-market-down']).toBe(down)
          expect(variables['--oa-status-success']).toBe(statusColors === 'theme'
            ? variant.tokens.success : mode === 'light' ? '#137333' : '#81c995')
          expect(variables['--oa-status-danger']).toBe(statusColors === 'theme'
            ? variant.tokens.danger : mode === 'light' ? '#b3261e' : '#f28b82')
          expect(variables['--oa-risk-destructive']).toBe(mode === 'light' ? '#b3261e' : '#f28b82')
        }
      }
    }
  })
})

function contrast(left: string, right: string): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return (lighter! + 0.05) / (darker! + 0.05)
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}
