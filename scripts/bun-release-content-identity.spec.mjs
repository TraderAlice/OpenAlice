import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'

describe('Bun native release content identity', () => {
  it.each([
    ['Web UI', 'share/openalice/ui/dist/index.html'],
    ['default resources', 'share/openalice/default/skills/alice-workspace/SKILL.md'],
    ['Workspace templates', 'share/openalice/src/workspaces/templates/chat/bootstrap.mjs'],
  ])('changes when %s changes while the executable stays byte-identical', (_label, changedPath) => {
    const original = releaseMetadata()
    const changed = releaseMetadata({
      [changedPath]: `changed:${changedPath}`,
    })

    expect(file(original, 'bin/openalice').sha256).toBe(file(changed, 'bin/openalice').sha256)
    expect(bunReleaseContentIdentity(changed)).not.toBe(bunReleaseContentIdentity(original))
  })

  it('is canonical across file and object ordering and ignores its stored result', () => {
    const original = releaseMetadata()
    const reordered = {
      files: [...original.files].reverse().map((entry) => ({
        sha256: entry.sha256,
        mode: entry.mode,
        bytes: entry.bytes,
        type: entry.type,
        path: entry.path,
      })),
      resourceRoot: original.resourceRoot,
      executable: original.executable,
      bunVersion: original.bunVersion,
      arch: original.arch,
      platform: original.platform,
      version: original.version,
      product: original.product,
      schemaVersion: original.schemaVersion,
      contentIdentity: 'ffffffffffffffff',
    }

    expect(bunReleaseContentIdentity(reordered)).toBe(bunReleaseContentIdentity(original))
  })

  it('covers executable permissions and rejects a self-referential release manifest', () => {
    const original = releaseMetadata()
    const changedMode = releaseMetadata()
    file(changedMode, 'bin/openalice').mode = 0o644
    expect(bunReleaseContentIdentity(changedMode)).not.toBe(bunReleaseContentIdentity(original))

    expect(() => bunReleaseContentIdentity({
      ...original,
      files: [...original.files, fileEntry('release.json', '{}')],
    })).toThrow('must exclude release.json')
  })

  it('rejects incomplete, duplicate, and internally inconsistent file entries', () => {
    const original = releaseMetadata()
    expect(() => bunReleaseContentIdentity({ ...original, files: [{}] }))
      .toThrow('invalid file path')
    expect(() => bunReleaseContentIdentity({
      ...original,
      files: [original.files[0], { ...original.files[0] }],
    })).toThrow('duplicate path')
    expect(() => bunReleaseContentIdentity({
      ...original,
      files: [{
        path: 'bin/openalice-link',
        type: 'symlink',
        bytes: 3,
        sha256: '0'.repeat(64),
        target: '../bin/openalice',
      }],
    })).toThrow('invalid symlink metadata')
  })
})

function releaseMetadata(overrides = {}) {
  const content = {
    'bin/openalice': '#!/bin/sh\nprintf openalice\\n\n',
    'share/openalice/ui/dist/index.html': '<main>OpenAlice</main>\n',
    'share/openalice/default/skills/alice-workspace/SKILL.md': '# Alice Workspace\n',
    'share/openalice/src/workspaces/templates/chat/bootstrap.mjs': 'export const chat = true\n',
    ...overrides,
  }
  return {
    schemaVersion: 1,
    product: 'OpenAlice CLI',
    version: '0.90.2',
    platform: 'linux',
    arch: 'x64',
    bunVersion: '1.4.0',
    executable: 'bin/openalice',
    resourceRoot: 'share/openalice',
    files: Object.entries(content).map(([path, value]) => (
      fileEntry(path, value, path === 'bin/openalice' ? 0o755 : 0o644)
    )),
  }
}

function file(release, path) {
  return release.files.find((entry) => entry.path === path)
}

function fileEntry(path, content, mode = 0o644) {
  const bytes = Buffer.from(content)
  return {
    path,
    type: 'file',
    bytes: bytes.length,
    mode,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
