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
} from './data-home-desktop.js'
import {
  defaultDataHomePreferences,
  readDataHomePreferences,
  rememberDataHome,
  setAskForDataHomeOnStartup,
  writeDataHomePreferences,
} from './data-home.js'

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

  it('offers one first-start choice and remembers the default', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })
    const preferencePath = join(root, 'launcher', 'data-home.json')
    const defaultHome = join(root, 'default')

    const result = await resolveDesktopDataHome({
      defaultHome,
      legacyDataPresent: false,
      preferencePath,
      env: {},
    })

    expect(result).toMatchObject({ source: 'default', selectedDefault: true })
    expect(electron.showMessageBox).toHaveBeenCalledOnce()
    expect(await readDataHomePreferences(preferencePath)).toMatchObject({
      selectedHome: result?.home,
      startupPromptCompleted: true,
    })
  })

  it('does not show a second startup prompt after recovering a missing saved location', async () => {
    const preferencePath = join(root, 'launcher', 'data-home.json')
    let preference = rememberDataHome(defaultDataHomePreferences(), join(root, 'missing'), {
      startupPromptCompleted: true,
    })
    preference = setAskForDataHomeOnStartup(preference, true)
    await writeDataHomePreferences(preferencePath, preference)
    electron.showMessageBox.mockResolvedValue({ response: 1 })

    const result = await resolveDesktopDataHome({
      defaultHome: join(root, 'default'),
      legacyDataPresent: false,
      preferencePath,
      env: {},
    })

    expect(result).toMatchObject({ source: 'default', selectedDefault: true })
    expect(electron.showMessageBox).toHaveBeenCalledOnce()
  })

  it('keeps an environment-locked controller read-only', async () => {
    const controller = createDesktopDataHomeController({
      currentHome: join(root, 'current'),
      defaultHome: join(root, 'default'),
      source: 'environment',
      selectionLock: 'openalice-home-env',
      preferencePath: join(root, 'must-not-be-written.json'),
      initialPreferences: defaultDataHomePreferences(),
      requestRelaunch: vi.fn(),
    })

    await expect(controller.chooseAndRestart()).resolves.toMatchObject({ outcome: 'locked' })
    await expect(controller.setAskOnStartup(true)).resolves.toMatchObject({ askOnStartup: false })
    expect(electron.showOpenDialog).not.toHaveBeenCalled()
  })

  it('validates a recent location, persists it, and requests one relaunch', async () => {
    const currentHome = join(root, 'current')
    const recentHome = join(root, 'recent')
    await mkdir(currentHome)
    await mkdir(recentHome)
    const preferencePath = join(root, 'launcher', 'data-home.json')
    const initialPreferences = rememberDataHome(
      rememberDataHome(defaultDataHomePreferences(), recentHome),
      currentHome,
    )
    const requestRelaunch = vi.fn()
    const controller = createDesktopDataHomeController({
      currentHome,
      defaultHome: join(root, 'default'),
      source: 'desktop-preference',
      selectionLock: null,
      preferencePath,
      initialPreferences,
      requestRelaunch,
    })

    await expect(controller.useRecentAndRestart(recentHome))
      .resolves.toMatchObject({ outcome: 'restarting' })
    expect(requestRelaunch).toHaveBeenCalledOnce()
    expect(await readDataHomePreferences(preferencePath))
      .toMatchObject({ selectedHome: await realpath(recentHome) })
  })
})
