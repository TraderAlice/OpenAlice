import { describe, expect, it } from 'vitest'

import {
  classifyBetaReleasePrep,
  parseChangedFiles,
} from './classify-beta-release-prep.mjs'

const manifests = ['package.json', 'packages/cli/package.json']

function manifest(name, version, extra = '') {
  return `{
  "name": "${name}",
  "version": "${version}",
  "description": "fixture"${extra}
}
`
}

function candidate(overrides = {}) {
  const baseVersion = overrides.baseVersion ?? '0.91.0-beta.1'
  const nextVersion = overrides.nextVersion ?? '0.91.0-beta.2'
  return classifyBetaReleasePrep({
    eventName: 'pull_request',
    ref: 'refs/pull/42/merge',
    baseRef: 'master',
    changes: manifests.map((path) => ({ status: 'M', path })),
    baseManifests: {
      'package.json': manifest('open-alice', baseVersion),
      'packages/cli/package.json': manifest('@traderalice/openalice-cli', baseVersion),
    },
    headManifests: {
      'package.json': manifest('open-alice', nextVersion),
      'packages/cli/package.json': manifest('@traderalice/openalice-cli', nextVersion),
    },
    ...overrides,
  })
}

describe('beta release-preparation classifier', () => {
  it('accepts only an exact forward beta version change on a master PR', () => {
    expect(candidate()).toEqual({
      betaReleasePrep: true,
      reason: 'exact beta release preparation 0.91.0-beta.1 -> 0.91.0-beta.2',
    })
    expect(candidate({ baseVersion: '0.90.2', nextVersion: '0.91.0-beta.1' }).betaReleasePrep).toBe(true)
    expect(candidate({ baseVersion: '0.90.2', nextVersion: '0.91.0-beta' }).betaReleasePrep).toBe(true)
  })

  it('fails closed on a master push so post-merge validation stays complete', () => {
    expect(candidate({
      eventName: 'push',
      ref: 'refs/heads/master',
      baseRef: '',
    }).betaReleasePrep).toBe(false)
  })

  it('fails closed for stable, stale, mismatched, and non-master versions', () => {
    expect(candidate({ nextVersion: '0.91.0' }).betaReleasePrep).toBe(false)
    expect(candidate({ nextVersion: '0.91.0-beta.1' }).betaReleasePrep).toBe(false)
    expect(candidate({ nextVersion: '0.91.0-beta' }).betaReleasePrep).toBe(false)
    expect(candidate({ nextVersion: '0.92.0-beta.0' }).betaReleasePrep).toBe(false)
    expect(candidate({ nextVersion: '0.92.0-beta.01' }).betaReleasePrep).toBe(false)
    expect(candidate({ baseRef: 'dev' }).betaReleasePrep).toBe(false)
    expect(candidate({ eventName: 'workflow_dispatch', baseRef: '' }).betaReleasePrep).toBe(false)

    const mismatch = candidate({
      headManifests: {
        'package.json': manifest('open-alice', '0.91.0-beta.2'),
        'packages/cli/package.json': manifest('@traderalice/openalice-cli', '0.91.0-beta.3'),
      },
    })
    expect(mismatch.betaReleasePrep).toBe(false)
  })

  it('rejects extra files, non-modification statuses, and bytes outside version', () => {
    expect(candidate({
      changes: [...manifests.map((path) => ({ status: 'M', path })), { status: 'M', path: 'README.md' }],
    }).betaReleasePrep).toBe(false)
    expect(candidate({
      changes: [{ status: 'M', path: 'package.json' }, { status: 'A', path: 'packages/cli/package.json' }],
    }).betaReleasePrep).toBe(false)

    const extraBytes = candidate({
      headManifests: {
        'package.json': manifest('open-alice', '0.91.0-beta.2', ',\n  "private": true'),
        'packages/cli/package.json': manifest('@traderalice/openalice-cli', '0.91.0-beta.2'),
      },
    })
    expect(extraBytes.betaReleasePrep).toBe(false)
  })

  it('parses the null-delimited no-renames git diff contract', () => {
    expect(parseChangedFiles('M\0package.json\0M\0packages/cli/package.json\0')).toEqual([
      { status: 'M', path: 'package.json' },
      { status: 'M', path: 'packages/cli/package.json' },
    ])
    expect(() => parseChangedFiles('M\0package.json\0M')).toThrow('incomplete name-status')
  })
})
