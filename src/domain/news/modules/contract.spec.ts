import { describe, expect, it } from 'vitest'
import { artifactSchema, collectionResultSchema } from './contract.js'

const manifest = { abiVersion: 1, moduleId: 'test.news', version: '1', name: 'News', description: '', entry: 'entry.mjs', sources: [{ key: 'latest', name: 'Latest', parameters: [] }] }
const item = { externalId: 'x:123', title: 'Release', content: 'Original', url: 'https://x.com/example/status/123', publishedAt: '2026-10-21T01:00:00Z' }

describe('versioned news acquisition contract', () => {
  it('preserves the normalized v1 manifest without adding new hash members', () => {
    expect(artifactSchema.parse({ manifest, files: { 'entry.mjs': 'export {}' } }).manifest).toEqual(manifest)
    expect(collectionResultSchema(1).parse([item])).toEqual([item])
  })
  it('accepts a v2 checkpoint and original source information', () => {
    const rich = { ...item, publisher: 'Example', author: '@example', kind: 'social', role: 'official', language: 'en', symbols: ['NASDAQ:EXAMPLE'], media: [{ type: 'image', url: 'https://example.test/a.png' }], quote: { author: '@other', text: 'Quoted original', url: 'https://x.com/other/status/1' } }
    const result = { items: [rich], checkpoint: { sinceId: '123' } }
    expect(artifactSchema.parse({ manifest: { ...manifest, abiVersion: 2, credentials: [{ key: 'apiKey', label: 'API key' }] }, files: { 'entry.mjs': 'export {}' } }).manifest.abiVersion).toBe(2)
    expect(collectionResultSchema(2).parse(result)).toEqual(result)
  })
  it('rejects rich data in v1, unsafe media URLs, duplicate credentials and oversized checkpoints', () => {
    expect(() => collectionResultSchema(1).parse([{ ...item, publisher: 'No v1 extension' }])).toThrow()
    expect(() => collectionResultSchema(2).parse({ items: [{ ...item, media: [{ type: 'image', url: 'file:///secret' }] }], checkpoint: null })).toThrow()
    expect(() => artifactSchema.parse({ manifest: { ...manifest, abiVersion: 2, credentials: [{ key: 'apiKey', label: 'A' }, { key: 'apiKey', label: 'B' }] }, files: {} })).toThrow()
    expect(() => artifactSchema.parse({ manifest: { ...manifest, abiVersion: 2, credentials: [{ key: 'apiKey', label: 'A' }, { key: 'apikey', label: 'B' }] }, files: {} })).toThrow()
    expect(() => collectionResultSchema(2).parse({ items: [], checkpoint: { huge: 'x'.repeat(17000) } })).toThrow()
  })
})
