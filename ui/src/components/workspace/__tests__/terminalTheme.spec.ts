import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ITheme } from '@xterm/xterm'

import type { TerminalThemeVariant, TerminalThemePreference } from '../terminalTheme'

let resolveTerminalThemeVariant: (
  preference: TerminalThemePreference,
  appTheme: TerminalThemeVariant,
) => TerminalThemeVariant
let xtermThemeForVariant: (variant: TerminalThemeVariant) => ITheme
let readTerminalThemePreference: () => TerminalThemePreference
let terminalThemeProfileForVariant: typeof import('../terminalTheme').terminalThemeProfileForVariant
let terminalClientThemeDTO: typeof import('../terminalTheme').terminalClientThemeDTO

beforeAll(async () => {
  window.localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
  const mod = await import('../terminalTheme')
  resolveTerminalThemeVariant = mod.resolveTerminalThemeVariant
  xtermThemeForVariant = mod.xtermThemeForVariant
  terminalThemeProfileForVariant = mod.terminalThemeProfileForVariant
  terminalClientThemeDTO = mod.terminalClientThemeDTO
  readTerminalThemePreference = () => mod.useTerminalThemeStore.getState().preference
})

describe('terminal theme helpers', () => {
  it('defaults to following the app theme', () => {
    expect(readTerminalThemePreference()).toBe('follow')
  })

  it('resolves follow to the current app theme', () => {
    expect(resolveTerminalThemeVariant('follow', 'dark')).toBe('dark')
    expect(resolveTerminalThemeVariant('follow', 'light')).toBe('light')
  })

  it('lets explicit terminal preferences override the app theme', () => {
    expect(resolveTerminalThemeVariant('dark', 'light')).toBe('dark')
    expect(resolveTerminalThemeVariant('light', 'dark')).toBe('light')
  })

  it('maps concrete variants to xterm palettes', () => {
    expect(xtermThemeForVariant('dark')).toEqual({
      background: '#0b0d10',
      foreground: '#e6edf3',
      cursor: '#7ee787',
      cursorAccent: '#0b0d10',
      selectionBackground: '#264f78',
      selectionForeground: '#f0f6fc',
      black: '#484f58',
      red: '#ff7b72',
      green: '#7ee787',
      yellow: '#d29922',
      blue: '#79c0ff',
      magenta: '#d2a8ff',
      cyan: '#a5d6ff',
      white: '#e6edf3',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#a5d6ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#b6e3ff',
      brightWhite: '#f0f6fc',
    })
    expect(xtermThemeForVariant('light').selectionBackground).toBe('rgba(47, 98, 176, 0.22)')
  })

  it('exposes a muxy-style terminal client theme profile', () => {
    const light = terminalThemeProfileForVariant('light')
    const dto = terminalClientThemeDTO(light)

    expect(light.xtermTheme.background).toBe('#faf8f1')
    expect(light.xtermTheme.foreground).toBe('#1c2a41')
    expect(dto.fg).toBe(0x1c2a41)
    expect(dto.bg).toBe(0xfaf8f1)
    expect(dto.palette).toHaveLength(16)
    expect(dto.palette[0]).toBe(0x1c2a41)
    expect(dto.palette[15]).toBe(0x24292f)
    expect(dto.cursorColor).toBe(0x2f62b0)
    expect(dto.selectionBackground).toBe(0x2f62b0)
    expect(dto.selectionForeground).toBe(0xfaf8f1)
  })
})
