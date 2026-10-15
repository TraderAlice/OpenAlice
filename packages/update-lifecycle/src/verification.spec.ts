import { describe, expect, it } from 'vitest'
import { verifyReleaseEvidence } from './index.js'

describe('approved release verification', () => {
  it('requires the approved version, not any newer version', () => {
    expect(verifyReleaseEvidence({ version: '0.94.2' }, { version: '0.94.3' }).status).toBe('mismatched')
    expect(verifyReleaseEvidence({ version: '0.94.2' }, { version: '0.94.1' }).status).toBe('mismatched')
    expect(verifyReleaseEvidence({ version: 'v0.94.2' }, { version: '0.94.2' }).status).toBe('matched')
  })
  it('does not substitute installed evidence for absent active evidence', () => {
    expect(verifyReleaseEvidence({ version: '0.94.2' }, null)).toEqual({ status: 'unknown', fields: ['version'] })
  })
  it('keeps malformed and incomplete identities unknown', () => {
    expect(verifyReleaseEvidence({ version: 'development' }, { version: 'development' }).status).toBe('unknown')
    expect(verifyReleaseEvidence({ version: '0.94.2', commit: 'a'.repeat(40) }, { version: '0.94.2' })).toEqual({ status: 'unknown', fields: ['commit'] })
    expect(verifyReleaseEvidence({ version: '0.94.2', commit: 'abcdef0' }, { version: '0.94.2', commit: 'abcdef0' }).status).toBe('unknown')
  })
  it('distinguishes dev commits with unchanged product versions', () => {
    expect(verifyReleaseEvidence({ version: '0.94.2', commit: 'a'.repeat(40) }, { version: '0.94.2', commit: 'b'.repeat(40) })).toEqual({ status: 'mismatched', fields: ['commit'] })
  })
  it('requires the target payload even for the same version and commit', () => {
    const target = { version: '0.94.2', commit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64) }
    expect(verifyReleaseEvidence(target, { ...target, artifactSha256: undefined }).status).toBe('unknown')
    expect(verifyReleaseEvidence(target, { ...target, artifactSha256: 'c'.repeat(64) }).status).toBe('mismatched')
    expect(verifyReleaseEvidence(target, { ...target, artifactSha256: 'B'.repeat(64) }).status).toBe('matched')
  })
  it('retains build metadata as identity rather than precedence', () => {
    expect(verifyReleaseEvidence({ version: '0.94.2+build.1' }, { version: '0.94.2+build.2' }).status).toBe('mismatched')
  })
})
