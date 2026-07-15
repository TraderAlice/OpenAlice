import { describe, expect, it, vi } from 'vitest'

import {
  formatMissingRuntimeBuildTools,
  inspectRuntimeBuildTools,
  runtimeBuildToolsError,
} from './runtime-deps.mjs'

describe('OpenAlice source Runtime build tools', () => {
  it('accepts alternative C++ compiler commands', async () => {
    const available = new Set(['git', 'python3', 'make', 'clang++'])
    const commandAvailable = vi.fn(async (command) => available.has(command))

    await expect(inspectRuntimeBuildTools({
      platform: 'linux',
      commandAvailable,
    })).resolves.toEqual({ platform: 'linux', supported: true, missing: [] })
    expect(commandAvailable).toHaveBeenCalledWith('clang++', expect.any(Object))
  })

  it('reports stable user-facing labels and platform guidance', async () => {
    const report = await inspectRuntimeBuildTools({
      platform: 'linux',
      commandAvailable: async (command) => command === 'git',
    })
    expect(report.missing).toEqual(['python3', 'make', 'cxx'])
    expect(formatMissingRuntimeBuildTools(report.missing)).toBe('Python 3, make, a C++ compiler')
    expect(runtimeBuildToolsError(report)).toContain('--with-runtime-deps')
  })
})
