import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { StickerPacks, STICKER_SKILLS, STICKER_STATE } from './sticker-packs.js'
import { isManagedTemplatePath } from './template-upgrade.js'
let root: string
let ws: string
let packs: StickerPacks
const image = Buffer.from('89504e470d0a1a0a00000000', 'hex')
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stickers-'))
  ws = join(root, 'ws'); await mkdir(ws)
  const source = join(root, 'bundled', 'alice-color'); await mkdir(source, { recursive: true })
  await writeFile(join(source, 'wave.png'), image)
  await writeFile(join(source, 'pack.json'), JSON.stringify({ schemaVersion: 1, id: 'alice-color', name: 'Color', version: '1.0.0', stickers: [{ file: 'wave.png', description: 'Hello' }] }))
  packs = new StickerPacks(join(root, 'project'), join(root, 'bundled'))
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
async function apply(enabled: boolean, packId = 'alice-color', restore = false) {
  const selection = { enabled, packId }
  const plan = await packs.preview(ws, selection)
  return packs.apply(ws, selection, plan.digest, restore)
}
it('initializes flat images and mirrored hydrated Skill, independently of normal template upgrades', async () => {
  await packs.initialize(ws)
  expect(await readFile(join(ws, 'sticker/wave.png'))).toEqual(image)
  const skill = await readFile(join(ws, STICKER_SKILLS[0]), 'utf8')
  expect(skill).toContain('[[sticker/wave.png]] — Hello')
  expect(await readFile(join(ws, STICKER_SKILLS[1]), 'utf8')).toBe(skill)
  for (const path of STICKER_SKILLS) expect(isManagedTemplatePath(path)).toBe(false)
  await expect(readFile(join(ws, 'AGENTS.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  await apply(false)
  await packs.initialize(ws)
  await expect(readFile(join(ws, STICKER_SKILLS[0]))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await packs.status(ws))?.enabled).toBe(false)
  expect(await readFile(join(ws, 'sticker/wave.png'))).toEqual(image)
  await apply(true)
  expect((await packs.inspect(ws)).skillPresent).toBe(true)
})
it('preserves unrelated files, blocks unowned collisions and requires explicit restore for owned edits', async () => {
  await mkdir(join(ws, 'sticker'))
  await writeFile(join(ws, 'sticker/wave.png'), 'custom')
  await expect(apply(true, 'alice-color', true)).rejects.toThrow('Local files conflict')
  await rm(join(ws, 'sticker/wave.png'))
  await apply(true)
  await writeFile(join(ws, 'sticker/mine.png'), 'personal')
  await writeFile(join(ws, 'sticker/wave.png'), 'custom')
  await expect(apply(true)).rejects.toThrow('Local files conflict')
  await apply(true, 'alice-color', true)
  expect(await readFile(join(ws, 'sticker/mine.png'), 'utf8')).toBe('personal')
})
it('imports a pack, switches managed files and changes defaults only for new Workspaces', async () => {
  await apply(true)
  await packs.importImages([{ file: 'thanks.png', bytes: image }], { id: 'ink', name: 'Ink', version: '2.0' })
  await packs.setDefault('ink')
  expect((await packs.status(ws))?.packId).toBe('alice-color')
  await apply(true, 'ink')
  await expect(readFile(join(ws, 'sticker/wave.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(ws, 'sticker/thanks.png'))).toEqual(image)
  expect(await packs.defaultPack()).toBe('ink')
})
it('rejects stale previews, symlinks, traversal filenames and invalid images', async () => {
  const selection = { enabled: true, packId: 'alice-color' }
  const plan = await packs.preview(ws, selection)
  await mkdir(join(ws, 'sticker')); await writeFile(join(ws, 'sticker/wave.png'), 'new')
  await expect(packs.apply(ws, selection, plan.digest)).rejects.toThrow('Files changed')
  await rm(join(ws, 'sticker'), { recursive: true }); await symlink(root, join(ws, 'sticker'))
  await expect(packs.preview(ws, selection)).rejects.toThrow('symlinks')
  await expect(packs.importImages([{ file: '../escape.png', bytes: image }], { id: 'bad', name: 'Bad', version: '1' })).rejects.toThrow()
  await expect(packs.importImages([{ file: 'bad.png', bytes: Buffer.from('not image') }], { id: 'bad', name: 'Bad', version: '1' })).rejects.toThrow('image bytes')
})
it('rejects corrupt ownership and safely rolls back an interrupted projection', async () => {
  await apply(true)
  const before = await readFile(join(ws, STICKER_SKILLS[0]))
  await writeFile(join(ws, STICKER_SKILLS[0]), 'partial')
  await writeFile(join(ws, '.alice/sticker-transaction.json'), JSON.stringify({ before: { [STICKER_SKILLS[0]]: before.toString('base64') }, after: { [STICKER_SKILLS[0]]: Buffer.from('partial').toString('base64') } }))
  await packs.recover(ws)
  expect(await readFile(join(ws, STICKER_SKILLS[0]))).toEqual(before)
  const state = await packs.status(ws)
  await writeFile(join(ws, STICKER_STATE), JSON.stringify({ ...state, files: { '../escape': 'bad' } }))
  await expect(packs.inspect(ws)).rejects.toThrow('ownership')
})
it('publishes new imported revisions without touching accepted Workspace copies', async () => {
  const first = await packs.importImages([{ file: 'thanks.png', bytes: image }], { id: 'ink', name: 'Ink', version: '1' })
  await apply(true, 'ink')
  const next = await packs.importImages([{ file: 'wave.png', bytes: image }], { id: 'ink', name: 'Ink', version: '2' })
  expect(next.revision).not.toBe(first.revision)
  expect((await packs.status(ws))?.revision).toBe(first.revision)
  expect((await packs.get('ink')).pack.revision).toBe(next.revision)
  await apply(true, 'ink')
  expect((await packs.status(ws))?.revision).toBe(next.revision)
  await expect(readFile(join(ws, 'sticker/thanks.png'))).rejects.toMatchObject({ code: 'ENOENT' })
})
