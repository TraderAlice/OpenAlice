import { describe, expect, it } from 'vitest'

import { composePnpmCommand } from './pnpm-command.mjs'

describe('composePnpmCommand', () => {
  it('uses a direct shell-free pnpm invocation on POSIX', () => {
    expect(composePnpmCommand(['electron:build'], { platform: 'darwin' })).toEqual({
      command: 'pnpm',
      args: ['electron:build'],
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
  })
})
