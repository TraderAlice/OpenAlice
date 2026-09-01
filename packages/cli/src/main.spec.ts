import { describe, expect, it, vi } from 'vitest'

import { main } from './main.ts'

describe('OpenAlice TypeScript application entry', () => {
  it('advertises Railway lifecycle-fence support in machine-readable version output', async () => {
    let output = ''
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    try {
      await expect(main(['version', '--json'])).resolves.toBe(0)
    } finally {
      write.mockRestore()
    }

    expect(JSON.parse(output)).toMatchObject({
      runtimeCapabilities: expect.arrayContaining(['railway-flock-v1', 'railway-runtime-lock-v2']),
    })
  })

  it('opens the Supervisor TUI for the bare command', async () => {
    const runTui = vi.fn(async () => 0)

    await expect(main([], { runTui })).resolves.toBe(0)

    expect(runTui).toHaveBeenCalledWith({})
  })

  it('keeps the explicit tui alias', async () => {
    const runTui = vi.fn(async () => 0)

    await expect(main(['tui'], { runTui })).resolves.toBe(0)

    expect(runTui).toHaveBeenCalledWith({})
  })

  it('resolves TUI launch flags before terminal startup', async () => {
    const runTui = vi.fn(async () => 0)

    await expect(main([
      '--instance', 'research',
      '--home', './isolated',
      '--port', '44000',
      '--no-update-check',
    ], { runTui })).resolves.toBe(0)

    expect(runTui).toHaveBeenCalledWith({
      instance: 'research',
      home: './isolated',
      port: 44_000,
      updateChecks: false,
    })
  })

  it('rejects unknown tui options before terminal startup', async () => {
    await expect(main(['tui', '--wat'], {
      runTui: vi.fn(async () => 0),
    })).rejects.toMatchObject({
      code: 'EUSAGE',
      exitCode: 2,
    })
  })
})
