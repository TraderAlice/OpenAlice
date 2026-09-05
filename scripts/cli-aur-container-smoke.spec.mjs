import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'

import { AUR_IMAGES, parseArgs, runAurContainerSmoke } from './cli-aur-container-smoke.mjs'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(() => ({ status: 0 })) }))

describe('AUR container lifecycle smoke', () => {
  it('scopes the unsupported download sandbox setting to the disposable container and all lifecycle commands', () => {
    runAurContainerSmoke({
      arch: 'arm64', docker: 'docker',
      previousVersion: '0.91.0', currentVersion: '0.91.1',
      previousContentIdentity: '0123456789abcdef',
      currentContentIdentity: 'fedcba9876543210',
      previousPackage: 'scripts/cli-aur-container-smoke.spec.mjs',
      currentPackage: 'scripts/cli-aur-container-smoke.spec.mjs',
    })
    const [command, args] = vi.mocked(spawnSync).mock.calls.at(-1)
    expect(command).toBe('docker')
    expect(args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(args).not.toContain('--privileged')
    expect(args.at(-1)).toMatch(/^sed -i .*DisableSandbox.*\/etc\/pacman.conf && pacman -Syu/)
    expect(args.at(-1)).toContain('exec /usr/bin/node /work/scripts/cli-system-package-manager-smoke.mjs')
    expect(args.at(-1)).not.toMatch(/SigLevel|--disable-sandbox|nodejs git/)
    expect(args.find((value) => value.endsWith(':/work:ro'))).toBeDefined()
  })

  it('pins native Arch-family images for Linux arm64 and x64', () => {
    expect(AUR_IMAGES.arm64).toMatchObject({ platform: 'linux/arm64' })
    expect(AUR_IMAGES.x64).toMatchObject({ platform: 'linux/amd64' })
    expect(AUR_IMAGES.arm64.image).toMatch(/^menci\/archlinuxarm:base-devel@sha256:[a-f0-9]{64}$/)
    expect(AUR_IMAGES.x64.image).toMatch(/^archlinux:base-devel@sha256:[a-f0-9]{64}$/)
  })

  it('parses a complete x64 lifecycle request', () => {
    expect(parseArgs([
      '--arch', 'x64',
      '--previous-version', '0.90.0',
      '--current-version', '0.90.1',
      '--previous-content-identity', '0123456789abcdef',
      '--current-content-identity', 'fedcba9876543210',
      '--previous-package', 'dist/previous/aur/PKGBUILD',
      '--current-package', 'dist/current/aur/PKGBUILD',
    ])).toMatchObject({
      arch: 'x64',
      docker: 'docker',
      currentVersion: '0.90.1',
    })
  })

  it('rejects unsupported architectures and malformed versions', () => {
    const base = [
      '--arch', 'riscv64',
      '--previous-version', '0.90.0',
      '--current-version', '0.90.1',
      '--previous-content-identity', '0123456789abcdef',
      '--current-content-identity', 'fedcba9876543210',
      '--previous-package', 'dist/previous/aur/PKGBUILD',
      '--current-package', 'dist/current/aur/PKGBUILD',
    ]
    expect(() => parseArgs(base)).toThrow('--arch must be arm64 or x64')
    base[1] = 'arm64'
    base[5] = 'not-a-version'
    expect(() => parseArgs(base)).toThrow('invalid OpenAlice version')
  })
})
