import { dialog, shell } from 'electron'
import { homedir } from 'node:os'

import {
  assertSeparateDataHomes,
  defaultDataHomePreferences,
  hasExistingOpenAliceHome,
  prepareDataHome,
  readDataHomePreferences,
  rememberDataHome,
  resolveDataHomeSelectionLock,
  setAskForDataHomeOnStartup,
  shouldAskForDataHomeAtStartup,
  writeDataHomePreferences,
  type DataHomePreferences,
  type DataHomeSelectionLock,
  type DataHomeSource,
  type PreparedDataHome,
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

  let preferences = await readDataHomePreferences(options.preferencePath)
  let selected: PreparedDataHome | null = null
  let source: DataHomeSource = 'default'
  let selectedDefault = false
  let recoveredUnavailableSelection = false
  if (preferences.selectedHome) {
    try {
      selected = await prepareDataHome(preferences.selectedHome)
      source = 'desktop-preference'
    } catch (error) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'OpenAlice data location is unavailable',
        message: 'The previously selected data location cannot be opened.',
        detail: `${preferences.selectedHome}\n\n${dataHomeErrorDetail(error)}\n\nOpenAlice will not create an empty replacement at a missing saved path.`,
        buttons: ['Choose another folder', 'Use default location', 'Quit'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      if (response === 2) return null
      if (response === 0) {
        selected = await chooseDataHomeDirectory()
        if (!selected) return null
        source = 'desktop-preference'
      } else {
        selected = await prepareDataHome(options.defaultHome, { create: true })
        source = 'default'
        selectedDefault = true
      }
      recoveredUnavailableSelection = true
    }
  }

  const shouldAsk = !recoveredUnavailableSelection && shouldAskForDataHomeAtStartup({
    preferences,
    selectionLock,
    legacyDataPresent: options.legacyDataPresent,
    defaultHomeHasState: hasExistingOpenAliceHome(options.defaultHome),
  })
  if (shouldAsk) {
    const currentLabel = selected ? 'Use current location' : 'Use default location'
    const currentPath = selected?.path ?? options.defaultHome
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Choose where OpenAlice works',
      message: preferences.askOnStartup
        ? 'Which data location should this OpenAlice instance use?'
        : 'Choose an OpenAlice data location before the first Workspace opens.',
      detail: `${currentPath}\n\nEach location owns its data, Workspaces, credentials, Broker Packs, and runtime locks. Separate locations can run concurrently.`,
      buttons: [currentLabel, 'Choose another folder', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    if (response === 2) return null
    if (response === 1) {
      const chosen = await chooseDataHomeDirectory(selected?.path)
      if (!chosen) return null
      selected = chosen
      source = 'desktop-preference'
      selectedDefault = false
    } else if (!selected) {
      selected = await prepareDataHome(options.defaultHome, { create: true })
      source = 'default'
      selectedDefault = true
    }
  }

  if (!selected) {
    selected = await prepareDataHome(options.defaultHome, { create: true })
    source = 'default'
    selectedDefault = true
  }

  preferences = rememberDataHome(preferences, selected.path, { startupPromptCompleted: true })
  await writeDataHomePreferences(options.preferencePath, preferences)
  return {
    home: selected.path,
    source,
    selectedDefault,
    selectionLock,
    preferences,
  }
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
  let preferences = options.initialPreferences
  const getStatus = (): OpenAliceDataHomeStatus => ({
    currentHome: options.currentHome,
    defaultHome: options.defaultHome,
    source: options.source,
    recentHomes: preferences.recentHomes,
    askOnStartup: preferences.askOnStartup,
    selectionLocked: options.selectionLock !== null,
    selectionLock: options.selectionLock,
  })
  const restartWith = async (prepared: PreparedDataHome): Promise<OpenAliceDataHomeActionResult> => {
    if (options.selectionLock !== null) return { outcome: 'locked', status: getStatus() }
    assertSeparateDataHomes(options.currentHome, prepared.path)
    if (prepared.path === options.currentHome) return { outcome: 'unchanged', status: getStatus() }
    preferences = rememberDataHome(preferences, prepared.path, { startupPromptCompleted: true })
    await writeDataHomePreferences(options.preferencePath, preferences)
    options.requestRelaunch()
    return { outcome: 'restarting', status: getStatus() }
  }

  return {
    getStatus,
    chooseAndRestart: async () => {
      if (options.selectionLock !== null) return { outcome: 'locked', status: getStatus() }
      const prepared = await chooseDataHomeDirectory(options.currentHome)
      if (!prepared) return { outcome: 'cancelled', status: getStatus() }
      return restartWith(prepared)
    },
    useRecentAndRestart: async (path) => {
      if (options.selectionLock !== null) return { outcome: 'locked', status: getStatus() }
      if (!preferences.recentHomes.includes(path)) throw new Error('That data location is not in the recent list.')
      return restartWith(await prepareDataHome(path))
    },
    setAskOnStartup: async (enabled) => {
      if (options.selectionLock !== null) return getStatus()
      preferences = setAskForDataHomeOnStartup(preferences, enabled)
      await writeDataHomePreferences(options.preferencePath, preferences)
      return getStatus()
    },
    openCurrent: () => shell.openPath(options.currentHome),
  }
}
