import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  aliceProjectEnvironment,
  deriveAliceProjectId,
  resolveAliceProjectIdentity,
} from './alice-project.js'

describe('AliceProject identity', () => {
  it('derives stable identity from the complete home rather than name or port', () => {
    const home = resolve('/tmp/openalice/research')
    expect(deriveAliceProjectId(home)).toBe(deriveAliceProjectId(home))
    expect(resolveAliceProjectIdentity({
      home,
      key: 'research',
      displayName: 'Research desk',
    })).toMatchObject({
      id: deriveAliceProjectId(home),
      key: 'research',
      displayName: 'Research desk',
      home,
      appRoot: null,
    })
  })

  it('keeps distinct complete homes in distinct AliceProjects', () => {
    expect(deriveAliceProjectId('/tmp/openalice/project-a')).not.toBe(
      deriveAliceProjectId('/tmp/openalice/project-b'),
    )
  })

  it('prefers explicit Supervisor metadata and serializes it for child runtimes', () => {
    const project = resolveAliceProjectIdentity({
      home: '/tmp/home',
      appRoot: '/tmp/source',
      env: {
        OPENALICE_PROJECT_ID: 'alice-project-explicit_1234',
        OPENALICE_PROJECT_KEY: 'quant',
        OPENALICE_PROJECT_NAME: 'Quant Research',
      },
    })
    expect(project).toMatchObject({
      id: 'alice-project-explicit_1234',
      key: 'quant',
      displayName: 'Quant Research',
      appRoot: resolve('/tmp/source'),
    })
    expect(aliceProjectEnvironment(project)).toEqual({
      OPENALICE_PROJECT_ID: 'alice-project-explicit_1234',
      OPENALICE_PROJECT_KEY: 'quant',
      OPENALICE_PROJECT_NAME: 'Quant Research',
      OPENALICE_PROJECT_APP_ROOT: resolve('/tmp/source'),
    })
  })

  it('uses a quiet useful label for ordinary default homes', () => {
    expect(resolveAliceProjectIdentity({
      home: '/Users/alice/.openalice',
      env: {},
    }).displayName).toBe('Default AliceProject')
    expect(resolveAliceProjectIdentity({
      home: '/srv/openalice/fund-research',
      env: {},
      key: 'fund-research',
    }).displayName).toBe('Fund Research')
  })
})
