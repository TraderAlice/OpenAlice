import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GUARDIAN_READY_TIMEOUT_MS,
  parseDevGuardianOptions,
} from './dev-options.js'

const READY = DEFAULT_GUARDIAN_READY_TIMEOUT_MS
const ENV = {} as NodeJS.ProcessEnv

describe('parseDevGuardianOptions', () => {
  it('resolves a separate development home from the checkout directory', () => {
    expect(parseDevGuardianOptions(['--', '--home', '../openalice-homes/feature-a'], '/repo/OpenAlice', ENV))
      .toEqual({ home: resolve('/repo/OpenAlice', '../openalice-homes/feature-a'), relay: true, readyTimeoutMs: READY })
  })

  it('supports equals syntax and leaves other Guardian options alone', () => {
    expect(parseDevGuardianOptions(['--takeover', '--home=/tmp/openalice feature'], '/repo', ENV))
      .toEqual({ home: resolve('/tmp/openalice feature'), relay: true, readyTimeoutMs: READY })
  })

  it('uses the final home when a wrapper supplied more than one', () => {
    expect(parseDevGuardianOptions(['--home', '/tmp/first', '--home=/tmp/second'], '/repo', ENV))
      .toEqual({ home: resolve('/tmp/second'), relay: true, readyTimeoutMs: READY })
  })

  it('keeps the direct server as an explicit diagnostic mode', () => {
    expect(parseDevGuardianOptions(['--no-relay'], '/repo', ENV)).toEqual({ home: null, relay: false, readyTimeoutMs: READY })
  })

  it('rejects a missing home path before any process starts', () => {
    expect(() => parseDevGuardianOptions(['--home'], '/repo', ENV)).toThrow('--home requires a directory path')
    expect(() => parseDevGuardianOptions(['--home='], '/repo', ENV)).toThrow('--home requires a directory path')
  })
})

describe('parseDevGuardianOptions --ready-timeout', () => {
  it('accepts the separate and equals forms', () => {
    expect(parseDevGuardianOptions(['--ready-timeout', '45000'], '/repo', ENV).readyTimeoutMs).toBe(45_000)
    expect(parseDevGuardianOptions(['--ready-timeout=45000'], '/repo', ENV).readyTimeoutMs).toBe(45_000)
  })

  it('reads the env fallback when no flag is given, and the flag wins', () => {
    const env = { OPENALICE_GUARDIAN_READY_TIMEOUT_MS: '30000' }
    expect(parseDevGuardianOptions([], '/repo', env).readyTimeoutMs).toBe(30_000)
    expect(parseDevGuardianOptions(['--ready-timeout=60000'], '/repo', env).readyTimeoutMs).toBe(60_000)
  })

  it('keeps the default gate when neither flag nor env is set', () => {
    expect(parseDevGuardianOptions([], '/repo', { OPENALICE_GUARDIAN_READY_TIMEOUT_MS: '' }).readyTimeoutMs)
      .toBe(DEFAULT_GUARDIAN_READY_TIMEOUT_MS)
  })

  it.each(['', 'abc', '0', '999', '1.5', '700000'])('rejects the invalid value %j', (value) => {
    expect(() => parseDevGuardianOptions([`--ready-timeout=${value}`], '/repo', ENV))
      .toThrow(/--ready-timeout requires an integer from 1000 to 600000/)
  })

  it('rejects a missing value rather than reading the next flag', () => {
    expect(() => parseDevGuardianOptions(['--ready-timeout', '--no-relay'], '/repo', ENV))
      .toThrow(/--ready-timeout requires an integer/)
  })

  it('names the env var when the env value is the invalid one', () => {
    expect(() => parseDevGuardianOptions([], '/repo', { OPENALICE_GUARDIAN_READY_TIMEOUT_MS: 'soon' }))
      .toThrow(/OPENALICE_GUARDIAN_READY_TIMEOUT_MS requires an integer/)
  })
})
