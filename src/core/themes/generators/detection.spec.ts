import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ThemeGeneratorDetectionManager,
  detectThemeGenerator,
  parseMatugenSchemes,
  revalidateGeneratorDetection,
  resolveFirstExecutable,
} from './detection.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function binDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-detection-test-'))
  roots.push(root)
  return root
}

async function executable(directory: string, name: string, body: string): Promise<string> {
  const path = join(directory, name)
  await writeFile(path, `#!/usr/bin/env node\n${body}`)
  await chmod(path, 0o755)
  return path
}

describe('theme generator detection', () => {
  it('resolves the first PATH match to its real absolute executable', async () => {
    const first = await binDir()
    const second = await binDir()
    const target = await executable(second, 'actual-matugen', 'process.exit(0)')
    await symlink(target, join(first, 'matugen'))
    await executable(second, 'matugen', 'process.exit(0)')

    await expect(resolveFirstExecutable('matugen', { PATH: `${first}:${second}`, HOME: first })).resolves.toBe(await realpath(target))
  })

  it('intersects actual Matugen possible values with the target schemes without inventing smart', () => {
    expect(parseMatugenSchemes('possible values: scheme-content, scheme-vibrant')).toEqual(['content', 'vibrant'])
    expect(parseMatugenSchemes('possible values: scheme-tonal-spot')).not.toContain('smart')
  })

  it('reports Matugen available with exact binary identity and probed schemes', async () => {
    const directory = await binDir()
    const path = await executable(directory, 'matugen', `
if (process.argv[2] === '--version') console.log('matugen 3.1.0')
else if (process.argv[2] === '--help') console.log('image')
else if (process.argv[2] === 'image' && process.argv[3] === '--help') console.log('--dry-run --json --mode possible values: light, dark --type <TYPE> --source-color-index --include-image-in-json possible values: scheme-content, scheme-smart')
else process.exit(2)
`)
    const result = await detectThemeGenerator('matugen', { PATH: directory, HOME: directory })
    expect(result).toMatchObject({
      kind: 'available', generator: 'matugen', executablePath: await realpath(path), version: 'matugen 3.1.0',
      capabilities: { kind: 'matugen', schemes: ['content', 'smart'] },
    })
    if (result.kind !== 'available') throw new Error('expected available')
    expect(result.binarySha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.detectionId).toMatch(/^[a-f0-9-]{36}$/)
  })

  it('keeps unavailable and unsupported independent and refreshable', async () => {
    const directory = await binDir()
    await executable(directory, 'hellwal', `
if (process.argv[2] === '--version') console.log('hellwal 1.0.7')
else if (process.argv[2] === '--help') console.log('--json --no-cache')
else process.exit(2)
`)
    const manager = new ThemeGeneratorDetectionManager()
    const snapshot = await manager.refresh({ PATH: directory, HOME: directory })
    expect(snapshot.generators.matugen).toEqual({ kind: 'unavailable', generator: 'matugen', reason: 'not-on-path' })
    expect(snapshot.generators.hellwal).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('--skip-term-colors') })
    expect(manager.snapshot).toBe(snapshot)
  })

  it('requires every side-effect and parameter flag before Hellwal is available', async () => {
    const directory = await binDir()
    await executable(directory, 'hellwal', `
if (process.argv[2] === '--version') console.log('hellwal 1.0.7')
else if (process.argv[2] === '--help') console.log('--json --no-cache --skip-term-colors --dark --light --dark-offset --bright-offset')
else process.exit(2)
`)
    await expect(detectThemeGenerator('hellwal', { PATH: directory, HOME: directory })).resolves.toMatchObject({
      kind: 'available', capabilities: { kind: 'hellwal', json: true, noCache: true, skipTermColors: true },
    })
  })

  it('detects execution-time disappearance, first-match replacement, and digest mutation', async () => {
    const directory = await binDir()
    const other = await binDir()
    const path = await executable(directory, 'hellwal', `
if (process.argv[2] === '--version') console.log('hellwal 1.0.7')
else console.log('--json --no-cache --skip-term-colors --dark --light --dark-offset --bright-offset')
`)
    const detected = await detectThemeGenerator('hellwal', { PATH: directory, HOME: directory })
    if (detected.kind !== 'available') throw new Error('expected available')
    await expect(revalidateGeneratorDetection(detected, { PATH: directory, HOME: directory })).resolves.toMatchObject({ kind: 'valid' })

    await executable(other, 'hellwal', 'console.log("replacement 2.0")')
    await expect(revalidateGeneratorDetection(detected, { PATH: `${other}:${directory}`, HOME: directory })).resolves.toEqual({ kind: 'changed', reason: 'path-changed' })

    await writeFile(path, '#!/usr/bin/env node\nconsole.log("mutated")')
    await chmod(path, 0o755)
    await expect(revalidateGeneratorDetection(detected, { PATH: directory, HOME: directory })).resolves.toEqual({ kind: 'changed', reason: 'digest-changed' })

    await rm(path)
    await expect(revalidateGeneratorDetection(detected, { PATH: directory, HOME: directory })).resolves.toEqual({ kind: 'changed', reason: 'missing' })
  })
})
