import { describe, expect, it } from 'vitest'

import { AUR_IMAGES, parseArgs } from './cli-aur-container-smoke.mjs'

describe('AUR container lifecycle smoke', () => {
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
