import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LEGACY_INSTALLER_URL,
  DEFAULT_LEGACY_VERSION,
  LEGACY_PI_ASSETS,
  parseArgs,
} from './cli-legacy-cutover-smoke.mjs'

describe('legacy CLI cutover smoke', () => {
  it('defaults to the published v0.90.1 installer', () => {
    const options = parseArgs([
      '--archive', 'dist/openalice-cli.tar.gz',
      '--sha256', 'a'.repeat(64),
      '--expected-version', '0.91.0',
      '--expected-content-identity', '0123456789abcdef',
    ])
    expect(options).toMatchObject({
      legacyVersion: DEFAULT_LEGACY_VERSION,
      legacyInstallerUrl: DEFAULT_LEGACY_INSTALLER_URL,
      expectedVersion: '0.91.0',
      keep: false,
    })
    expect(DEFAULT_LEGACY_INSTALLER_URL).toContain('/v0.90.1/OpenAlice-0.90.1-install')
    expect(LEGACY_PI_ASSETS['package.json'].url).toContain('/v0.90.1/')
    expect(LEGACY_PI_ASSETS['package.json'].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(LEGACY_PI_ASSETS['package-lock.json'].sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('accepts an explicit historical installer fixture', () => {
    expect(parseArgs([
      '--archive', 'dist/openalice-cli.tar.gz',
      '--sha256', 'b'.repeat(64),
      '--expected-version', '0.91.0-beta.1',
      '--expected-content-identity', 'fedcba9876543210',
      '--legacy-version', '0.90.0',
      '--legacy-installer-url', 'https://example.test/legacy-install',
      '--installer', './install',
      '--curl', '/usr/bin/curl',
      '--keep',
    ])).toMatchObject({
      legacyVersion: '0.90.0',
      legacyInstallerUrl: 'https://example.test/legacy-install',
      curl: '/usr/bin/curl',
      keep: true,
    })
  })

  it('rejects malformed checksums and content identities', () => {
    const args = [
      '--archive', 'dist/openalice-cli.tar.gz',
      '--sha256', 'bad',
      '--expected-version', '0.91.0',
      '--expected-content-identity', '0123456789abcdef',
    ]
    expect(() => parseArgs(args)).toThrow('--sha256 must be 64 lowercase hex characters')
    args[3] = 'a'.repeat(64)
    args[7] = 'bad'
    expect(() => parseArgs(args)).toThrow('--expected-content-identity')
  })
})
