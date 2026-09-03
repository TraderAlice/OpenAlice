import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { publishCliNpmPackages } from './publish-cli-npm-packages.mjs'

const roots = []
const packageNames = [
  'openalice-darwin-arm64',
  'openalice-darwin-x64',
  'openalice-linux-arm64',
  'openalice-linux-x64',
  'openalice',
]

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('publish CLI npm packages', () => {
  it('publishes missing platform packages before the meta package', () => {
    const root = fixture()
    const calls = []
    const runNpm = vi.fn((args) => {
      calls.push(args)
      if (args[0] === 'view') return result(1, '', 'npm error code E404')
      return result(0, '+ published')
    })

    expect(publishCliNpmPackages({ packagesDir: root, runNpm, logger: silent() }))
      .toEqual({ version: '0.90.2', packages: packageNames })
    expect(calls.filter(([command]) => command === 'publish').map(([_, path]) => path.split('/').at(-1)))
      .toEqual(packageNames.map((name) => `${name}-0.90.2.tgz`))
  })

  it('makes a retry a no-op when every accepted version is already public', () => {
    const root = fixture()
    const manifest = JSON.parse(readFixture(root))
    const integrity = new Map(manifest.packages.map((entry) => [entry.name, entry.integrity]))
    const runNpm = vi.fn((args) => {
      if (args[0] === 'view') {
        const name = args[1].slice(0, args[1].lastIndexOf('@'))
        return result(0, JSON.stringify(integrity.get(name)))
      }
      return result(0)
    })

    publishCliNpmPackages({ packagesDir: root, runNpm, logger: silent() })
    expect(runNpm.mock.calls.some(([args]) => args[0] === 'publish')).toBe(false)
  })

  it('rejects an existing version with different registry integrity', () => {
    const root = fixture()
    const runNpm = vi.fn((args) => args[0] === 'view'
      ? result(0, JSON.stringify('sha512-different'))
      : result(0))

    expect(() => publishCliNpmPackages({ packagesDir: root, runNpm, logger: silent() }))
      .toThrow('openalice-darwin-arm64@0.90.2 is already published with different integrity')
  })

  it('accepts a successful publish that became visible after npm returned an error', () => {
    const root = fixture()
    const manifest = JSON.parse(readFixture(root))
    const expected = new Map(manifest.packages.map((entry) => [entry.name, entry.integrity]))
    const views = new Map()
    const runNpm = vi.fn((args) => {
      if (args[0] === 'publish') return result(1, '', 'connection reset')
      const name = args[1].slice(0, args[1].lastIndexOf('@'))
      const count = views.get(name) ?? 0
      views.set(name, count + 1)
      return count === 0
        ? result(1, '', 'npm error code E404')
        : result(0, JSON.stringify(expected.get(name)))
    })

    expect(() => publishCliNpmPackages({ packagesDir: root, runNpm, logger: silent() }))
      .not.toThrow()
  })

  it('verifies local tarball bytes before reading or mutating the registry', () => {
    const root = fixture()
    writeFileSync(join(root, 'openalice-darwin-arm64-0.90.2.tgz'), 'tampered')
    const runNpm = vi.fn()

    expect(() => publishCliNpmPackages({ packagesDir: root, runNpm, logger: silent() }))
      .toThrow('npm tarball integrity mismatch')
    expect(runNpm).not.toHaveBeenCalled()
  })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openalice-npm-publish-'))
  roots.push(root)
  const packages = packageNames.map((name) => {
    const filename = `${name}-0.90.2.tgz`
    const bytes = Buffer.from(`accepted bytes for ${name}`)
    writeFileSync(join(root, filename), bytes)
    return {
      name,
      version: '0.90.2',
      filename,
      shasum: createHash('sha1').update(bytes).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    }
  })
  writeFileSync(join(root, 'npm-publish-order.json'), `${JSON.stringify({
    schemaVersion: 1,
    version: '0.90.2',
    publishOrder: packageNames,
    packages,
  })}\n`)
  return root
}

function readFixture(root) {
  return readFileSync(join(root, 'npm-publish-order.json'), 'utf8')
}

function result(status, stdout = '', stderr = '') {
  return { status, stdout, stderr }
}

function silent() {
  return { log: vi.fn() }
}
