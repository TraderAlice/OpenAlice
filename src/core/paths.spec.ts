import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

/**
 * paths.ts reads env into module-level consts at import time, so each
 * env-sensitive test re-imports it after setting env. The helper below
 * captures the pattern.
 */
async function loadPaths(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return await import('./paths.js')
}

/**
 * Snapshot env values so each test starts from a known baseline.
 * Real CI may have these env set (e.g. via test runner) — we restore
 * exactly whatever was there before.
 */
let snapshot: { home: string | undefined; appHome: string | undefined }

beforeEach(() => {
  snapshot = {
    home: process.env['OPENALICE_HOME'],
    appHome: process.env['OPENALICE_APP_HOME'],
  }
  delete process.env['OPENALICE_HOME']
  delete process.env['OPENALICE_APP_HOME']
})

afterEach(() => {
  if (snapshot.home === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = snapshot.home
  if (snapshot.appHome === undefined) delete process.env['OPENALICE_APP_HOME']
  else process.env['OPENALICE_APP_HOME'] = snapshot.appHome
  vi.resetModules()
})

describe('dataPath', () => {
  it('joins parts under <USER_DATA_HOME>/data/', async () => {
    const { dataPath } = await loadPaths({ OPENALICE_HOME: '/tmp/oa-test' })
    expect(dataPath('config')).toBe(resolve('/tmp/oa-test', 'data', 'config'))
    expect(dataPath('brain', 'persona.md')).toBe(resolve('/tmp/oa-test', 'data', 'brain', 'persona.md'))
  })

  it('falls back to ~/.openalice when OPENALICE_HOME is unset', async () => {
    const { dataPath } = await loadPaths()
    expect(dataPath('config')).toBe(resolve(homedir(), '.openalice', 'data/config'))
  })

  it('returns the base data dir when called with no parts', async () => {
    const { dataPath } = await loadPaths({ OPENALICE_HOME: '/tmp/oa-test' })
    expect(dataPath()).toBe(resolve('/tmp/oa-test', 'data'))
  })
})

describe('defaultPath', () => {
  it('joins parts under <APP_RESOURCES_HOME>/default/', async () => {
    const { defaultPath } = await loadPaths({ OPENALICE_APP_HOME: '/Apps/OpenAlice.app/Contents/Resources' })
    expect(defaultPath('persona.default.md')).toBe(resolve('/Apps/OpenAlice.app/Contents/Resources', 'default', 'persona.default.md'))
  })

  it('falls back to process.cwd() when OPENALICE_APP_HOME is unset', async () => {
    const { defaultPath } = await loadPaths()
    expect(defaultPath('persona.default.md')).toBe(resolve(process.cwd(), 'default/persona.default.md'))
  })
})

describe('uiBundlePath', () => {
  it('resolves to <APP_RESOURCES_HOME>/ui/dist (no parts)', async () => {
    const { uiBundlePath } = await loadPaths({ OPENALICE_APP_HOME: '/foo' })
    expect(uiBundlePath()).toBe(resolve('/foo', 'ui', 'dist'))
  })

  it('falls back to cwd-relative ui/dist when unset', async () => {
    const { uiBundlePath } = await loadPaths()
    expect(uiBundlePath()).toBe(resolve(process.cwd(), 'ui/dist'))
  })
})

describe('templatesPath', () => {
  it('resolves to <APP_RESOURCES_HOME>/src/workspaces/templates', async () => {
    const { templatesPath } = await loadPaths({ OPENALICE_APP_HOME: '/foo' })
    expect(templatesPath()).toBe(resolve('/foo', 'src', 'workspaces', 'templates'))
  })

  it('falls back to cwd-relative path when unset', async () => {
    const { templatesPath } = await loadPaths()
    expect(templatesPath()).toBe(resolve(process.cwd(), 'src/workspaces/templates'))
  })
})

describe('two homes are independent', () => {
  it('setting OPENALICE_HOME does not move APP_RESOURCES_HOME', async () => {
    // The structural promise: user data and app resources are owned
    // by different lifecycle actors. Tying them together would conflate
    // upgrade-survives vs upgrade-replaces semantics.
    const { dataPath, defaultPath } = await loadPaths({ OPENALICE_HOME: '/tmp/user' })
    expect(dataPath('config')).toBe(resolve('/tmp/user', 'data', 'config'))
    expect(defaultPath('persona.default.md')).toBe(resolve(process.cwd(), 'default/persona.default.md'))
  })

  it('setting OPENALICE_APP_HOME does not move USER_DATA_HOME', async () => {
    const { dataPath, defaultPath } = await loadPaths({ OPENALICE_APP_HOME: '/tmp/resources' })
    expect(defaultPath('x')).toBe(resolve('/tmp/resources', 'default', 'x'))
    expect(dataPath('config')).toBe(resolve(homedir(), '.openalice', 'data/config'))
  })

  it('both env vars can be set together (packaged-app shape)', async () => {
    const { dataPath, defaultPath, uiBundlePath, templatesPath } = await loadPaths({
      OPENALICE_HOME: '/Users/x/Library/Application Support/OpenAlice',
      OPENALICE_APP_HOME: '/Applications/OpenAlice.app/Contents/Resources',
    })
    expect(dataPath('config')).toBe(resolve('/Users/x/Library/Application Support/OpenAlice', 'data', 'config'))
    expect(defaultPath('persona.default.md')).toBe(resolve('/Applications/OpenAlice.app/Contents/Resources', 'default', 'persona.default.md'))
    expect(uiBundlePath()).toBe(resolve('/Applications/OpenAlice.app/Contents/Resources', 'ui', 'dist'))
    expect(templatesPath()).toBe(resolve('/Applications/OpenAlice.app/Contents/Resources', 'src', 'workspaces', 'templates'))
  })
})

describe('userDataHome / appResourcesHome exports', () => {
  it('reflect the env values used by the helpers', async () => {
    const m = await loadPaths({
      OPENALICE_HOME: '/tmp/user-home',
      OPENALICE_APP_HOME: '/tmp/app-home',
    })
    expect(m.userDataHome).toBe('/tmp/user-home')
    expect(m.appResourcesHome).toBe('/tmp/app-home')
  })

  it('fall back to defaults when env unset (user data: ~/.openalice; app resources: cwd)', async () => {
    const m = await loadPaths()
    expect(m.userDataHome).toBe(resolve(homedir(), '.openalice'))
    expect(m.userDataHome).toBe(m.defaultUserDataHome)
    expect(m.appResourcesHome).toBe(process.cwd())
  })
})
