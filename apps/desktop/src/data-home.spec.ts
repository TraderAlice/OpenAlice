import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DataHomeUnavailableError,
  OverlappingDataHomesError,
  assertSeparateDataHomes,
  dedupeRecentDataHomes,
  defaultDataHomePreferences,
  parseDataHomePreferences,
  prepareDataHome,
  readDataHomePreferences,
  rememberDataHome,
  resolveDataHomeSelectionLock,
  setAskForDataHomeOnStartup,
  shouldAskForDataHomeAtStartup,
  writeDataHomePreferences,
} from './data-home.js'

describe('desktop data-home preferences', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openalice-data-home-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('recovers from a missing or malformed launcher preference', async () => {
    const path = join(root, 'launcher', 'data-home.json')
    expect(await readDataHomePreferences(path)).toEqual(defaultDataHomePreferences())

    await mkdir(join(root, 'launcher'), { recursive: true })
    await writeFile(path, '{broken')
    expect(await readDataHomePreferences(path)).toEqual(defaultDataHomePreferences())
  })

  it('normalizes, bounds, and de-duplicates recent locations', () => {
    const homes = Array.from({ length: 10 }, (_, index) => resolve(root, String(index)))
    expect(dedupeRecentDataHomes([homes[0], homes[0], ...homes])).toEqual(homes.slice(0, 8))
    expect(dedupeRecentDataHomes(['/Alice', '/alice'], 'win32')).toEqual([resolve('/Alice')])
  })

  it('ignores relative and invalid persisted paths', () => {
    expect(parseDataHomePreferences({
      version: 99,
      selectedHome: 'relative/home',
      recentHomes: ['another/relative/home', resolve(root, 'valid')],
      askOnStartup: 'yes',
      startupPromptCompleted: true,
    })).toEqual({
      version: 1,
      selectedHome: null,
      recentHomes: [resolve(root, 'valid')],
      askOnStartup: false,
      startupPromptCompleted: true,
    })
  })

  it('writes preferences atomically and keeps the newest home first', async () => {
    const path = join(root, 'launcher', 'data-home.json')
    const first = resolve(root, 'first')
    const second = resolve(root, 'second')
    let preference = rememberDataHome(defaultDataHomePreferences(), first, { startupPromptCompleted: true })
    preference = rememberDataHome(preference, second)
    preference = setAskForDataHomeOnStartup(preference, true)

    await writeDataHomePreferences(path, preference)

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      selectedHome: second,
      recentHomes: [second, first],
      askOnStartup: true,
      startupPromptCompleted: true,
    })
    expect(await readDataHomePreferences(path)).toEqual(preference)

    const updated = setAskForDataHomeOnStartup(preference, false)
    await writeDataHomePreferences(path, updated)
    expect(await readDataHomePreferences(path)).toEqual(updated)
  })

  it('keeps environment-owned roots out of the desktop selection flow', () => {
    expect(resolveDataHomeSelectionLock({ OPENALICE_HOME: '/tmp/alice' })).toBe('openalice-home-env')
    expect(resolveDataHomeSelectionLock({ AQ_LAUNCHER_ROOT: '/tmp/workspaces' })).toBe('workspace-root-env')
    expect(resolveDataHomeSelectionLock({})).toBeNull()
  })

  it('asks on fresh install or explicit opt-in, but not during legacy relocation', () => {
    const fresh = defaultDataHomePreferences()
    expect(shouldAskForDataHomeAtStartup({
      preferences: fresh,
      selectionLock: null,
      legacyDataPresent: false,
      defaultHomeHasState: false,
    })).toBe(true)
    expect(shouldAskForDataHomeAtStartup({
      preferences: { ...fresh, askOnStartup: true, startupPromptCompleted: true },
      selectionLock: null,
      legacyDataPresent: false,
      defaultHomeHasState: true,
    })).toBe(true)
    expect(shouldAskForDataHomeAtStartup({
      preferences: fresh,
      selectionLock: null,
      legacyDataPresent: true,
      defaultHomeHasState: false,
    })).toBe(false)
    expect(shouldAskForDataHomeAtStartup({
      preferences: fresh,
      selectionLock: 'openalice-home-env',
      legacyDataPresent: false,
      defaultHomeHasState: false,
    })).toBe(false)
  })

  it('creates and canonicalizes a new writable home', async () => {
    const target = join(root, 'new-home')
    const prepared = await prepareDataHome(target, { create: true })
    expect(prepared).toEqual({ path: await import('node:fs/promises').then(({ realpath }) => realpath(target)), contents: 'empty' })
  })

  it('recognizes existing OpenAlice homes and unrelated non-empty directories', async () => {
    const home = join(root, 'existing-home')
    const unrelated = join(root, 'unrelated')
    const genericData = join(root, 'generic-data')
    await mkdir(join(home, 'data', 'config'), { recursive: true })
    await mkdir(unrelated, { recursive: true })
    await mkdir(join(genericData, 'data'), { recursive: true })
    await writeFile(join(unrelated, 'notes.txt'), 'not OpenAlice')

    expect((await prepareDataHome(home)).contents).toBe('openalice-home')
    expect((await prepareDataHome(unrelated)).contents).toBe('nonempty')
    expect((await prepareDataHome(genericData)).contents).toBe('nonempty')
  })

  it('does not recreate a remembered location that disappeared', async () => {
    const missing = join(root, 'removed-drive', 'home')
    await expect(prepareDataHome(missing)).rejects.toBeInstanceOf(DataHomeUnavailableError)
  })

  it('resolves symlink aliases to one physical location', async () => {
    const actual = join(root, 'actual')
    const alias = join(root, 'alias')
    await mkdir(actual)
    await symlink(actual, alias, 'dir')

    expect((await prepareDataHome(alias)).path).toBe((await prepareDataHome(actual)).path)
  })

  it('rejects nested homes while allowing siblings and the current home', () => {
    const current = resolve(root, 'current')
    expect(() => assertSeparateDataHomes(current, current)).not.toThrow()
    expect(() => assertSeparateDataHomes(current, resolve(root, 'sibling'))).not.toThrow()
    expect(() => assertSeparateDataHomes(current, join(current, 'nested')))
      .toThrow(OverlappingDataHomesError)
    expect(() => assertSeparateDataHomes(join(current, 'nested'), current))
      .toThrow(OverlappingDataHomesError)
  })
})
