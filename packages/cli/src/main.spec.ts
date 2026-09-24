import { describe, expect, it, vi } from 'vitest'

import { main } from './main.ts'
import { main as runLegacyCommand } from '../bin/openalice.mjs'

describe('OpenAlice TypeScript application entry', () => {
  it('rejects the retired direct browser entry points before network access', async () => {
    await expect(main(['start'])).rejects.toMatchObject({ code: 'EUSAGE', exitCode: 2 })
    await expect(main(['open'])).rejects.toMatchObject({ code: 'EUSAGE', exitCode: 2 })
    await expect(runLegacyCommand(['--remote', 'alice@example.com'])).rejects.toMatchObject({ code: 'EUSAGE', exitCode: 2 })
  })
  it('routes the browser relay without starting a Runtime or opening the TUI', async () => {
    const runRelay = vi.fn(async () => 0)
    const runTui = vi.fn(async () => 0)
    expect(await main(['relay', '--no-open'], { runRelay, runTui, standalone: true })).toBe(0)
    expect(runRelay).toHaveBeenCalledWith(['--no-open'])
    expect(runTui).not.toHaveBeenCalled()
  })
  it('routes --machine local exec through the full dispatcher', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(await main(['--machine', 'local', 'exec', '--help'])).toBe(0)
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('openalice exec'))
    } finally {
      stdout.mockRestore()
    }
  })
  it('continues native first-launch dependency installation before opening TUI', async () => {
    const calls: string[] = []
    expect(await main([], { standalone: true, runSetup: async () => { calls.push('setup'); return 0 }, runTui: async () => { calls.push('tui'); return 0 } })).toBe(0)
    expect(calls).toEqual(['setup', 'tui'])
  })

  it.each([{ argv: [] }, { argv: ['tui'] }, { argv: ['--home', '/tmp/alice'] }])('keeps the remote-capable TUI accessible after unfinished setup ($argv)', async ({ argv }) => {
    const runTui = vi.fn(async () => 0)
    expect(await main(argv, { standalone: true, runSetup: async () => 1, runTui })).toBe(0)
    expect(runTui).toHaveBeenCalled()
  })

  it.each(['status', 'down', 'version', 'doctor', 'setup', 'completion'])('does not gate %s on local dependencies', async command => {
    const runSetup = vi.fn(async () => 1)
    const runCommand = vi.fn(async () => 0)
    expect(await main([command], { standalone: true, runSetup, runCommand })).toBe(0)
    expect(runSetup).not.toHaveBeenCalled()
  })

  it.each([
    ['--remote', 'alice@example.com'],
    ['--machine', 'cloud', 'status'],
  ])('routes %s through the legacy command dispatcher without local setup', async (...argv: string[]) => {
    const runSetup = vi.fn(async () => 1)
    const runCommand = vi.fn(async () => 0)
    expect(await main(argv, { standalone: true, runSetup, runCommand })).toBe(0)
    expect(runSetup).not.toHaveBeenCalled()
    expect(runCommand).toHaveBeenCalledWith(argv)
  })

  it('keeps JSON startup noninteractive', async () => {
    const runSetup = vi.fn(async () => 1)
    const runCommand = vi.fn(async () => 0)
    expect(await main(['up', '--json'], { standalone: true, runSetup, runCommand })).toBe(1)
    expect(runSetup).toHaveBeenCalledWith(['--json'])
    expect(runCommand).not.toHaveBeenCalled()
  })

  it.each(['start', 'run'])('continues installation for compatibility server %s', async action => {
    const runSetup = vi.fn(async () => 1)
    const runCommand = vi.fn(async () => 0)
    expect(await main(['server', action], { standalone: true, runSetup, runCommand })).toBe(1)
    expect(runSetup).toHaveBeenCalledOnce()
    expect(runCommand).not.toHaveBeenCalled()
  })

  it.each(['status', 'stop', 'help'])('does not gate compatibility server %s', async action => {
    const runSetup = vi.fn(async () => 1)
    expect(await main(['server', action], { standalone: true, runSetup, runCommand: async () => 0 })).toBe(0)
    expect(runSetup).not.toHaveBeenCalled()
  })

  it('does not run setup for startup help', async () => {
    const runSetup = vi.fn(async () => 1)
    await main(['up', '--help'], { standalone: true, runSetup, runCommand: async () => 0 })
    expect(runSetup).not.toHaveBeenCalled()
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
