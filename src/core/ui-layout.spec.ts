import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ACTIVITY_PAGE_IDS,
  defaultUiLayout,
  normalizeUiLayout,
  parseUiLayoutWrite,
  readUiLayout,
  UiLayoutError,
  writeUiLayout,
} from './ui-layout.js'

const roots: string[] = []

async function layoutFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-ui-layout-'))
  roots.push(root)
  return join(root, 'ui-layout.json')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ui-layout', () => {
  it('accepts the Auto Prediction page emitted by the Activity Bar editor', () => {
    const layout = defaultUiLayout()
    expect(layout.groups.find((group) => group.id === 'beta')?.items).toContain('prediction')
    expect(() => parseUiLayoutWrite(layout)).not.toThrow()
  })

  it('hides Dev by default and keeps Settings visible', () => {
    const layout = defaultUiLayout()
    expect(layout.hidden).toEqual(['dev'])
    expect(layout.groups.find((group) => group.id === 'system')?.items).toContain('dev')
    expect(layout.groups.find((group) => group.id === 'system')?.items).toContain('settings')
    expect(layout.hidden).not.toContain('settings')
  })

  it('drops a retired news rail entry from persisted layouts', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [{ id: 'primary', items: ['chat', 'market', 'news'] }],
      hidden: ['news', 'dev'],
    })
    expect(layout.groups.find((group) => group.id === 'primary')?.items).not.toContain('news')
    expect(layout.hidden).not.toContain('news')
    expect(layout.hidden).toEqual(['dev'])
  })

  it('drops a retired trading-as-git rail entry from persisted layouts', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [{ id: 'beta', items: ['office', 'trading-as-git', 'portfolio', 'connectors'] }],
      hidden: ['trading-as-git', 'dev'],
    })
    expect(layout.groups.find((group) => group.id === 'beta')?.items).toEqual([
      'office',
      'portfolio',
      'connectors',
      'prediction',
    ])
    expect(layout.hidden).not.toContain('trading-as-git')
    expect(layout.hidden).toEqual(['dev'])
  })

  it('treats a missing or malformed file as the default document', async () => {
    const path = await layoutFile()
    expect(await readUiLayout(path)).toEqual(defaultUiLayout())

    await writeFile(path, '{not-json', 'utf-8')
    expect(await readUiLayout(path)).toEqual(defaultUiLayout())
  })

  it('drops unknown pages, appends missing catalog pages, and forces Settings visible', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [
        { id: 'primary', items: ['chat', 'unknown-page'] },
        { id: 'custom:research', label: 'Research', items: ['inbox'] },
      ],
      hidden: ['dev', 'settings', 'ghost'],
    })

    const pages = layout.groups.flatMap((group) => group.items)
    expect(pages).not.toContain('unknown-page')
    expect(new Set(pages)).toEqual(new Set(ACTIVITY_PAGE_IDS))
    expect(layout.hidden).toEqual(['dev'])
    expect(layout.groups.find((group) => group.id === 'custom:research')?.items).toEqual(['inbox'])
    expect(layout.groups.find((group) => group.id === 'system')?.items).toContain('settings')
  })

  it('rejects duplicate membership, empty custom labels, and hiding Settings', () => {
    expect(() => parseUiLayoutWrite({
      version: 1,
      groups: [
        { id: 'primary', items: ['chat'] },
        { id: 'system', items: ['chat', 'settings'] },
      ],
      hidden: [],
    })).toThrow(UiLayoutError)

    expect(() => parseUiLayoutWrite({
      version: 1,
      groups: [{ id: 'custom:research', items: ['chat'] }],
      hidden: [],
    })).toThrow(/label/i)

    expect(() => parseUiLayoutWrite({
      version: 1,
      groups: defaultUiLayout().groups,
      hidden: ['settings'],
    })).toThrow(/Settings cannot be hidden/)
  })

  it('persists a normalized document', async () => {
    const path = await layoutFile()
    const written = await writeUiLayout({
      version: 1,
      groups: [
        { id: 'primary', items: ['chat', 'inbox'] },
        { id: 'beta', items: ['office'] },
        { id: 'system', items: ['settings'] },
        { id: 'custom:desk', label: 'Desk', items: ['issue'] },
      ],
      hidden: ['dev'],
    }, path)

    expect(written.groups.find((group) => group.id === 'custom:desk')).toEqual({
      id: 'custom:desk',
      label: 'Desk',
      items: ['issue'],
    })
    expect(written.groups.find((group) => group.id === 'system')?.items).toContain('workspaces')
    const raw = JSON.parse(await readFile(path, 'utf-8'))
    expect(raw).toEqual(written)
    expect(await readUiLayout(path)).toEqual(written)
  })
})
