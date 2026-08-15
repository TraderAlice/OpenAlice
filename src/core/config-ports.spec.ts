import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ports.json is a pin, not a seedable default. config.ts resolves CONFIG_DIR
 * at import, so each test re-imports under a fresh temp OPENALICE_HOME.
 */
let home: string
let configDir: string
let savedHome: string | undefined
let savedWebPort: string | undefined

async function loadConfigModule() {
  vi.resetModules()
  process.env['OPENALICE_HOME'] = home
  return import('./config.js')
}

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  savedWebPort = process.env['OPENALICE_WEB_PORT']
  delete process.env['OPENALICE_WEB_PORT']
  home = await mkdtemp(join(tmpdir(), 'oa-ports-'))
  configDir = join(home, 'data', 'config')
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  if (savedWebPort === undefined) delete process.env['OPENALICE_WEB_PORT']
  else process.env['OPENALICE_WEB_PORT'] = savedWebPort
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
})

describe('ports.json first-boot pin contract', () => {
  it('does not seed ports.json and keeps the Guardian default in memory', async () => {
    const { loadConfig, DEFAULT_WEB_PORT } = await loadConfigModule()
    const config = await loadConfig()
    expect(DEFAULT_WEB_PORT).toBe(47331)
    expect(config.ports.web).toBe(47331)
    expect(existsSync(join(configDir, 'ports.json'))).toBe(false)
  })

  it('does not persist OPENALICE_WEB_PORT into ports.json', async () => {
    process.env['OPENALICE_WEB_PORT'] = '41000'
    const { loadConfig } = await loadConfigModule()
    const config = await loadConfig()
    expect(config.ports.web).toBe(41000)
    expect(existsSync(join(configDir, 'ports.json'))).toBe(false)
  })

  it('honors a shipped { "web": 3002 } pin without rewriting it', async () => {
    await mkdir(configDir, { recursive: true })
    const path = join(configDir, 'ports.json')
    await writeFile(path, '{\n  "web": 3002\n}\n')
    const { loadConfig } = await loadConfigModule()
    const config = await loadConfig()
    expect(config.ports.web).toBe(3002)
    expect(await readFile(path, 'utf8')).toBe('{\n  "web": 3002\n}\n')
  })
})
