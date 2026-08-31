import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LEGACY_INSTALLER_URL,
  DEFAULT_LEGACY_INSTALLER_SHA256,
  DEFAULT_LEGACY_VERSION,
  LEGACY_PI_ASSETS,
  legacySeedEnvironment,
  parseArgs,
  verifyLegacyInstallerSha256,
} from './cli-legacy-cutover-smoke.mjs'

describe('legacy CLI cutover smoke', () => {
  it('uses the shipped updater for stable and direct archive cutover for beta/dev', () => {
    const source = readFileSync(new URL('./cli-legacy-cutover-smoke.mjs', import.meta.url), 'utf8')
    expect(source).toContain("run(executable, ['update', '--yes']")
    expect(source).toContain("'--archive', options.archive")
    expect(source).toContain('fixture.assertRequests()')
    for (const pathname of [
      "'/manifest.json'",
      'installerPath,',
      'archivePath,',
      '`${archivePath}.sha256`',
    ]) expect(source).toContain(pathname)
    expect(source).toContain('OPENALICE_STABLE_MANIFEST_URL')
    expect(source).not.toContain("pathname === '/releases/latest'")
  })

  it('defaults to the published v0.90.1 installer', () => {
    const options = parseArgs([
      '--archive', 'dist/openalice-cli.tar.gz',
      '--sha256', 'a'.repeat(64),
      '--expected-version', '0.91.0',
      '--expected-content-identity', '0123456789abcdef',
    ])
    expect(options).toMatchObject({
      channel: 'stable',
      legacyVersion: DEFAULT_LEGACY_VERSION,
      legacyInstallerUrl: DEFAULT_LEGACY_INSTALLER_URL,
      legacyInstallerSha256: DEFAULT_LEGACY_INSTALLER_SHA256,
      expectedVersion: '0.91.0',
      keep: false,
    })
    expect(DEFAULT_LEGACY_INSTALLER_URL).toContain('/v0.90.1/OpenAlice-0.90.1-install')
    expect(DEFAULT_LEGACY_INSTALLER_SHA256).toBe(
      'a2f34a715cc4a089854fde18741e316953868c1685db592b67b2b4ea10ede0bb',
    )
    expect(LEGACY_PI_ASSETS['package.json'].url).toContain('/v0.90.1/')
    expect(LEGACY_PI_ASSETS['package.json'].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(LEGACY_PI_ASSETS['package-lock.json'].sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('pins the historical seed independently of the release-source package version', () => {
    expect(legacySeedEnvironment({ legacyVersion: '0.90.1' }, {
      PATH: '/usr/bin:/bin',
      OPENALICE_INSTALL_UPDATE_CHANNEL: 'beta',
    }, '/tmp/pi-assets')).toMatchObject({
      PATH: '/usr/bin:/bin',
      OPENALICE_PI_SOURCE_DIR: '/tmp/pi-assets',
      OPENALICE_INSTALL_URL: 'https://openalice.ai/install',
      OPENALICE_INSTALL_UPDATE_CHANNEL: 'stable',
      OPENALICE_INSTALLER_RELEASE_VERSION: '0.90.1',
      OPENALICE_INSTALLER_UPDATE_CHANNEL: 'stable',
      OPENALICE_EXPECTED_CLI_VERSION: '0.90.1',
    })
  })

  it('accepts an explicit historical installer fixture', () => {
    expect(parseArgs([
      '--archive', 'dist/openalice-cli.tar.gz',
      '--sha256', 'b'.repeat(64),
      '--expected-version', '0.91.0-beta.1',
      '--expected-content-identity', 'fedcba9876543210',
      '--channel', 'beta',
      '--legacy-version', '0.90.0',
      '--legacy-installer-url', 'https://example.test/legacy-install',
      '--legacy-installer-sha256', 'c'.repeat(64),
      '--installer', './install',
      '--curl', '/usr/bin/curl',
      '--keep',
    ])).toMatchObject({
      channel: 'beta',
      legacyVersion: '0.90.0',
      legacyInstallerUrl: 'https://example.test/legacy-install',
      legacyInstallerSha256: 'c'.repeat(64),
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

    expect(() => parseArgs([
      '--archive', 'dist/openalice-cli.tar.gz',
      '--sha256', 'a'.repeat(64),
      '--expected-version', '0.91.0',
      '--expected-content-identity', '0123456789abcdef',
      '--legacy-installer-sha256', 'bad',
    ])).toThrow('--legacy-installer-sha256 must be 64 lowercase hex characters')
  })

  it('rejects historical installer bytes that do not match the pinned SHA-256', () => {
    const bytes = Buffer.from('#!/usr/bin/env bash\nprintf legacy-installer\\n\n')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    expect(verifyLegacyInstallerSha256(bytes, sha256)).toBe(sha256)
    expect(() => verifyLegacyInstallerSha256(bytes, '0'.repeat(64)))
      .toThrow('published legacy installer failed SHA-256 verification')
  })

  it('keeps stable and beta release versions on their explicit cutover paths', () => {
    const base = [
      '--archive', 'dist/openalice-cli.tar.gz',
      '--sha256', 'a'.repeat(64),
      '--expected-content-identity', '0123456789abcdef',
    ]
    expect(() => parseArgs([...base, '--expected-version', '0.91.0-beta.1']))
      .toThrow('stable cutover requires a stable expected version')
    expect(() => parseArgs([
      ...base,
      '--expected-version', '0.91.0',
      '--channel', 'beta',
    ])).toThrow('beta cutover requires a beta expected version')
    expect(parseArgs([
      ...base,
      '--expected-version', '0.91.0',
      '--channel', 'dev',
    ])).toMatchObject({ channel: 'dev', expectedVersion: '0.91.0' })
  })
})
