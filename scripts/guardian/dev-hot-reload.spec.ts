import { describe, expect, it } from 'vitest'

import {
  ALICE_BACKEND_WATCH_INCLUDES,
  BACKEND_WATCH_EXCLUDES,
  UTA_BACKEND_WATCH_INCLUDES,
  buildTsxWatchArgs,
  isBackendHotReloadEnabled,
} from './dev-hot-reload.js'

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
