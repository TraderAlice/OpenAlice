import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm, readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { artifactSchema, manifestSchema, NEWS_MODULE_LIMITS, type NewsModuleArtifact, type InstalledModule } from './contract.js'

export function artifactHash(a: NewsModuleArtifact): string {
  return createHash('sha256').update(JSON.stringify([a.manifest, Object.entries(a.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)])).digest('hex')
}
function validPath(p: string): boolean {
  return p.length <= 200 && /^[a-zA-Z0-9_.\/-]+$/.test(p) && !['artifact.json','manifest.json','approval.json'].includes(p.toLowerCase()) && !p.startsWith('/') && p.split('/').every(s => s && s !== '.' && s !== '..' && !s.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))
}
function validate(value: unknown): NewsModuleArtifact {
  const a = artifactSchema.parse(value)
  const paths = Object.keys(a.files).map(path => path.toLowerCase())
  const names = new Set(paths)
  if (names.size !== paths.length || paths.some(path => path.split('/').slice(0,-1).some((_,index,parts) => names.has(parts.slice(0,index+1).join('/'))))) throw new Error('Conflicting module paths')
  if (Buffer.byteLength(JSON.stringify(a)) > NEWS_MODULE_LIMITS.artifact || Object.keys(a.files).length > 128 || !Object.keys(a.files).every(validPath) || !a.files[a.manifest.entry] || !/\.m?js$/.test(a.manifest.entry)) throw new Error('Invalid or oversized module artifact')
  return a
}
export class NewsModuleRegistry {
  constructor(readonly directory: string) {}
  private path(hash: string): string { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid module identity'); return join(this.directory, hash) }
  async isAbsent(hash:string):Promise<boolean>{
    try{await lstat(this.path(hash));return false}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error}
  }
  async read(hash: string): Promise<NewsModuleArtifact> {
    const root = this.path(hash)
    if ((await lstat(root)).isSymbolicLink()) throw new Error('Module artifact changed')
    const a = validate(JSON.parse(await readFile(join(root, 'artifact.json'), 'utf8')))
    const expected = new Set([...Object.keys(a.files),'artifact.json','manifest.json','approval.json'])
    const inspect = async (prefix: string): Promise<void> => {
      for (const item of await readdir(join(root,prefix),{withFileTypes:true})) {
        const path = prefix ? prefix+'/'+item.name : item.name
        if (item.isSymbolicLink()) throw new Error('Module artifact changed')
        if (item.isDirectory()) {
          if (!Object.keys(a.files).some(file=>file.startsWith(path+'/'))) throw new Error('Unexpected module member')
          await inspect(path)
        } else if (!item.isFile() || !expected.has(path)) throw new Error('Unexpected module member')
      }
    }
    await inspect('')
    if (JSON.stringify(manifestSchema.parse(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')))) !== JSON.stringify(a.manifest)) throw new Error('Module manifest changed')
    for (const [path, code] of Object.entries(a.files)) {
      let current = root
      for (const part of path.split('/')) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Module artifact changed') }
      if (await readFile(current, 'utf8') !== code) throw new Error('Module artifact changed')
    }
    if (artifactHash(a) !== hash) throw new Error('Module artifact changed')
    return a
  }
  async approved(hash: string): Promise<boolean> {
    try { return JSON.parse(await readFile(join(this.path(hash), 'approval.json'), 'utf8')).contentHash === hash }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw new Error('Module approval unavailable') }
  }
  async importArtifact(value: unknown): Promise<InstalledModule> {
    const a = validate(value), contentHash = artifactHash(a), destination = this.path(contentHash)
    await mkdir(this.directory, { recursive: true })
    try { await lstat(destination); await this.read(contentHash); return {manifest:a.manifest,contentHash,approved:await this.approved(contentHash)} }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const staging = join(this.directory, '.import-' + randomUUID())
    try {
      await mkdir(staging)
      for (const [path, code] of Object.entries(a.files)) {
        const target = join(staging, path), slash = target.lastIndexOf(process.platform === 'win32' ? '\\' : '/')
        await mkdir(target.slice(0, slash), { recursive: true })
        await writeFile(target, code, { mode:0o400, flag:'wx' })
      }
      await writeFile(join(staging, 'artifact.json'), JSON.stringify(a), { mode:0o400, flag:'wx' })
      await writeFile(join(staging, 'manifest.json'), JSON.stringify(a.manifest), { mode:0o400, flag:'wx' })
      await rename(staging, destination)
      return { manifest:a.manifest, contentHash, approved:false }
    } finally { await rm(staging, {recursive:true,force:true}) }
  }
  async approve(hash: string): Promise<InstalledModule> {
    const a = await this.read(hash)
    await writeFile(join(this.path(hash), 'approval.json'), JSON.stringify({contentHash:hash}), {mode:0o600})
    return {manifest:a.manifest,contentHash:hash,approved:true}
  }
  async list(): Promise<Array<InstalledModule | {manifest:null;contentHash:string;approved:false}>> {
    let names: string[]
    try { names = await readdir(this.directory) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
    const result: Array<InstalledModule | {manifest:null;contentHash:string;approved:false}> = []
    for (const hash of names.filter(n => /^[a-f0-9]{64}$/.test(n)).sort()) {
      try {
        const root=this.path(hash)
        if((await lstat(root)).isSymbolicLink() || (await lstat(join(root,'manifest.json'))).isSymbolicLink())throw new Error('Module manifest unavailable')
        const manifest = manifestSchema.parse(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')))
        result.push({ manifest, contentHash:hash, approved:await this.approved(hash) })
      } catch { result.push({manifest:null,contentHash:hash,approved:false}) }
    }
    return result
  }
  entry(hash: string, a: NewsModuleArtifact): string { return join(this.path(hash), a.manifest.entry) }
  async uninstall(hash: string): Promise<void> { await rm(this.path(hash), {recursive:true,force:true}) }
}
