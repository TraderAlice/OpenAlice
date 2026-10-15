import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
  showErrorBox: vi.fn(),
  openPath: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electron.showOpenDialog,
    showMessageBox: electron.showMessageBox,
    showErrorBox: electron.showErrorBox,
  },
  shell: { openPath: electron.openPath },
}))

import {
  createDesktopDataHomeController,
  resolveDesktopDataHome,
} from '../../../apps/desktop/src/data-home-desktop.js'
import {
  defaultDataHomePreferences,
  readDataHomePreferences,
  rememberDataHome,
  setAskForDataHomeOnStartup,
  writeDataHomePreferences,
} from '../../../apps/desktop/src/data-home.js'

describe('desktop data-home orchestration', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openalice-data-home-desktop-'))
    electron.showOpenDialog.mockReset()
    electron.showMessageBox.mockReset()
    electron.showErrorBox.mockReset()
    electron.openPath.mockReset().mockResolvedValue('')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('does not read real launcher preferences for an explicit automation home', async () => {
    const unreadablePreference = join(root, 'preference-is-a-directory')
    await mkdir(unreadablePreference)

    const result = await resolveDesktopDataHome({
      defaultHome: join(root, 'default'),
      explicitHome: join(root, 'smoke-home'),
      legacyDataPresent: false,
      preferencePath: unreadablePreference,
      env: { OPENALICE_HOME: join(root, 'smoke-home') },
    })

    expect(result).toMatchObject({
      source: 'environment',
      selectionLock: 'openalice-home-env',
      preferences: defaultDataHomePreferences(),
    })
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })

  it('routes saved selection through the shared chooser without reading or rewriting native preferences', async () => {
    const preferencePath = join(root, 'launcher.json')
    const preferences = rememberDataHome(defaultDataHomePreferences(), join(root, 'missing'))
    await writeDataHomePreferences(preferencePath, preferences)
    await expect(resolveDesktopDataHome({ defaultHome: join(root, 'default'), legacyDataPresent: false, preferencePath, env: {} })).rejects.toThrow('registered AliceProject')
    expect(await readDataHomePreferences(preferencePath)).toEqual(preferences)
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })

  it('keeps legacy controller methods from saving a competing startup policy', async () => {
    const preferencePath = join(root, 'launcher.json')
    const preferences = rememberDataHome(defaultDataHomePreferences(), join(root, 'old'))
    await writeDataHomePreferences(preferencePath, preferences)
    const requestRelaunch = vi.fn()
    const controller = createDesktopDataHomeController({ currentHome: join(root, 'current'), defaultHome: join(root, 'default'), source: 'desktop-preference', selectionLock: null, preferencePath, initialPreferences: preferences, requestRelaunch })
    expect(controller.getStatus()).toMatchObject({ recentHomes: [], askOnStartup: false })
    await expect(controller.chooseAndRestart()).rejects.toThrow('registered AliceProject')
    await expect(controller.useRecentAndRestart(join(root, 'old'))).rejects.toThrow('registered AliceProject')
    await expect(controller.setAskOnStartup(true)).rejects.toThrow('shared Default')
    expect(await readDataHomePreferences(preferencePath)).toEqual(preferences)
    expect(requestRelaunch).not.toHaveBeenCalled()
  })
})
