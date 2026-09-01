import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildDesktopUpgradeSmokePlan,
  buildUpgradeSeedExpression,
  buildUpgradeVerifyExpression,
  candidateDesktopAssetName,
  CHROMIUM_PROFILE_SINGLETON_NAMES,
  chromiumProfileReleaseState,
  desktopUpgradeWorkspaceTags,
  inspectChromiumProfileSingleton,
  previousDesktopAssetName,
  selectPreviousDesktopTag,
  waitForChromiumProfileRelease,
  windowsInstallerArgs,
} from './desktop-upgrade-smoke-lib.mjs'

describe('desktop upgrade smoke planning', () => {
  it('keeps the Windows builder and legacy takeover aligned with the upgrade contract', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { build: { nsis: { artifactName: string; include: string } } }
    const installerInclude = readFileSync(
      new URL('../apps/desktop/build/installer.nsh', import.meta.url),
      'utf8',
    )

    expect(packageJson.build.nsis.artifactName).toBe('OpenAlice.Setup.${version}.${ext}')
    expect(packageJson.build.nsis.include).toBe('apps/desktop/build/installer.nsh')
    expect(installerInclude).toContain('${if} ${isUpdated}')
    expect(installerInclude).toContain('/T /F /IM "${APP_EXECUTABLE_FILENAME}"')
    expect(installerInclude).toContain("ExecutablePath.StartsWith('$INSTDIR'")
    expect(installerInclude).toContain('Stop-Process -Id')
    expect(installerInclude).toContain('SetOutPath "$TEMP"')
    expect(installerInclude).toContain('/D /C RD /S /Q "\\\\?\\$INSTDIR"')
    expect(installerInclude).toContain('DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"')
  })

  it('selects the newest published version different from the candidate', () => {
    expect(selectPreviousDesktopTag(
      ['v0.88.0-beta', 'v0.87.0-beta', 'v0.86.0-beta'],
      '0.88.0-beta',
    )).toBe('v0.87.0-beta')
    expect(selectPreviousDesktopTag(['v0.88.0-beta'], '0.88.0-beta')).toBeNull()
  })

  it('keeps seeded Workspace tags valid for numbered beta releases', () => {
    const tags = desktopUpgradeWorkspaceTags('0.90.2-beta.123456789')
    expect(tags).toEqual({
      tag: 'upgrade-0-90-2-beta-12345678',
      postUpgradeTag: 'upgrade-0-90-2-beta-12345678-post',
    })
    expect(tags.tag).toMatch(/^[a-z0-9][a-z0-9_-]{0,32}$/)
    expect(tags.postUpgradeTag).toMatch(/^[a-z0-9][a-z0-9_-]{0,32}$/)
  })

  it('requires every Chromium profile singleton entry to be absent', () => {
    expect(CHROMIUM_PROFILE_SINGLETON_NAMES).toEqual([
      'SingletonLock',
      'SingletonSocket',
      'SingletonCookie',
    ])
    expect(chromiumProfileReleaseState(
      CHROMIUM_PROFILE_SINGLETON_NAMES.map((name) => ({ name, present: false })),
    )).toEqual({ released: true, pending: [] })

    expect(chromiumProfileReleaseState([
      {
        name: 'SingletonLock',
        present: true,
        kind: 'symlink',
        target: 'runner.local-1234',
        detail: 'dangling target',
      },
      { name: 'SingletonSocket', present: false },
      { name: 'SingletonCookie', present: false },
    ])).toEqual({
      released: false,
      pending: ['SingletonLock [symlink] -> runner.local-1234 (dangling target)'],
    })
  })

  it.skipIf(process.platform === 'win32')(
    'treats a real dangling singleton symlink as claimed until it is unlinked',
    () => {
      const profileRoot = mkdtempSync(join(tmpdir(), 'openalice-chromium-singleton-'))
      const lockPath = join(profileRoot, 'SingletonLock')
      try {
        symlinkSync('runner.local-1234', lockPath)
        expect(inspectChromiumProfileSingleton(profileRoot, 'SingletonLock')).toEqual({
          name: 'SingletonLock',
          present: true,
          kind: 'symlink',
          target: 'runner.local-1234',
          detail: 'dangling target',
        })

        unlinkSync(lockPath)
        expect(inspectChromiumProfileSingleton(profileRoot, 'SingletonLock')).toEqual({
          name: 'SingletonLock',
          present: false,
        })
      } finally {
        rmSync(profileRoot, { recursive: true, force: true })
      }
    },
  )

  it('polls until Chromium removes the profile claim', async () => {
    let nowMs = 0
    let lockPresent = true
    const logs: string[] = []

    await waitForChromiumProfileRelease('/tmp/released-profile', {
      label: 'candidate restart 0.91.0',
      timeoutMs: 500,
      pollIntervalMs: 100,
      now: () => nowMs,
      sleep: async (ms: number) => {
        nowMs += ms
        lockPresent = false
      },
      inspect: (_profileRoot: string, name: string) => ({
        name,
        present: name === 'SingletonLock' && lockPresent,
      }),
      log: (message: string) => logs.push(message),
    })

    expect(nowMs).toBe(100)
    expect(logs).toEqual([
      '[desktop-upgrade] candidate restart 0.91.0 Chromium profile released after 100ms',
    ])
  })

  it('fails at the bounded deadline with the remaining singleton details', async () => {
    let nowMs = 0

    await expect(waitForChromiumProfileRelease('/tmp/stuck-profile', {
      label: 'candidate 0.91.0',
      childExitCode: 0,
      childPid: 4321,
      timeoutMs: 250,
      pollIntervalMs: 100,
      now: () => nowMs,
      sleep: async (ms: number) => { nowMs += ms },
      inspect: (_profileRoot: string, name: string) => name === 'SingletonLock'
        ? {
            name,
            present: true,
            kind: 'symlink',
            target: 'runner.local-4321',
            detail: 'dangling target',
          }
        : { name, present: false },
    })).rejects.toThrow(
      'candidate 0.91.0 exited 0 but Chromium profile remained claimed after 250ms ' +
      '(pid=4321, profile=/tmp/stuck-profile): ' +
      'SingletonLock [symlink] -> runner.local-4321 (dangling target)',
    )
    expect(nowMs).toBe(250)
  })

  it('maps native release artifacts by host architecture', () => {
    expect(previousDesktopAssetName('0.88.0-beta', 'darwin', 'arm64'))
      .toBe('OpenAlice-0.88.0-beta-arm64-mac.zip')
    expect(previousDesktopAssetName('0.88.0-beta', 'darwin', 'x64'))
      .toBe('OpenAlice-0.88.0-beta-mac.zip')
    expect(candidateDesktopAssetName('0.89.0-beta', 'win32', 'x64'))
      .toBe('OpenAlice.Setup.0.89.0-beta.exe')
    expect(() => previousDesktopAssetName('1.0.0', 'linux', 'x64')).toThrow(
      'unsupported desktop upgrade host',
    )
  })

  it('matches electron-updater arguments for an in-place Windows update', () => {
    const installRoot = 'C:\\OpenAlice'

    expect(windowsInstallerArgs(installRoot)).toEqual(['/S', '/D=C:\\OpenAlice'])
    expect(windowsInstallerArgs(installRoot, true)).toEqual([
      '--updated',
      '/S',
    ])
  })

  it('keeps package and final-artifact candidate modes exclusive', () => {
    const defaultPlan = buildDesktopUpgradeSmokePlan([], { cwd: '/repo' })
    expect(defaultPlan.errors).toEqual([])
    expect(defaultPlan.candidatePackageRoot).toBe(resolve('/repo', 'dist/electron-app'))

    const invalid = buildDesktopUpgradeSmokePlan([
      '--candidate-package-root', 'dist/package',
      '--candidate-artifact-dir', 'dist/assets',
    ], { cwd: '/repo' })
    expect(invalid.errors).toContain(
      '[desktop-upgrade] choose candidate package root or final artifact directory, not both',
    )
  })

  it('builds renderer journeys that preserve and rewrite real state', () => {
    const seed = buildUpgradeSeedExpression({
      tag: 'upgrade-smoke',
      sentinelKey: 'upgrade-key',
      sentinelValue: 'from-v0.88',
    })
    const verify = buildUpgradeVerifyExpression({
      expectedWorkspaceId: 'chat-old-id',
      postUpgradeTag: 'upgrade-smoke-post',
      sentinelKey: 'upgrade-key',
    })
    expect(seed).toContain("request('/api/workspaces'")
    expect(seed).toContain('try { return await fetch(path, options) }')
    expect(seed).toContain("fetch('app://openalice' + path")
    expect(seed).toContain('N-1 upgrade sentinel')
    expect(verify).toContain('chat-old-id')
    expect(verify).toContain('upgrade-smoke-post')
    expect(verify).toContain("localStorage.getItem(\"upgrade-key\")")
  })
})
