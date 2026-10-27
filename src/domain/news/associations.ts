import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { newsAssociationRecordSchema, type NewsAssociationRecord, type NewsAssociationView } from './association-contract.js'

export function associationView(record: NewsAssociationRecord | null, storyRevision: number): NewsAssociationView {
  const current = record?.history.at(-1)
  return current ? { status: current.storyRevision === storyRevision ? 'current' : 'needs-review', current } : { status: 'unassessed' }
}
export function evidenceDigest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }

function pathFor(directory: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error('Invalid event identity')
  return join(directory, '.associations', 'v1', `${id}.json`)
}
export async function readAssociations(directory: string, id: string): Promise<NewsAssociationRecord | null> {
  try {
    const record = newsAssociationRecordSchema.parse(JSON.parse(await readFile(pathFor(directory, id), 'utf8')))
    if (record.storyId !== id) throw new Error('Association identity mismatch')
    return record
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
/** Caller owns the event store's shared publication queue. */
export async function writeAssociations(directory: string, record: NewsAssociationRecord): Promise<void> {
  newsAssociationRecordSchema.parse(record)
  const path = pathFor(directory, record.storyId)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}
