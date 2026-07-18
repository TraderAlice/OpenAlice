// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThemeVariant } from '../api/themes'
import { useThemeStore } from './store'

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

let themeRuntime: typeof import('./index')
let systemDark = false
const bootSource = readFileSync(resolve(process.cwd(), 'ui/public/theme-first-paint.js'), 'utf8')

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ get matches() { return systemDark }, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
  themeRuntime = await import('./index')
})

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themeFamily
  delete document.documentElement.dataset.themeVariant
  delete document.documentElement.dataset.themeAppearance
  delete document.documentElement.dataset.themeFingerprint
  delete document.documentElement.dataset.themeFirstPaint
  useThemeStore.setState({ families: [], appearance: null, status: 'idle', error: null, theme: 'auto' })
  systemDark = false
})

describe('canonical theme runtime', () => {
  it('applies canonical tokens and writes only the versioned first-paint cache', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'system', variant)
    expect(document.documentElement.dataset).toMatchObject({
      theme: 'dark', themeFamily: 'runtime-family', themeVariant: 'runtime-dark',
    })
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#101010')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#7cafc2')

    const cache = JSON.parse(localStorage.getItem('openalice.theme.first-paint.v1')!) as Record<string, unknown>
    expect(cache).toMatchObject({ schemaVersion: 1, mappingVersion: 1, appearanceMode: 'system', resolvedMode: 'dark', familyId: 'runtime-family' })
    expect(cache).toHaveProperty('variables')
    expect(cache).toHaveProperty('tokenFingerprint')
    expect(cache).toHaveProperty('projectionShapeFingerprint', 'fnv1a32-b9241240')
    expect(cache).toMatchObject({
      marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected',
    })
    expect(cache).not.toHaveProperty('variables.--oa-base00')
    expect(cache).toHaveProperty('variables.--color-issue-detail-danger-text', '#ab4642')
    expect(cache).not.toHaveProperty('tokens')
    expect(cache).not.toHaveProperty('palette')
    expect(cache).not.toHaveProperty('provenance')
    expect(localStorage.getItem('openalice.theme.v1')).toBeNull()
  })

  it('projects every available palette slot, every resolved token, and public aliases', () => {
    const projection = themeRuntime.projectThemeVariant(variant)
    expect(projection.all['--oa-base00']).toBe('#101010')
    expect(projection.all['--oa-base0f']).toBe('#a16946')
    expect(projection.all['--oa-token-highest-contrast-text']).toBe('#f8f8f8')
    expect(projection.all['--oa-token-on-accent']).toBe('#101010')
    expect(projection.all['--color-bg']).toBe('#101010')
    expect(projection.all['--color-notification-border']).toBe('#f7ca88')
    expect(Object.keys(projection.all).filter((name) => name.startsWith('--oa-token-'))).toHaveLength(24)
    expect(projection.all['--oa-base10']).toBe('')
  })

  it.each([
    ['protected', 'green-up-red-down', '#81c995', '#f28b82'],
    ['protected', 'red-up-green-down', '#f28b82', '#81c995'],
    ['theme', 'green-up-red-down', '#a1b56c', '#ab4642'],
    ['theme', 'red-up-green-down', '#ab4642', '#a1b56c'],
  ] as const)('projects the %s market source with %s direction consistently', (marketColors, marketDirection, up, down) => {
    const variables = themeRuntime.projectThemeVariant(variant, {
      marketColors, marketDirection, statusColors: 'protected',
    }).all
    for (const name of ['--oa-market-up', '--oa-market-positive', '--oa-market-buy', '--oa-market-volume-up-solid']) {
      expect(variables[name]).toBe(up)
    }
    for (const name of ['--oa-market-down', '--oa-market-negative', '--oa-market-sell', '--oa-market-volume-down-solid']) {
      expect(variables[name]).toBe(down)
    }
    expect(variables['--oa-market-volume-up']).toBe(`${up}55`)
    expect(variables['--oa-market-volume-down']).toBe(`${down}55`)
  })

  it.each(['protected', 'theme'] as const)('keeps risk colors invariant under %s status colors', (statusColors) => {
    const first = themeRuntime.projectThemeVariant(variant, {
      marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors,
    }).all
    const swapped = themeRuntime.projectThemeVariant(variant, {
      marketColors: 'theme', marketDirection: 'red-up-green-down', statusColors,
    }).all
    for (const name of ['--oa-risk-destructive', '--oa-risk-permission-denied', '--oa-risk-trade-confirm', '--oa-risk-broker-write-failed', '--oa-risk-risk-blocked']) {
      expect(first[name]).toBe('#f28b82')
      expect(swapped[name]).toBe(first[name])
    }
    expect(first['--oa-status-success']).toBe(statusColors === 'theme' ? '#a1b56c' : '#81c995')
  })

  it('projects chart neutrals only from the resolved theme', () => {
    const variables = themeRuntime.projectThemeVariant(variant, {
      marketColors: 'theme', marketDirection: 'red-up-green-down', statusColors: 'theme',
    }).all
    expect(variables).toMatchObject({
      '--oa-chart-background': '#282828', '--oa-chart-grid': '#464646',
      '--oa-chart-axis-text': '#b8b8b8', '--oa-chart-axis-border': '#585858',
      '--oa-chart-crosshair': '#d8d8d8', '--oa-chart-selection': '#2c373b',
    })
  })

  it('replays exactly the cached first-paint projection before application startup', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    const expected = JSON.parse(localStorage.getItem('openalice.theme.first-paint.v1')!) as {
      variables: Record<string, string>
      tokenFingerprint: string
    }
    document.documentElement.removeAttribute('style')
    window.eval(bootSource)
    for (const [name, value] of Object.entries(expected.variables)) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe(value)
    }
    expect(document.documentElement.dataset.themeFingerprint).toBe(expected.tokenFingerprint)
    expect(document.documentElement.dataset.themeFirstPaint).toBe('cache')
  })

  it('keeps the boot and hydrated runtime on the same consumer identity', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    const cache = JSON.parse(localStorage.getItem('openalice.theme.first-paint.v1')!) as {
      tokenFingerprint: string
    }
    expect(document.documentElement.dataset.themeFingerprint).toBe(cache.tokenFingerprint)
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.themeFingerprint
    window.eval(bootSource)
    const bootFingerprint = document.documentElement.dataset.themeFingerprint
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    expect(bootFingerprint).toBe(cache.tokenFingerprint)
    expect(document.documentElement.dataset.themeFingerprint).toBe(bootFingerprint)
  })

  it('evicts a system cache resolved under the other OS appearance with a diagnostic', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'system', variant)
    systemDark = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    window.eval(bootSource)
    expect(localStorage.getItem('openalice.theme.first-paint.v1')).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('system appearance changed'))
    warn.mockRestore()
  })

  it('does not evict an explicit appearance when the OS differs', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    systemDark = false
    window.eval(bootSource)
    expect(localStorage.getItem('openalice.theme.first-paint.v1')).not.toBeNull()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('evicts a projection whose token fingerprint was modified', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    const cache = JSON.parse(localStorage.getItem('openalice.theme.first-paint.v1')!) as {
      variables: Record<string, string>
    }
    cache.variables['--color-bg'] = '#ffffff'
    localStorage.setItem('openalice.theme.first-paint.v1', JSON.stringify(cache))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    window.eval(bootSource)
    expect(localStorage.getItem('openalice.theme.first-paint.v1')).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('token fingerprint mismatch'))
    warn.mockRestore()
  })

  it('evicts an internally fingerprinted cache that omits a required projection variable', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    const cache = JSON.parse(localStorage.getItem('openalice.theme.first-paint.v1')!) as {
      variables: Record<string, string>
      tokenFingerprint: string
    }
    delete cache.variables['--color-issue-detail-danger-text']
    cache.tokenFingerprint = themeRuntime.fingerprintVariables(cache.variables)
    localStorage.setItem('openalice.theme.first-paint.v1', JSON.stringify(cache))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    window.eval(bootSource)
    expect(localStorage.getItem('openalice.theme.first-paint.v1')).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('incomplete projection'))
    warn.mockRestore()
  })

  it('diagnoses disabled storage without letting eviction throw from the blocking boot script', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => window.eval(bootSource)).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Evicted stale cache: Storage disabled'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cache eviction unavailable: Storage disabled'))
    getItem.mockRestore()
    removeItem.mockRestore()
    warn.mockRestore()
  })

  it('clears the entire runtime projection, including palette variables outside the cache', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    expect(document.documentElement.style.getPropertyValue('--oa-base00')).toBe('#101010')
    themeRuntime.clearThemeProjection()
    expect(document.documentElement.style.getPropertyValue('--oa-base00')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--oa-token-page-background')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('')
    expect(localStorage.getItem('openalice.theme.first-paint.v1')).toBeNull()
    expect(document.documentElement.dataset.themeFamily).toBeUndefined()
    expect(document.documentElement.dataset.themeFirstPaint).toBeUndefined()
  })

  it('diagnoses a cached identity that disagrees with file-backed initialization', async () => {
    themeRuntime.applyThemeVariant('stale-family', 'dark', variant)
    document.documentElement.removeAttribute('style')
    window.eval(bootSource)
    const changed = { ...variant, id: 'variant-from-files' }
    const initialize = vi.spyOn(useThemeStore.getState(), 'initialize').mockImplementation(async () => {
      useThemeStore.setState({
        families: [{ schemaVersion: 1, id: 'file-family', name: 'File family', variants: { dark: changed } }],
        appearance: {
          activeFamilyId: 'file-family', mode: 'dark', terminal: { mode: 'follow' },
          marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected',
        },
        status: 'ready',
      })
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await themeRuntime.initializeTheme()
    expect(document.documentElement.dataset.themeFamily).toBe('file-family')
    expect(document.documentElement.dataset.themeFirstPaint).toBe('stale')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not match authoritative'))
    initialize.mockRestore()
    warn.mockRestore()
  })

  it('diagnoses policy preferences changed in authoritative file-backed appearance', async () => {
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    document.documentElement.removeAttribute('style')
    window.eval(bootSource)
    const initialize = vi.spyOn(useThemeStore.getState(), 'initialize').mockImplementation(async () => {
      useThemeStore.setState({
        families: [{ schemaVersion: 1, id: 'runtime-family', name: 'Runtime', variants: { dark: variant } }],
        appearance: {
          activeFamilyId: 'runtime-family', mode: 'dark', terminal: { mode: 'follow' },
          marketColors: 'theme', marketDirection: 'red-up-green-down', statusColors: 'theme',
        },
        status: 'ready',
      })
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await themeRuntime.initializeTheme()
    expect(document.documentElement.dataset.themeFirstPaint).toBe('stale')
    expect(document.documentElement.dataset.themeMarketColors).toBe('theme')
    expect(document.documentElement.style.getPropertyValue('--oa-market-up')).toBe('#ab4642')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not match authoritative'))
    initialize.mockRestore()
    warn.mockRestore()
  })

  it('keeps the runtime theme usable and diagnoses unavailable cache persistence', () => {
    themeRuntime.applyThemeVariant('runtime-family', 'dark', variant)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const changed = {
      ...variant,
      id: 'runtime-changed',
      tokens: { ...variant.tokens, pageBackground: '#222222' as const },
      palette: { ...variant.palette, base00: '#222222' as const },
    }
    expect(() => themeRuntime.applyThemeVariant('changed-family', 'dark', changed)).not.toThrow()
    expect(document.documentElement.dataset.themeFamily).toBe('changed-family')
    expect(document.documentElement.dataset.themeFirstPaint).toBe('unavailable')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#222222')
    expect(localStorage.getItem('openalice.theme.first-paint.v1')).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cache persistence unavailable'), expect.anything())
    setItem.mockRestore()
    warn.mockRestore()
  })
})
