import { dialog, shell } from 'electron'
import { homedir } from 'node:os'

import {
  assertSeparateDataHomes, defaultDataHomePreferences, prepareDataHome,
  resolveDataHomeSelectionLock, type DataHomePreferences, type DataHomeSelectionLock,
  type DataHomeSource, type PreparedDataHome,
} from './data-home.js'
import type {
  OpenAliceDataHomeActionResult,
  OpenAliceDataHomeController,
  OpenAliceDataHomeStatus,
} from './ipc.js'

export interface ResolvedDesktopDataHome {
  readonly home: string
  readonly source: DataHomeSource
  readonly selectedDefault: boolean
  readonly selectionLock: DataHomeSelectionLock
  readonly preferences: DataHomePreferences
}
export function dataHomeErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function chooseDataHomeDirectory(currentHome?: string): Promise<PreparedDataHome | null> {
  const selection = await dialog.showOpenDialog({
    title: 'Choose an OpenAlice data location',
    buttonLabel: 'Use this folder',
    defaultPath: currentHome ?? homedir(),
    properties: ['openDirectory', 'createDirectory'],
    message: 'OpenAlice keeps data, Workspaces, runtime locks, credentials, and optional Broker Packs together.',
  })
  const requested = selection.filePaths[0]
  if (selection.canceled || !requested) return null

  try {
    const prepared = await prepareDataHome(requested)
    if (currentHome) assertSeparateDataHomes(currentHome, prepared.path)
    if (prepared.contents === 'nonempty') {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Use a non-empty folder?',
        message: 'This folder contains files that do not look like an OpenAlice data location.',
        detail: `${prepared.path}\n\nOpenAlice will keep those files and create its own data beside them. A dedicated empty folder is safer.`,
        buttons: ['Choose another folder', 'Use this folder'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (response !== 1) return null
    }
    return prepared
  } catch (error) {
    dialog.showErrorBox(
      'OpenAlice — data location unavailable',
      `${dataHomeErrorDetail(error)}\n\nChoose an existing local folder that OpenAlice can read and write.`,
    )
    return null
  }
}

export async function resolveDesktopDataHome(options: {
  readonly defaultHome: string
  readonly explicitHome?: string
  readonly legacyDataPresent: boolean
  readonly preferencePath: string
  readonly env?: NodeJS.ProcessEnv
}): Promise<ResolvedDesktopDataHome | null> {
  const selectionLock = resolveDataHomeSelectionLock(options.env ?? process.env)

  // Explicit automation and package-smoke homes must not even read the real
  // desktop launcher preference. This keeps isolated tests isolated.
  if (options.explicitHome) {
    const prepared = await prepareDataHome(options.explicitHome, { create: true })
    return {
      home: prepared.path,
      source: 'environment',
      selectedDefault: false,
      selectionLock,
      preferences: defaultDataHomePreferences(),
    }
  }

  throw new Error('Choose a registered AliceProject from the startup chooser.')
}

export function createDesktopDataHomeController(options: {
  readonly currentHome: string
  readonly defaultHome: string
  readonly source: DataHomeSource
  readonly selectionLock: DataHomeSelectionLock
  readonly preferencePath: string
  readonly initialPreferences: DataHomePreferences
  readonly requestRelaunch: () => void
}): OpenAliceDataHomeController {
  const getStatus = (): OpenAliceDataHomeStatus => ({
    currentHome: options.currentHome, defaultHome: options.defaultHome,
    source: options.source, recentHomes: [], askOnStartup: false,
    selectionLocked: options.selectionLock !== null, selectionLock: options.selectionLock,
  })
  return {
    getStatus,
    chooseAndRestart: async () => { throw new Error('Choose a registered AliceProject in Where Alice is working.') },
    useRecentAndRestart: async () => { throw new Error('Choose a registered AliceProject in Where Alice is working.') },
    setAskOnStartup: async () => { throw new Error('Startup uses the shared Default AliceProject.') },
    openCurrent: () => shell.openPath(options.currentHome),
  }
}
