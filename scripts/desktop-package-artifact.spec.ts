import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanupTemporaryDesktopPackageArtifact,
  createTemporaryDesktopPackageArtifact,
  DEFAULT_DESKTOP_PACKAGE_ROOT,
  DESKTOP_PACKAGE_OWNER_MARKER,
  resolveDesktopPackageRootArg,
} from './desktop-package-artifact.mjs'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('temporary desktop package ownership', () => {
  it('uses the persistent package root unless an explicit root is supplied', () => {
    expect(resolveDesktopPackageRootArg([])).toBe(DEFAULT_DESKTOP_PACKAGE_ROOT)
    expect(resolveDesktopPackageRootArg(['--package-root', 'build/app'], '/repo')).toBe('/repo/build/app')
    expect(resolveDesktopPackageRootArg(['--', '--package-root', 'build/app'], '/repo')).toBe('/repo/build/app')
    expect(() => resolveDesktopPackageRootArg(['--package-root'])).toThrow('usage: --package-root <path>')
  })

  it('creates an isolated package root and removes only its owner directory', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'openalice-package-artifact-test-'))
    roots.push(temporaryRoot)
    const artifact = createTemporaryDesktopPackageArtifact({
      temporaryRoot,
      pid: 42,
      createdAt: '2026-07-12T00:00:00.000Z',
    })
    mkdirSync(artifact.packageRoot)

    expect(artifact.owner).toEqual({
      kind: 'openalice-desktop-package-smoke',
      pid: 42,
      createdAt: '2026-07-12T00:00:00.000Z',
    })
    expect(cleanupTemporaryDesktopPackageArtifact(artifact)).toEqual({
      cleaned: true,
      kept: false,
      error: null,
    })
    expect(existsSync(artifact.ownerRoot)).toBe(false)
    expect(existsSync(temporaryRoot)).toBe(true)
  })

  it('preserves an owned package when explicitly requested', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'openalice-package-artifact-test-'))
    roots.push(temporaryRoot)
    const artifact = createTemporaryDesktopPackageArtifact({ temporaryRoot })

    expect(cleanupTemporaryDesktopPackageArtifact(artifact, { keep: true })).toEqual({
      cleaned: false,
      kept: true,
      error: null,
    })
    expect(existsSync(artifact.ownerRoot)).toBe(true)
  })

  it('refuses to remove a directory whose ownership marker was replaced', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'openalice-package-artifact-test-'))
    roots.push(temporaryRoot)
    const artifact = createTemporaryDesktopPackageArtifact({ temporaryRoot })
    writeFileSync(join(artifact.ownerRoot, DESKTOP_PACKAGE_OWNER_MARKER), '{"kind":"some-other-owner"}\n')

    const result = cleanupTemporaryDesktopPackageArtifact(artifact)

    expect(result.cleaned).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(existsSync(artifact.ownerRoot)).toBe(true)
  })

  it('configures Windows-friendly retries for the recursive removal', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'openalice-package-artifact-test-'))
    roots.push(temporaryRoot)
    const artifact = createTemporaryDesktopPackageArtifact({ temporaryRoot })
    let removalOptions: Record<string, unknown> | undefined

    const result = cleanupTemporaryDesktopPackageArtifact(artifact, {
      remove: (_path: string, options: Record<string, unknown>) => {
        removalOptions = options
      },
    })

    expect(result.cleaned).toBe(true)
    expect(removalOptions).toMatchObject({
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    })
  })
})
