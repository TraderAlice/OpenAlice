import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { z } from 'zod'
import { dataPath, defaultPath } from '../core/paths.js'

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const filename = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.(png|webp)$/)
export const stickerPackSchema = z.object({ schemaVersion: z.literal(1), id: key, name: z.string().min(1).max(80),
  version: z.string().min(1).max(40), stickers: z.array(z.object({ file: filename, description: z.string().min(1).max(160) })).min(1).max(100) })
export type StickerPack = z.infer<typeof stickerPackSchema> & { revision: string; source: 'builtin' | 'imported' }
const stateSchema = z.object({ schemaVersion: z.literal(1), enabled: z.boolean(), packId: key, revision: z.string(),
  files: z.record(z.string(), z.string()) })
export type StickerState = z.infer<typeof stateSchema>
export const STICKER_STATE = '.alice/stickers.json'
const JOURNAL = '.alice/sticker-transaction.json'
export const STICKER_SKILLS = ['.agents/skills/alice-stickers/SKILL.md', '.claude/skills/alice-stickers/SKILL.md']
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const managed = (path: string) => path === STICKER_STATE || STICKER_SKILLS.includes(path) || /^sticker\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.(png|webp)$/.test(path)

export class StickerPacks {
  constructor(readonly root = dataPath('stickers'), readonly bundled = defaultPath('stickers')) {}
  private async sources() {
    const result: { dir: string; source: 'builtin' | 'imported' }[] = []
    for (const [root, source] of [[this.bundled, 'builtin'], [join(this.root, 'packs'), 'imported']] as const) {
      for (const entry of await readdir(root, { withFileTypes: true }).catch(error => { if (isMissing(error)) return []; throw error })) {
        if (entry.isDirectory()) {
          if (source === 'builtin') result.push({ dir: join(root, entry.name), source })
          else {
            const current = await readFile(join(root, entry.name, 'current.json'), 'utf8').catch(error => { if (isMissing(error)) return null; throw error })
            if (!current) continue // An import has not published its first revision yet.
            const pointer = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).parse(JSON.parse(current))
            result.push({ dir: join(root, entry.name, 'revisions', pointer.revision), source })
          }
        }
      }
    }
    return result
  }
  private async load(dir: string, source: 'builtin' | 'imported') {
    const manifest = stickerPackSchema.parse(JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8')))
    const names = manifest.stickers.map(item => item.file.toLowerCase())
    if (new Set(names).size !== names.length) throw new Error('Duplicate sticker filenames')
    const files: Record<string, Buffer> = {}
    for (const item of manifest.stickers) {
      const file = await readFile(join(dir, item.file))
      validateImage(item.file, file)
      files[item.file] = file
    }
    const revision = `${manifest.version}+${hash(JSON.stringify(manifest) + renderStickerSkill({ ...manifest, revision: '', source }) + Object.entries(files).map(([name, bytes]) => `${name}:${hash(bytes)}`).join('\n')).slice(0, 12)}`
    return { pack: { ...manifest, revision, source } satisfies StickerPack, files }
  }
  async catalog(): Promise<StickerPack[]> {
    return Promise.all((await this.sources()).map(async item => (await this.load(item.dir, item.source)).pack))
  }
  async get(id: string) {
    key.parse(id)
    for (const item of await this.sources()) {
      const loaded = await this.load(item.dir, item.source)
      if (loaded.pack.id === id) return loaded
    }
    throw new Error('Sticker pack not found')
  }
  async image(id: string, name: string) {
    key.parse(id); filename.parse(name)
    for (const item of await this.sources()) {
      const manifest = stickerPackSchema.parse(JSON.parse(await readFile(join(item.dir, 'pack.json'), 'utf8')))
      if (manifest.id !== id) continue
      if (!manifest.stickers.some(sticker => sticker.file === name)) throw new Error('Sticker not found')
      const bytes = await readFile(join(item.dir, name))
      validateImage(name, bytes)
      return bytes
    }
    throw new Error('Sticker pack not found')
  }
  async defaultPack(): Promise<string> {
    try { return key.parse(JSON.parse(await readFile(join(this.root, 'settings.json'), 'utf8')).defaultPackId) }
    catch (error) { if (isMissing(error)) return 'alice-color'; throw error }
  }
  async setDefault(id: string) {
    await this.get(id)
    await mkdir(this.root, { recursive: true })
    await atomic(join(this.root, 'settings.json'), Buffer.from(JSON.stringify({ defaultPackId: id })))
  }
  async importImages(images: { file: string; bytes: Uint8Array; description?: string }[], input: { id: string; name: string; version: string }) {
    key.parse(input.id)
    if (!images.length || images.length > 100) throw new Error('Select 1–100 images')
    const seen = new Set<string>()
    let total = 0
    const entries: Record<string, Uint8Array> = {}
    for (const image of images) {
      filename.parse(image.file)
      const name = image.file.toLowerCase()
      if (seen.has(name)) throw new Error('Duplicate sticker filenames')
      seen.add(name)
      validateImage(image.file, image.bytes)
      if ((total += image.bytes.length) > 32 * 1024 * 1024) throw new Error('Images must total at most 32 MiB')
      entries[image.file] = image.bytes
    }
    const manifest = stickerPackSchema.parse({ schemaVersion: 1, ...input, stickers: images.map(image => ({ file: image.file, description: image.description?.trim() || image.file.replace(/\.(png|webp)$/i, '').replaceAll('_', ' ').replaceAll('-', ' ') })) })
    if ((await this.catalog()).some(pack => pack.id === input.id && pack.source === 'builtin')) throw new Error('Choose a different ID for an imported pack')
    const staging = join(this.root, `import-${randomUUID()}`)
    await mkdir(staging, { recursive: true })
    try {
      await writeFile(join(staging, 'pack.json'), JSON.stringify(manifest, null, 2))
      for (const item of manifest.stickers) {
        const bytes = entries[item.file]
        if (!bytes) throw new Error(`Missing sticker: ${item.file}`)
        validateImage(item.file, bytes)
        await writeFile(join(staging, item.file), bytes)
      }
      const loaded = await this.load(staging, 'imported')
      const packRoot = join(this.root, 'packs', input.id)
      const revision = hash(loaded.pack.revision)
      const target = join(packRoot, 'revisions', revision)
      await mkdir(dirname(target), { recursive: true })
      try { await rename(staging, target) }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
      // Only the tiny current pointer changes. Accepted Workspace versions and old prototypes remain intact.
      await atomic(join(packRoot, 'current.json'), Buffer.from(JSON.stringify({ revision })))
      return loaded.pack
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
  async status(dir: string): Promise<StickerState | null> {
    const bytes = await readSafe(dir, STICKER_STATE)
    if (!bytes) return null
    const state = stateSchema.parse(JSON.parse(bytes.toString()))
    if (Object.keys(state.files).some(path => !managed(path) || path === STICKER_STATE)) throw new Error('Invalid sticker ownership paths')
    return state
  }
  async inspect(dir: string) {
    const state = await this.status(dir)
    const changed: string[] = []
    for (const [path, expected] of Object.entries(state?.files ?? {})) {
      const content = await readSafe(dir, path)
      if (!content || hash(content) !== expected) changed.push(path)
    }
    const skillPresent = (await Promise.all(STICKER_SKILLS.map(path => readSafe(dir, path)))).every(Boolean)
    return { state, changed, skillPresent }
  }
  async preview(dir: string, selection: { enabled: boolean; packId: string }) {
    const current = await this.status(dir)
    const { pack, files } = await this.get(selection.packId)
    const desired: Record<string, Buffer | null> = {}
    const owned = current?.files ?? {}
    if (selection.enabled) {
      for (const path of Object.keys(owned)) { if (!managed(path)) throw new Error('Invalid sticker state'); desired[path] = null }
      for (const [name, bytes] of Object.entries(files)) desired[`sticker/${name}`] = bytes
      const skill = Buffer.from(renderStickerSkill(pack))
      for (const path of STICKER_SKILLS) desired[path] = skill
    } else for (const path of STICKER_SKILLS) desired[path] = null
    const nextFiles = selection.enabled ? {} as Record<string, string> : { ...owned }
    for (const [path, bytes] of Object.entries(desired)) {
      if (bytes) nextFiles[path] = hash(bytes)
      else delete nextFiles[path]
    }
    const next = { schemaVersion: 1 as const, enabled: selection.enabled, packId: selection.enabled ? pack.id : current?.packId ?? pack.id,
      revision: selection.enabled ? pack.revision : current?.revision ?? pack.revision, files: nextFiles }
    desired[STICKER_STATE] = Buffer.from(JSON.stringify(next, null, 2) + '\n')
    const before: Record<string, Buffer | null> = {}
    const conflicts: { path: string; owned: boolean }[] = []
    for (const [path, wanted] of Object.entries(desired)) {
      const bytes = await readSafe(dir, path)
      before[path] = bytes
      if (path === STICKER_STATE || !bytes || (wanted && bytes.equals(wanted))) continue
      if (!owned[path] || hash(bytes) !== owned[path]) conflicts.push({ path, owned: !!owned[path] })
    }
    const digest = hash(JSON.stringify({ selection: { enabled: selection.enabled, packId: selection.packId }, revision: pack.revision, before: encode(before), after: encode(desired) }))
    return { digest, conflicts, pack, next, before, desired }
  }
  async apply(dir: string, selection: { enabled: boolean; packId: string }, digest: string, restore = false) {
    await this.recover(dir)
    const plan = await this.preview(dir, selection)
    if (plan.digest !== digest) throw new Error('Files changed; review the sticker update again')
    if (plan.conflicts.some(item => !item.owned || !restore)) throw new Error('Local files conflict; preserve them or explicitly restore managed files')
    const journal = Buffer.from(JSON.stringify({ before: encode(plan.before), after: encode(plan.desired) }))
    await safeWrite(dir, JOURNAL, journal)
    try {
      for (const [path, bytes] of Object.entries(plan.desired)) await safeWrite(dir, path, bytes)
      await safeWrite(dir, JOURNAL, null)
    } catch (error) { await this.recover(dir); throw error }
    return plan.next
  }
  async recover(dir: string) {
    const bytes = await readSafe(dir, JOURNAL)
    if (!bytes) return
    const record = z.object({ before: z.record(z.string(), z.string().nullable()), after: z.record(z.string(), z.string().nullable()) }).parse(JSON.parse(bytes.toString()))
    for (const [path, old] of Object.entries(record.before)) {
      if (!managed(path)) throw new Error('Invalid sticker recovery path')
      const current = (await readSafe(dir, path))?.toString('base64') ?? null
      if (current !== old && current !== record.after[path]) throw new Error('Sticker recovery needs review: files changed during interruption')
    }
    for (const [path, old] of Object.entries(record.before)) await safeWrite(dir, path, old === null ? null : Buffer.from(old, 'base64'))
    await safeWrite(dir, JOURNAL, null)
  }
  async initialize(dir: string) {
    if (await this.status(dir)) return
    const selection = { enabled: true, packId: await this.defaultPack() }
    const plan = await this.preview(dir, selection)
    await this.apply(dir, selection, plan.digest)
  }
}

export function renderStickerSkill(pack: StickerPack) {
  return `---\nname: alice-stickers\ndescription: Optional expressive stickers for casual user conversation in a chat that supports image replies.\n---\n\n# Alice stickers\n\nUse a sticker when it adds to the conversation. Send at most one sticker per reply. No need to inspect images or use a sticker in every reply. Send a listed relative path as a double-bracket reference.\n\n${pack.stickers.map(item => `- [[sticker/${item.file}]] — ${item.description.replace(/[\r\n]/g, ' ')}`).join('\n')}\n`
}
function validateImage(name: string, bytes: Uint8Array) {
  filename.parse(name)
  const file = Buffer.from(bytes)
  if (file.length > 512 * 1024) throw new Error('Each sticker must be at most 512 KiB')
  if (name.endsWith('.png') ? file.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' : file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Expected PNG or WebP image bytes')
}
function encode(files: Record<string, Buffer | null>) { return Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, bytes?.toString('base64') ?? null])) }
async function safePath(root: string, path: string) {
  if (!managed(path) && path !== JOURNAL) throw new Error('Invalid sticker path')
  const parts = path.split('/')
  for (let i = 1; i <= parts.length; i++) {
    const stat = await lstat(join(root, ...parts.slice(0, i))).catch(error => { if (isMissing(error)) return null; throw error })
    if (stat?.isSymbolicLink() || (stat && i < parts.length && !stat.isDirectory()) || (stat && i === parts.length && !stat.isFile())) throw new Error('Sticker paths must be regular files without symlinks')
  }
  return join(root, path)
}
async function readSafe(root: string, path: string) {
  const file = await safePath(root, path)
  return readFile(file).catch(error => { if (isMissing(error)) return null; throw error })
}
async function atomic(file: string, bytes: Buffer) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, bytes); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}
async function safeWrite(root: string, path: string, bytes: Buffer | null) {
  const file = await safePath(root, path)
  if (bytes) await atomic(file, bytes)
  else {
    await rm(file, { force: true })
    if (STICKER_SKILLS.includes(path)) await rmdir(dirname(file)).catch(error => {
      if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    })
  }
}
