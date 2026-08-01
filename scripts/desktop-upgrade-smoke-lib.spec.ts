import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildDesktopUpgradeSmokePlan,
  buildUpgradeSeedExpression,
  buildUpgradeVerifyExpression,
  candidateDesktopAssetName,
  previousDesktopAssetName,
  selectPreviousDesktopTag,
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
