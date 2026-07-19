import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Terminal } from '@xterm/xterm'

// Observe construction/load/dispose instead of real WebGL (jsdom has none).
const disposeSpy = vi.fn()
const onContextLossSpy = vi.fn()
let constructed = 0
let throwOnLoad = false

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss = onContextLossSpy
    dispose = disposeSpy
    constructor() {
      constructed++
    }
  },
}))

const { attachWebglRenderer } = await import('../renderer')

function fakeTerm(): Terminal {
  return {
    loadAddon: vi.fn(() => {
      if (throwOnLoad) throw new Error('no webgl context')
    }),
  } as unknown as Terminal
}

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  constructed = 0
  throwOnLoad = false
})

describe('attachWebglRenderer', () => {
  it('loads the WebGL addon by default and returns it', () => {
    const term = fakeTerm()
    const addon = attachWebglRenderer(term)
    expect(constructed).toBe(1)
    expect(term.loadAddon).toHaveBeenCalledTimes(1)
    expect(addon).not.toBeNull()
  })

  it('escape hatch: renderer=dom skips WebGL without constructing the addon', () => {
    localStorage.setItem('openalice.terminal.renderer', 'dom')
    const term = fakeTerm()
    expect(attachWebglRenderer(term)).toBeNull()
    expect(constructed).toBe(0)
    expect(term.loadAddon).not.toHaveBeenCalled()
  })

  it('lets OpenTUI callers force the DOM renderer without mutating preferences', () => {
    const term = fakeTerm()
    expect(attachWebglRenderer(term, true)).toBeNull()
    expect(constructed).toBe(0)
    expect(term.loadAddon).not.toHaveBeenCalled()
  })

  it('any other flag value keeps the WebGL default', () => {
    localStorage.setItem('openalice.terminal.renderer', 'webgl')
    expect(attachWebglRenderer(fakeTerm())).not.toBeNull()
    expect(constructed).toBe(1)
  })

  it('degrades to null and disposes the addon when loading throws', () => {
    throwOnLoad = true
    expect(attachWebglRenderer(fakeTerm())).toBeNull()
    expect(constructed).toBe(1)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })
})
