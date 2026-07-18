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

  it('separates CSS custom property definitions from consuming declarations', async () => {
    const root = await fixture({ 'theme.css': ':root { --accent: #abc; } .card { color: #abc; background: transparent; }' })
    const manifest = await buildStaticManifest(root, 'fixture-commit')
    expect(manifest.occurrences.map(({ sourceText, role }) => [sourceText, role])).toEqual([
      ['#abc', 'css-variable-definition'], ['#abc', 'color-consumer'], ['transparent', 'color-consumer'],
    ])
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

  it('classifies only the eight protectedColors AST leaves as protected source data', async () => {
    const root = await fixture({
      'theme/colorPolicy.ts': `
        type ModePair = Readonly<Record<'light' | 'dark', string>>
        const nearby = '#ffffff'
        const protectedColors = {
          green: { light: '#137333', dark: '#81c995' },
          red: { light: '#b3261e', dark: '#f28b82' },
          warning: { light: '#8a4b00', dark: '#fdd663' },
          info: { light: '#0b57d0', dark: '#8ab4f8' },
        } as const satisfies Readonly<Record<string, ModePair>>
        const other = { green: { light: '#010101', dark: '#020202' } }
      `,
      'other.ts': `const protectedColors = { green: { light: '#030303', dark: '#040404' } }`,
    })

    const manifest = await buildStaticManifest(root, 'fixture-commit')
    const protectedEntries = manifest.occurrences.filter((entry) => entry.role === 'protected-source-data')
    expect(protectedEntries).toHaveLength(8)
    expect(protectedEntries.map((entry) => entry.sourceText)).toEqual([
      '#137333', '#81c995', '#b3261e', '#f28b82',
      '#8a4b00', '#fdd663', '#0b57d0', '#8ab4f8',
    ])
    expect(protectedEntries.every((entry) => entry.sourceClass === 'built-in-source-data')).toBe(true)

    const decoys = manifest.occurrences.filter((entry) => !protectedEntries.includes(entry))
    expect(decoys).toHaveLength(5)
    expect(decoys.every((entry) => entry.role === 'color-consumer' && entry.sourceClass === 'runtime')).toBe(true)
  })
})
