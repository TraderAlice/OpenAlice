import { describe, expect, it } from 'vitest'

import {
  ALICE_BACKEND_WATCH_INCLUDES,
  BACKEND_WATCH_EXCLUDES,
  UTA_BACKEND_WATCH_INCLUDES,
  buildTsxWatchArgs,
  isBackendHotReloadEnabled,
  resolveDevWatchEnv,
} from '../../../scripts/guardian/dev-hot-reload.ts'

describe('guardian dev backend hot reload', () => {
  it('is enabled by default', () => {
    expect(isBackendHotReloadEnabled({})).toBe(true)
  })

  it('can be disabled with OPENALICE_BACKEND_HOT_RELOAD=0', () => {
    expect(isBackendHotReloadEnabled({ OPENALICE_BACKEND_HOT_RELOAD: '0' })).toBe(false)
    expect(isBackendHotReloadEnabled({ OPENALICE_BACKEND_HOT_RELOAD: 'false' })).toBe(false)
  })

  it('builds tsx watch args with explicit backend includes', () => {
    expect(buildTsxWatchArgs('src/main.ts', ALICE_BACKEND_WATCH_INCLUDES, {})).toEqual([
      'watch',
      '--clear-screen=false',
      '--include',
      'src',
      '--include',
      'packages',
      ...BACKEND_WATCH_EXCLUDES.flatMap((path) => ['--exclude', path]),
      'src/main.ts',
    ])

    expect(buildTsxWatchArgs('services/uta/src/main.ts', UTA_BACKEND_WATCH_INCLUDES, {})).toEqual([
      'watch',
      '--clear-screen=false',
      '--include',
      'services/uta/src',
      '--include',
      'packages',
      ...BACKEND_WATCH_EXCLUDES.flatMap((path) => ['--exclude', path]),
      'services/uta/src/main.ts',
    ])
  })

  it('falls back to one-shot tsx execution when disabled', () => {
    expect(buildTsxWatchArgs('src/main.ts', ALICE_BACKEND_WATCH_INCLUDES, {
      OPENALICE_BACKEND_HOT_RELOAD: 'off',
    })).toEqual(['src/main.ts'])
  })
})

describe('guardian dev watch environment fallback', () => {
  it('skips probing on non-darwin platforms', async () => {
    let probed = false
    const result = await resolveDevWatchEnv({}, {
      platform: 'linux',
      probe: async () => { probed = true; return false },
    })
    expect(probed).toBe(false)
    expect(result).toEqual({ viteEnv: {}, backendEnv: {} })
  })

  it('respects explicit caller watch overrides without probing', async () => {
    let probed = false
    const probe = async () => { probed = true; return false }
    expect(await resolveDevWatchEnv({ CHOKIDAR_USEPOLLING: '0' }, { platform: 'darwin', probe }))
      .toEqual({ viteEnv: {}, backendEnv: {} })
    expect(await resolveDevWatchEnv({ OPENALICE_VITE_USE_FSEVENTS: '1' }, { platform: 'darwin', probe }))
      .toEqual({ viteEnv: {}, backendEnv: {} })
    expect(probed).toBe(false)
  })

  it('keeps defaults when fsevents is working on darwin', async () => {
    const result = await resolveDevWatchEnv({}, {
      platform: 'darwin',
      probe: async () => true,
    })
    expect(result).toEqual({ viteEnv: {}, backendEnv: {} })
  })

  it('falls back to fs.watch for Vite and polling for backend watch when fsevents is unavailable', async () => {
    const result = await resolveDevWatchEnv({}, {
      platform: 'darwin',
      probe: async () => false,
    })
    expect(result.viteEnv).toEqual({ OPENALICE_VITE_USE_FSEVENTS: '0' })
    expect(result.backendEnv).toEqual({ CHOKIDAR_USEPOLLING: '1', CHOKIDAR_INTERVAL: '300' })
    expect(result.diagnostic).toContain('fsevents unavailable')
  })
})
