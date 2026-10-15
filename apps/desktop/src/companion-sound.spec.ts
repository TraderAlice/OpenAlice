import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompanionSoundStore, DEFAULT_SOUND } from './companion-sound.js'

const dirs: string[] = []
function path() { const dir = mkdtempSync(join(tmpdir(), 'pet-sound-test-')); dirs.push(dir); return join(dir, 'sound.json') }
const wav = Buffer.alloc(46)
wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(2, 40)
const source = { name: 'click.wav', dataUrl: 'data:audio/wav;base64,' + wav.toString('base64') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
describe('local pet sound preferences', () => {
  it('starts without any bundled audio and persists copied sound across restarts', async () => {
    const file = path(), store = createCompanionSoundStore(file)
    expect(store.get()).toEqual(DEFAULT_SOUND)
    await store.update({ source, volume: .2, enabled: false })
    expect(createCompanionSoundStore(file).get()).toEqual({ source, volume: .2, enabled: false })
    await store.update(DEFAULT_SOUND)
    expect(createCompanionSoundStore(file).get()).toEqual(DEFAULT_SOUND)
  })
  it('supports a bundled default and restores it after a custom sound', async () => {
    const file = path()
    const defaults = { ...DEFAULT_SOUND, source }
    const store = createCompanionSoundStore(file, defaults)
    expect(store.get()).toEqual(defaults)
    await store.update({ source: null })
    expect(store.get().source).toBeNull()
    expect(await store.reset()).toEqual(defaults)
    expect(createCompanionSoundStore(file, defaults).get()).toEqual(defaults)
  })
  it('serializes patches without losing the source or volume', async () => {
    const store = createCompanionSoundStore(path())
    await Promise.all([store.update({ source }), store.update({ volume: .8 }), store.update({ enabled: false })])
    expect(store.get()).toEqual({ source, volume: .8, enabled: false })
  })
  it('rejects paths, remote URLs, invalid signatures and invalid volumes', () => {
    const store = createCompanionSoundStore(path())
    for (const patch of [{ volume: -1 }, { volume: 2 }, { volume: NaN }, { path: '/etc/passwd' },
      { source: { name: 'a.wav', dataUrl: 'file:///etc/passwd' } },
      { source: { name: 'a.wav', dataUrl: 'https://example.com/a.wav' } },
      { source: { name: 'a.wav', dataUrl: 'data:audio/wav;base64,' + Buffer.alloc(20).toString('base64') } }]) {
      expect(() => store.update(patch)).toThrow()
    }
  })
  it('recovers malformed stored data silently', () => {
    const file = path(); writeFileSync(file, '{broken')
    expect(createCompanionSoundStore(file).get()).toEqual(DEFAULT_SOUND)
  })
})
