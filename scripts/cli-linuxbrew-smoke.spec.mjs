import { describe, expect, it } from 'vitest'

import { LINUXBREW_IMAGES, parseArgs } from './cli-linuxbrew-smoke.mjs'

describe('Linuxbrew lifecycle smoke', () => {
  it('pins official Homebrew images for both native Linux architectures', () => {
    expect(LINUXBREW_IMAGES.arm64).toMatchObject({ platform: 'linux/arm64' })
    expect(LINUXBREW_IMAGES.x64).toMatchObject({ platform: 'linux/amd64' })
    expect(LINUXBREW_IMAGES.arm64.image).toMatch(/^ghcr\.io\/homebrew\/brew@sha256:[a-f0-9]{64}$/)
    expect(LINUXBREW_IMAGES.x64.image).toMatch(/^ghcr\.io\/homebrew\/brew@sha256:[a-f0-9]{64}$/)
  })

  it('parses a complete arm64 lifecycle request', () => {
    expect(parseArgs([
      '--arch', 'arm64',
      '--previous-version', '0.90.0',
      '--current-version', '0.90.1',
      '--previous-content-identity', '0123456789abcdef',
      '--current-content-identity', 'fedcba9876543210',
      '--previous-package', 'dist/previous/openalice.rb',
      '--current-package', 'dist/current/openalice.rb',
    ])).toMatchObject({
      arch: 'arm64',
      docker: 'docker',
      currentVersion: '0.90.1',
    })
  })

  it('rejects unsupported architectures and malformed identities', () => {
    const base = [
      '--arch', 'riscv64',
      '--previous-version', '0.90.0',
      '--current-version', '0.90.1',
      '--previous-content-identity', '0123456789abcdef',
      '--current-content-identity', 'fedcba9876543210',
      '--previous-package', 'dist/previous/openalice.rb',
      '--current-package', 'dist/current/openalice.rb',
    ]
    expect(() => parseArgs(base)).toThrow('--arch must be arm64 or x64')
    base[1] = 'x64'
    base[9] = 'not-a-hash'
    expect(() => parseArgs(base)).toThrow('invalid content identity')
  })
})
