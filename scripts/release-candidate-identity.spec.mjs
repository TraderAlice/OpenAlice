import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCandidateIdentity, verifyCandidateIdentity, createCandidateAcceptance, verifyCandidateAcceptance } from './release-candidate-identity.mjs'

const roots = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
const header = { sourceSha: 'a'.repeat(40), version: '0.91.1', channel: 'stable', platform: 'darwin', arch: 'arm64', kind: 'desktop' }
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'release-identity-'))
  roots.push(directory)
  writeFileSync(join(directory, 'app.zip'), 'immutable candidate')
  writeFileSync(join(directory, 'latest.yml'), 'update metadata')
  const manifest = createCandidateIdentity({ directory, filenames: ['latest.yml', 'app.zip'], ...header })
  return { directory, manifest, expected: { ...header, candidateId: manifest.candidateId } }
}

describe('release candidate identity', () => {
  it('binds exact bytes and is independent of filename order', () => {
    const input = fixture()
    expect(verifyCandidateIdentity(input)).toBe(input.manifest.candidateId)
    expect(createCandidateIdentity({ directory: input.directory, filenames: ['app.zip', 'latest.yml'], ...header })).toEqual(input.manifest)
  })
  it.each(['sourceSha', 'version', 'channel', 'platform', 'arch', 'kind'])('rejects mismatched %s', (key) => {
    const input = fixture()
    const alternatives = { sourceSha: 'b'.repeat(40), version: '0.91.2', channel: 'beta', platform: 'win32', arch: 'x64', kind: 'cli' }
    input.expected[key] = alternatives[key]
    expect(() => verifyCandidateIdentity(input)).toThrow()
  })
  it('rejects changed bytes, extra files, and missing files', () => {
    const input = fixture()
    writeFileSync(join(input.directory, 'app.zip'), 'different bytes')
    expect(() => verifyCandidateIdentity(input)).toThrow('bytes mismatch')
    writeFileSync(join(input.directory, 'unexpected.zip'), 'extra')
    expect(() => verifyCandidateIdentity(input)).toThrow('file set mismatch')
    rmSync(join(input.directory, 'unexpected.zip'))
    rmSync(join(input.directory, 'app.zip'))
    expect(() => verifyCandidateIdentity(input)).toThrow('file set mismatch')
  })
  it('rejects a rehashed replacement when a candidate identity was selected', () => {
    const input = fixture()
    writeFileSync(join(input.directory, 'app.zip'), 'replacement')
    input.manifest = createCandidateIdentity({ directory: input.directory, filenames: ['app.zip', 'latest.yml'], ...header })
    expect(() => verifyCandidateIdentity(input)).toThrow('Selected candidate identity mismatch')
  })
  it.each(['../outside', 'x\\outside', '.', 'a\nb'])('rejects unsafe filename %j', (name) => {
    const input = fixture()
    expect(() => createCandidateIdentity({ directory: input.directory, filenames: [name], ...header })).toThrow()
  })
  it.skipIf(process.platform === 'win32')('rejects symlink artifacts', () => {
    const input = fixture()
    symlinkSync('app.zip', join(input.directory, 'link.zip'))
    expect(() => createCandidateIdentity({ directory: input.directory, filenames: ['link.zip'], ...header })).toThrow('regular files')
  })
  it('binds acceptance to the exact candidate and selected verifier', () => {
    const { manifest } = fixture()
    const expected = { candidateId: manifest.candidateId, verifierSha: 'b'.repeat(40), checkKind: 'desktop-upgrade' }
    const receipt = createCandidateAcceptance({ ...expected, checks: { preservesData: true, restarts: true } })
    expect(verifyCandidateAcceptance({ receipt, ...expected, requiredChecks: ['preservesData', 'restarts'] })).toBe(true)
    expect(() => verifyCandidateAcceptance({ receipt, ...expected, verifierSha: 'c'.repeat(40), requiredChecks: ['restarts'] })).toThrow()
    expect(() => verifyCandidateAcceptance({ receipt, ...expected, candidateId: 'd'.repeat(64), requiredChecks: ['restarts'] })).toThrow()
    expect(() => verifyCandidateAcceptance({ receipt, ...expected, requiredChecks: ['notRun'] })).toThrow('check missing')
    expect(() => createCandidateAcceptance({ ...expected, checks: { preservesData: false } })).toThrow()
  })
})
