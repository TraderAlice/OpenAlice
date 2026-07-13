import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { resolveBashPath } from './shell-resolver.js'
import {
  applyWindowsWorkspaceShellPreference,
  readWindowsWorkspaceShellPreference,
  resolveWindowsWorkspaceShellStatus,
  saveWindowsWorkspaceShellPreference,
  validateWindowsWorkspaceShellPath,
} from './windows-workspace-shell.js'

describe('Windows workspace shell preference', () => {
  it('does no preference-file I/O on non-Windows platforms', async () => {
    await expect(readWindowsWorkspaceShellPreference('Z:\\must-not-exist.json', 'darwin'))
      .resolves.toEqual({ version: 1, mode: 'auto', customPath: null })
  })

  it('validates an absolute bash.exe path', () => {
    expect(validateWindowsWorkspaceShellPath(
      'C:\\Program Files\\Git\\bin\\bash.exe',
      () => true,
    )).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
    expect(() => validateWindowsWorkspaceShellPath('bash.exe', () => true))
      .toThrow('absolute path')
    expect(() => validateWindowsWorkspaceShellPath('C:\\Tools\\pwsh.exe', () => true))
      .toThrow('bash.exe')
    expect(() => validateWindowsWorkspaceShellPath('C:\\Git\\bin\\bash.exe', () => false))
      .toThrow('does not exist')
  })

  it('accepts custom paths containing spaces and non-ASCII characters', () => {
    const customPath = 'C:\\工具\\Git Suite\\bin\\bash.exe'
    expect(validateWindowsWorkspaceShellPath(customPath, () => true)).toBe(customPath)
  })

  it('persists and immediately applies a custom machine-local path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alice-shell-'))
    const path = join(dir, 'workspace-shell.json')
    const env: NodeJS.ProcessEnv = {}
    const customPath = 'D:\\PortableGit\\bin\\bash.exe'
    const status = await saveWindowsWorkspaceShellPreference(
      { mode: 'custom', customPath },
      { path, platform: 'win32', fileExists: () => true, env },
    )

    expect(env['OPENALICE_WORKSPACE_SHELL_PATH']).toBe(customPath)
    expect(status).toMatchObject({ supported: true, mode: 'custom', resolvedPath: customPath })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      mode: 'custom',
      customPath,
    })
  })

  it('auto mode clears the override and resolves the managed shell', () => {
    const env: NodeJS.ProcessEnv = {
      OPENALICE_WORKSPACE_SHELL_PATH: 'D:\\Git\\bin\\bash.exe',
      OPENALICE_MANAGED_SHELL_PATH: 'C:\\OpenAlice\\vendor\\git\\bin\\bash.exe',
    }
    applyWindowsWorkspaceShellPreference(
      { version: 1, mode: 'auto', customPath: null },
      env,
      'win32',
    )
    expect(env['OPENALICE_WORKSPACE_SHELL_PATH']).toBeUndefined()
    expect(resolveWindowsWorkspaceShellStatus(
      { version: 1, mode: 'auto', customPath: null },
      env,
      'win32',
      () => true,
    )).toMatchObject({ source: 'managed', valid: true })
  })

  it('gives a Windows user override priority without changing non-Windows resolution', () => {
    const env = {
      OPENALICE_WORKSPACE_SHELL_PATH: 'D:\\Git\\bin\\bash.exe',
      OPENALICE_MANAGED_SHELL_PATH: '/bin/bash',
    }
    expect(resolveBashPath(env, 'win32')).toBe('D:\\Git\\bin\\bash.exe')
    expect(resolveBashPath(env, 'darwin')).toBe('/bin/bash')
  })

  it('reports a deleted custom shell and does not silently fall back to Auto', () => {
    const customPath = 'D:\\Moved Git\\bin\\bash.exe'
    const env: NodeJS.ProcessEnv = {
      OPENALICE_MANAGED_SHELL_PATH: 'C:\\OpenAlice\\vendor\\git\\bin\\bash.exe',
    }
    const preference = { version: 1, mode: 'custom', customPath } as const

    applyWindowsWorkspaceShellPreference(preference, env, 'win32')

    expect(resolveWindowsWorkspaceShellStatus(
      preference,
      env,
      'win32',
      () => false,
    )).toMatchObject({
      source: 'custom',
      resolvedPath: customPath,
      valid: false,
      message: 'The configured bash.exe no longer exists.',
    })
    expect(resolveBashPath(env, 'win32')).toBe(customPath)
  })
})
