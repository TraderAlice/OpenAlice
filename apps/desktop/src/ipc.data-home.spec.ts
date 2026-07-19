import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  readKeyboardInputSourceId: vi.fn(async () => 'com.tencent.inputmethod.wetype.pinyin'),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }),
    on: vi.fn(),
  },
}))

vi.mock('./keyboard-input-source.js', () => ({
  readKeyboardInputSourceId: mocks.readKeyboardInputSourceId,
}))

import {
  registerOpenAliceIpc,
  type OpenAliceDataHomeController,
  type OpenAliceDataHomeStatus,
} from './ipc.js'

const status: OpenAliceDataHomeStatus = {
  currentHome: '/tmp/openalice-a',
  defaultHome: '/Users/alice/.openalice',
  source: 'desktop-preference',
  recentHomes: ['/tmp/openalice-a', '/tmp/openalice-b'],
  askOnStartup: false,
  selectionLocked: false,
  selectionLock: null,
}

function register() {
  const dataHome: OpenAliceDataHomeController = {
    getStatus: vi.fn(() => status),
    chooseAndRestart: vi.fn(async () => ({ outcome: 'restarting', status })),
    useRecentAndRestart: vi.fn(async () => ({ outcome: 'restarting', status })),
    setAskOnStartup: vi.fn(async () => ({ ...status, askOnStartup: true })),
    openCurrent: vi.fn(async () => ''),
  }
  registerOpenAliceIpc({
    mode: 'electron-packaged',
    userDataHome: status.currentHome,
    appHome: '/Applications/OpenAlice.app',
    webPort: null,
    mcpPort: null,
    utaPort: null,
    getAliceProcess: () => null,
    dataHome,
  })
  return dataHome
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
})

describe('OpenAlice data-home IPC', () => {
  it('exposes the bounded keyboard input-source probe', async () => {
    register()

    await expect(mocks.handlers.get('openalice:keyboard:get-input-source-id')?.(null))
      .resolves.toBe('com.tencent.inputmethod.wetype.pinyin')
    expect(mocks.readKeyboardInputSourceId).toHaveBeenCalledOnce()
  })

  it('exposes only the bounded data-home operations', async () => {
    const controller = register()

    expect(await mocks.handlers.get('openalice:data-home:get-status')?.(null)).toEqual(status)
    expect(await mocks.handlers.get('openalice:data-home:choose-and-restart')?.(null))
      .toEqual({ outcome: 'restarting', status })
    expect(await mocks.handlers.get('openalice:data-home:open-current')?.(null)).toBe('')
    expect(controller.chooseAndRestart).toHaveBeenCalledOnce()
    expect(controller.openCurrent).toHaveBeenCalledOnce()
  })

  it('validates renderer values before passing them to the controller', async () => {
    const controller = register()
    const useRecent = mocks.handlers.get('openalice:data-home:use-recent-and-restart')!
    const setAsk = mocks.handlers.get('openalice:data-home:set-ask-on-startup')!

    expect(() => useRecent(null, '')).toThrow('invalid data-home path')
    expect(() => useRecent(null, 42)).toThrow('invalid data-home path')
    await expect(useRecent(null, '/tmp/openalice-b')).resolves.toEqual({ outcome: 'restarting', status })
    expect(controller.useRecentAndRestart).toHaveBeenCalledWith('/tmp/openalice-b')

    expect(() => setAsk(null, 'true')).toThrow('invalid ask-on-startup value')
    await expect(setAsk(null, true)).resolves.toMatchObject({ askOnStartup: true })
    expect(controller.setAskOnStartup).toHaveBeenCalledWith(true)
  })
})
