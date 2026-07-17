import { describe, expect, it } from 'vitest'

import type { ThemeVariant } from '../../../api/themes'
import {
  resolveTerminalThemeVariant,
  terminalClientThemeDTO,
  terminalThemeProfileForVariant,
  xtermThemeForVariant,
} from '../terminalThemeProfile'

const variant: ThemeVariant = {
  id: 'fixture-dark',
  name: 'Fixture Dark',
  mode: 'dark',
  palette: {
    base00: '#101010', base01: '#181818', base02: '#282828', base03: '#585858',
    base04: '#b8b8b8', base05: '#d8d8d8', base06: '#e8e8e8', base07: '#f8f8f8',
    base08: '#ab4642', base09: '#dc9656', base0A: '#f7ca88', base0B: '#a1b56c',
    base0C: '#86c1b9', base0D: '#7cafc2', base0E: '#ba8baf', base0F: '#a16946',
  },
  provenance: { kind: 'builtin', sourceName: 'Fixture', mappingVersion: 1 },
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

describe('terminal theme helpers', () => {
  it('resolves follow and explicit preferences', () => {
    expect(resolveTerminalThemeVariant('follow', 'dark')).toBe('dark')
    expect(resolveTerminalThemeVariant('follow', 'light')).toBe('light')
    expect(resolveTerminalThemeVariant('dark', 'light')).toBe('dark')
    expect(resolveTerminalThemeVariant('light', 'dark')).toBe('light')
  })

  it('maps canonical Base16 and extended ANSI slots into xterm', () => {
    expect(xtermThemeForVariant(variant)).toMatchObject({
      background: '#101010', foreground: '#d8d8d8', cursor: '#7cafc2',
      black: '#101010', red: '#ab4642', green: '#a1b56c', yellow: '#f7ca88',
      blue: '#7cafc2', magenta: '#ba8baf', cyan: '#86c1b9', white: '#d8d8d8',
      brightBlack: '#585858', brightRed: '#ab4642', brightGreen: '#a1b56c',
      brightYellow: '#f7ca88', brightBlue: '#7cafc2', brightMagenta: '#ba8baf',
      brightCyan: '#86c1b9', brightWhite: '#f8f8f8',
      extendedAnsi: ['#dc9656', '#a16946', '#181818', '#282828', '#b8b8b8', '#e8e8e8'],
    })
  })

  it('uses Base24 bright slots and exact ANSI16 overrides without losing colors', () => {
    const base24: ThemeVariant = {
      ...variant,
      id: 'fixture-base24',
      palette: {
        ...variant.palette,
        base10: '#202020', base11: '#303030', base12: '#ba1e2e', base13: '#ffe066',
        base14: '#90d070', base15: '#70d0d0', base16: '#70a0f0', base17: '#d080e0',
      },
    }
    expect(xtermThemeForVariant(base24)).toMatchObject({
      brightRed: '#ba1e2e', brightGreen: '#90d070', brightYellow: '#ffe066',
      brightBlue: '#70a0f0', brightMagenta: '#d080e0', brightCyan: '#70d0d0',
    })

    const colors = [
      '#000000', '#110000', '#001100', '#111100', '#000011', '#110011', '#001111', '#aaaaaa',
      '#555555', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
    ] as const
    const overridden: ThemeVariant = {
      ...variant,
      id: 'fixture-ansi',
      ansi16Override: {
        foreground: '#cccccc', background: '#050505', cursor: '#eeeeee', cursorText: '#050505',
        selectionBackground: '#333333', selectionForeground: '#ffffff', colors,
      },
    }
    const profile = terminalThemeProfileForVariant(overridden)
    expect(profile.xtermTheme).toMatchObject({
      background: '#050505', foreground: '#cccccc', brightMagenta: '#ff00ff', brightCyan: '#00ffff',
    })
    expect(profile.palette).toHaveLength(16)
    expect(terminalClientThemeDTO(profile).palette[14]).toBe(0x00ffff)
  })
})
