import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildStaticManifest, validateStaticManifest } from './static-inventory.js'

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-color-audit-'))
  await mkdir(join(root, 'ui/src'), { recursive: true })
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, 'ui/src', path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, source)
  }
  return root
}

describe('static theme color inventory', () => {
  it('records exact CSS and TypeScript spans without deduplicating equal values', async () => {
    const root = await fixture({
      'component.css': '.card { color: #abc; box-shadow: 0 0 1px rgba(0, 0, 0, .4); }',
      'View.tsx': "export const View = () => <div className={`bg-red-500 ${active ? 'text-white' : 'text-black'}`} style={{ color: '#abc' }} />",
    })
    const manifest = await buildStaticManifest(root, 'fixture-commit')
    await validateStaticManifest(root, manifest)
    expect(manifest.occurrences.map((entry) => entry.sourceText)).toEqual([
      '#abc', 'rgba(0, 0, 0, .4)', 'bg-red-500', 'text-white', 'text-black', '#abc',
    ])
    expect(new Set(manifest.occurrences.map((entry) => entry.inventoryId)).size).toBe(6)
  })

  it('does not change IDs when directory enumeration order changes', async () => {
    const root = await fixture({ 'z.ts': "export const z = '#fff'", 'a.ts': "export const a = '#000'" })
    const first = await buildStaticManifest(root, 'fixture-commit')
    const second = await buildStaticManifest(root, 'fixture-commit')
    expect(first.occurrences.map((entry) => entry.inventoryId)).toEqual(second.occurrences.map((entry) => entry.inventoryId))
  })

  it('rejects malformed TypeScript instead of silently dropping it', async () => {
    const root = await fixture({ 'broken.ts': "export const color = '#fff" })
    await expect(buildStaticManifest(root, 'fixture-commit')).rejects.toThrow('Unterminated string literal')
  })
})
