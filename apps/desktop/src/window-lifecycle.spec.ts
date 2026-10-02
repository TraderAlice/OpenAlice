import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { App, BrowserWindow } from 'electron'
import { describe, it } from 'vitest'

import { configureWindowLifecycle, showAppWindow } from './window-lifecycle.js'

function fixture() {
  const app = new EventEmitter()
  const calls: string[] = []
  let destroyed = false
  let minimized = false
  let quitting = false
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => { calls.push('restore'); minimized = false },
    show: () => { calls.push('show') },
    focus: () => { calls.push('focus') },
    hide: () => { calls.push('hide') },
  })
  const window = win as unknown as BrowserWindow
  configureWindowLifecycle(app as unknown as App, window, () => quitting)
  const close = () => {
    let prevented = false
    win.emit('close', { preventDefault: () => { prevented = true } })
    if (!prevented) { destroyed = true; win.emit('closed') }
    return prevented
  }
  return {
    app, win, window, calls, close,
    minimize: () => { minimized = true },
    destroy: () => { destroyed = true; win.emit('closed') },
    quit: () => { quitting = true },
  }
}

describe('desktop window lifecycle', () => {
  it('hides an ordinary close without destroying the window or quitting the app', () => {
    const f = fixture()
    let quitRequested = false
    f.app.on('before-quit', () => { quitRequested = true })

    assert.equal(f.close(), true)
    assert.equal(f.win.isDestroyed(), false)
    assert.deepEqual(f.calls, ['hide'])
    assert.equal(quitRequested, false)
  })

  it('restores the hidden window when the macOS Dock activates the app', () => {
    const f = fixture()
    f.close()
    f.app.emit('activate')

    assert.deepEqual(f.calls, ['hide', 'show', 'focus'])
    assert.equal(f.win.isDestroyed(), false)
  })

  it('restores a minimized window before showing and focusing it from the Dock', () => {
    const f = fixture()
    f.minimize()
    f.app.emit('activate')

    assert.deepEqual(f.calls, ['restore', 'show', 'focus'])
    assert.equal(f.win.isMinimized(), false)
  })

  it('uses the same restoration path for the tray', () => {
    const f = fixture()
    f.close()
    f.minimize()
    showAppWindow(f.window)

    assert.deepEqual(f.calls, ['hide', 'restore', 'show', 'focus'])
  })

  it('allows the window to close when explicit app shutdown has started', () => {
    const f = fixture()
    f.quit()

    assert.equal(f.close(), false)
    assert.equal(f.win.isDestroyed(), true)
    assert.deepEqual(f.calls, [])
  })

  it('does not reopen a window during shutdown', () => {
    const f = fixture()
    f.close()
    f.quit()
    f.app.emit('activate')

    assert.deepEqual(f.calls, ['hide'])
  })

  it('ignores destroyed windows and removes their Dock activation listener', () => {
    const f = fixture()
    assert.equal(f.app.listenerCount('activate'), 1)
    f.destroy()
    assert.equal(f.app.listenerCount('activate'), 0)

    f.app.emit('activate')
    showAppWindow(f.window)
    assert.deepEqual(f.calls, [])
  })

  it('keeps one reusable window and activation listener across repeated closes', () => {
    const f = fixture()
    for (let i = 0; i < 3; i++) {
      assert.equal(f.close(), true)
      f.app.emit('activate')
    }

    assert.equal(f.win.isDestroyed(), false)
    assert.equal(f.app.listenerCount('activate'), 1)
    assert.deepEqual(f.calls, Array.from({ length: 3 }, () => ['hide', 'show', 'focus']).flat())
  })
})
