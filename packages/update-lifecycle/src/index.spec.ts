import { describe, expect, it } from 'vitest'
import { compareVersions, isVersion, releaseChannelForVersion, newerRelease, selectRelease, type ReleaseIdentity } from './index.js'

describe('release precedence', () => {
  it.each([
    ['1.0.0', '1.0.0', 0], ['v1.2.3', '1.2.3+build.8', 0],
    ['2.0.0', '1.99.99', 1], ['1.10.0', '1.9.0', 1],
    ['1.0.0', '1.0.0-beta.1', 1], ['1.0.0-beta.10', '1.0.0-beta.2', 1],
    ['1.0.0-beta.1', '1.0.0-beta', 1], ['1.0.0-alpha', '1.0.0-beta', -1],
    ['1.0.0-9', '1.0.0-alpha', -1],
    ['1.0.0-9007199254740993', '1.0.0-9007199254740992', 1],
  ])('%s vs %s', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected)
    expect(compareVersions(right, left)).toBe(expected === 0 ? 0 : -expected)
  })
  it.each(['', 'unknown', '1', '1.2', '01.2.3', '1.2.3-beta.01', '1.2.3+'])('rejects incomplete evidence %s', value => {
    expect(isVersion(value)).toBe(false)
    expect(() => compareVersions(value, '1.0.0')).toThrow('Invalid OpenAlice version')
    expect(newerRelease('1.0.0', value)).toBe(false)
  })
})

describe('channel selection shared by product and rehearsal', () => {
  const stable: ReleaseIdentity = { channel: 'stable', version: '0.94.2' }
  const beta: ReleaseIdentity = { channel: 'beta', version: '0.94.2-beta.10' }
  it('isolates feed heads and validates their channel semantics', () => {
    expect(selectRelease(stable, beta, 'stable')).toEqual({ status: 'blocked', reason: 'wrong-channel' })
    expect(selectRelease(stable, { ...stable, version: beta.version }, 'stable').status).toBe('unknown')
    expect(selectRelease({ ...beta, version: '0.94.2-beta.2' }, beta, 'beta').status).toBe('available')
  })
  it('distinguishes explicit channel switching from a silent downgrade', () => {
    expect(selectRelease(stable, beta, 'beta')).toEqual({ status: 'blocked', reason: 'older-release' })
    expect(selectRelease(stable, beta, 'beta', 'switch-channel')).toEqual({ status: 'available', reason: 'channel-change' })
    expect(selectRelease(stable, { ...stable, version: '0.94.1' }, 'stable', 'switch-channel').status).toBe('blocked')
  })
  it('does not report missing or invalid observations as up to date', () => {
    expect(selectRelease(stable, null, 'stable').status).toBe('unknown')
    expect(selectRelease({ ...stable, version: 'unknown' }, stable, 'stable').status).toBe('unknown')
  })
  it('uses accepted dev identities, never lexical commit order or package version order', () => {
    const current: ReleaseIdentity = { channel: 'dev', version: '0.94.1', commit: 'fffffff' }
    expect(selectRelease(current, { ...current, commit: '0000001' }, 'dev').status).toBe('available')
    expect(selectRelease(current, current, 'dev').status).toBe('current')
    expect(selectRelease(current, { ...current, commit: undefined }, 'dev').status).toBe('unknown')
  })
  it('uses same-platform artifact evidence for rebuilt dev commits', () => {
    const current: ReleaseIdentity = { channel: 'dev', version: '0.94.1', commit: 'abcdef0', artifactSha256: 'a'.repeat(64) }
    expect(selectRelease(current, { ...current, artifactSha256: 'b'.repeat(64) }, 'dev').status).toBe('available')
    expect(selectRelease({ ...current, commit: undefined }, current, 'dev').status).toBe('current')
  })
})

it.each([
  ['0.94.1', 'stable'], ['0.94.1+local.7', 'stable'], ['v0.94.1-beta.2', 'beta'],
  ['0.94.1-beta.10+build.2', 'beta'], ['0.94.1-beta.0', null], ['0.94.1-beta.01', null],
  ['invalid', null], ['39', null], ['0.94.1-alpha.1', null],
])('classifies the running product %s using the shared channel grammar', (version, expected) => {
  expect(releaseChannelForVersion(version)).toBe(expected)
})
