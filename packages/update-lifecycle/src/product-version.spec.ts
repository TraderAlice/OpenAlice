import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let root: string
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('__OPENALICE_BUILD_VERSION__', undefined)
  root = mkdtempSync(join(tmpdir(), 'openalice-product-'))
  vi.stubEnv('OPENALICE_APP_HOME', root)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })

it('uses compiled product identity even when another resource manifest is present', async () => {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'open-alice', version: '0.1.0' }))
  vi.stubGlobal('__OPENALICE_BUILD_VERSION__', '0.94.1')
  expect((await import('./product-version.js')).getProductVersion()).toBe('0.94.1')
})

it('retains the running identity when resources are replaced after startup', async () => {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'open-alice', version: '0.94.1' }))
  const { getProductVersion } = await import('./product-version.js')
  expect(getProductVersion()).toBe('0.94.1')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'open-alice', version: '0.95.0' }))
  expect(getProductVersion()).toBe('0.94.1')
})

it.each([{ name: '@traderalice/desktop', version: '0.1.0' }, { name: 'open-alice', version: 'garbage' }, { name: 'open-alice' }])('refuses unrelated or unavailable product identity: %j', async value => {
  writeFileSync(join(root, 'package.json'), JSON.stringify(value))
  expect((await import('./product-version.js')).getProductVersion).toThrow('product identity is unavailable')
})

it('does not turn a missing explicit product manifest into a source fallback', async () => {
  expect((await import('./product-version.js')).getProductVersion).toThrow()
})

it('uses the root product manifest for source execution', async () => {
  vi.stubEnv('OPENALICE_APP_HOME', '')
  const expected = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version
  expect((await import('./product-version.js')).getProductVersion()).toBe(expected)
})

it('does not fall back from malformed compiled identity to a valid source manifest', async () => {
  vi.stubGlobal('__OPENALICE_BUILD_VERSION__', 'unknown')
  expect((await import('./product-version.js')).getProductVersion).toThrow('Invalid compiled')
})
