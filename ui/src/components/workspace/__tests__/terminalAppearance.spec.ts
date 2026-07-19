// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest'

let appearanceModule: typeof import('../terminalAppearance')

const COLORS = {
  'terminal-background': '#0b0c0e',
  'terminal-foreground': '#dfe1e6',
  'terminal-cursor': 'rgba(35, 185, 154, 0.5)',
  'terminal-cursor-accent': '#0b0c0e',
  'terminal-selection-background': 'rgba(59, 130, 246, 0.32)',
  'terminal-selection-foreground': '#ffffff',
  'terminal-black': '#484f58',
  'terminal-red': '#ff7b72',
  'terminal-green': '#7ee787',
  'terminal-yellow': '#d29922',
  'terminal-blue': '#79c0ff',
  'terminal-magenta': '#d2a8ff',
  'terminal-cyan': '#a5d6ff',
  'terminal-white': '#dfe1e6',
  'terminal-bright-black': '#6e7681',
  'terminal-bright-red': '#ffa198',
  'terminal-bright-green': '#56d364',
  'terminal-bright-yellow': '#e3b341',
  'terminal-bright-blue': '#a5d6ff',
  'terminal-bright-magenta': '#d2a8ff',
  'terminal-bright-cyan': '#b6e3ff',
  'terminal-bright-white': '#f0f6fc',
} as const

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
  appearanceModule = await import('../terminalAppearance')
})

describe('terminal appearance', () => {
  it('projects semantic CSS roles into xterm and the 256-color view contract', () => {
    for (const [token, color] of Object.entries(COLORS)) {
      document.documentElement.style.setProperty(`--${token}`, color)
    }
    const appearance = appearanceModule.resolveTerminalAppearance('dark')
    expect(appearance.theme.background).toBe('#0b0c0e')
    expect(appearance.theme.brightWhite).toBe('#f0f6fc')
    expect(appearance.viewAttributes.foreground).toEqual([223, 225, 230])
    expect(appearance.viewAttributes.background).toEqual([11, 12, 14])
    expect(appearance.viewAttributes.cursor).toEqual([23, 99, 84])
    expect(appearance.viewAttributes.ansi).toHaveLength(256)
    expect(appearance.viewAttributes.ansi[1]).toEqual([255, 123, 114])
    expect(appearance.viewAttributes.colorSchemeMode).toBe('dark')
  })

  it('value-compares themes so neutral settings changes preserve OSC mutations', () => {
    expect(appearanceModule.terminalThemesEqual(
      { background: '#000', extendedAnsi: ['#123456'] },
      { background: '#000', extendedAnsi: ['#123456'] },
    )).toBe(true)
    expect(appearanceModule.terminalThemesEqual(
      { background: '#000' },
      { background: '#fff' },
    )).toBe(false)
  })

  it('emits Contour/Kitty color-scheme update sequences', () => {
    expect(appearanceModule.colorSchemeUpdateSequence('dark')).toBe('\x1b[?997;1n')
    expect(appearanceModule.colorSchemeUpdateSequence('light')).toBe('\x1b[?997;2n')
  })

  it('makes duplicate app-start publication wait for the in-flight renderer push', async () => {
    let release: (() => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      release = () => resolve(new Response(null, { status: 200 }))
    }))
    vi.stubGlobal('fetch', fetchMock)
    const attributes = appearanceModule.resolveTerminalAppearance('dark').viewAttributes

    const first = appearanceModule.publishTerminalViewAttributes(attributes)
    const duplicate = appearanceModule.publishTerminalViewAttributes(attributes)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledOnce()

    let duplicateSettled = false
    void duplicate.then(() => { duplicateSettled = true })
    await Promise.resolve()
    expect(duplicateSettled).toBe(false)

    release?.()
    await expect(first).resolves.toBe(true)
    await expect(duplicate).resolves.toBe(false)
    vi.unstubAllGlobals()
  })
})
