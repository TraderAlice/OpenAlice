import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAutoUpdateCapability } from './auto-update-policy.js'

describe('resolveAutoUpdateCapability', () => {
  it('stays disabled in Electron development mode', () => {
    expect(resolveAutoUpdateCapability({
      isPackaged: false,
      resourcesPath: '/unused/resources',
    })).toEqual({
      enabled: false,
      reason: 'not-packaged',
      configPath: null,
    })
  })

  it('treats a packaged directory without update metadata as non-updatable', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'openalice-updater-missing-'))
    try {
      expect(resolveAutoUpdateCapability({ isPackaged: true, resourcesPath })).toEqual({
        enabled: false,
        reason: 'missing-config',
        configPath: join(resourcesPath, 'app-update.yml'),
      })
    } finally {
      rmSync(resourcesPath, { recursive: true, force: true })
    }
  })

  it('enables updates only when packaged metadata exists', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'openalice-updater-ready-'))
    try {
      const configPath = join(resourcesPath, 'app-update.yml')
      writeFileSync(configPath, 'provider: generic\nurl: https://download.openalice.ai/\n')

      expect(resolveAutoUpdateCapability({ isPackaged: true, resourcesPath })).toEqual({
        enabled: true,
        configPath,
      })
    } finally {
      rmSync(resourcesPath, { recursive: true, force: true })
    }
  })
})
