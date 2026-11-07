import { describe, expect, it } from 'vitest'

import { composePnpmCommand, runPnpmSync } from '../../../scripts/pnpm-command.mjs'

describe('composePnpmCommand', () => {
  it('uses a direct shell-free pnpm invocation on POSIX', () => {
    expect(composePnpmCommand(['electron:build'], { platform: 'darwin' })).toEqual({
      command: 'pnpm',
      args: ['electron:build'],
      windowsVerbatimArguments: false,
    })
  })

  it('routes the Corepack pnpm.cmd shim through ComSpec on Windows', () => {
    expect(composePnpmCommand(
      ['-F', '@traderalice/desktop', 'exec', 'electron-builder'],
      { platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } },
    )).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'pnpm.cmd "-F" "@traderalice/desktop" "exec" "electron-builder"',
      ],
      windowsVerbatimArguments: true,
    })
  })

  it('keeps a Windows deploy target with spaces in one cmd argument', () => {
    const spec = composePnpmCommand(
      ['deploy', '--prod', 'C:\\Users\\Alice Dev\\broker pack'],
      { platform: 'win32', env: {} },
    )

    expect(spec.command).toBe('cmd.exe')
    expect(spec.args.at(-1)).toBe(
      'pnpm.cmd "deploy" "--prod" "C:\\Users\\Alice Dev\\broker pack"',
    )
    expect(spec.windowsVerbatimArguments).toBe(true)
  })
})

describe.runIf(process.platform === 'win32')('runPnpmSync on Windows', () => {
  it('runs a quoted pnpm command through the installed Corepack shim', () => {
    const result = runPnpmSync(['--version'], {
      encoding: 'utf8',
      env: process.env,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/)
  }, 15_000)

  it('preserves a leading config flag, spaces, and cmd metacharacters', () => {
    const result = runPnpmSync([
      '--config.node-linker=hoisted',
      '--config.inject-workspace-packages=true',
      'exec',
      'node',
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      'C:\\Alice Work\\broker pack',
      'alpha&beta',
    ], {
      encoding: 'utf8',
      env: process.env,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(JSON.parse(String(result.stdout))).toEqual([
      'C:\\Alice Work\\broker pack',
      'alpha&beta',
    ])
  }, 15_000)
})
