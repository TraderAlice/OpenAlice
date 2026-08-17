/**
 * Standalone CLI copy of the AliceProject product stamp.
 * Keep the file path and JSON shape in sync with
 * `packages/guardian-runtime/src/alice-project-product.ts`.
 */
import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export type AliceProjectProduct = 'trader' | 'nano'

export interface AliceProjectProductStamp {
  readonly version: 1
  readonly product: AliceProjectProduct
}

export function aliceProjectProductStampPath(home: string): string {
  return join(resolve(home), 'data', 'config', 'alice-project.json')
}

export function parseAliceProjectProduct(value: unknown): AliceProjectProduct | null {
  return value === 'trader' || value === 'nano' ? value : null
}

export function parseAliceProjectProductStamp(value: unknown): AliceProjectProductStamp | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record['version'] !== 1) return null
  const product = parseAliceProjectProduct(record['product'])
  return product ? { version: 1, product } : null
}

export async function readAliceProjectProduct(home: string): Promise<AliceProjectProduct> {
  return (await readExistingStamp(home))?.product ?? 'trader'
}

export async function writeAliceProjectProductStamp(
  home: string,
  product: AliceProjectProduct,
): Promise<AliceProjectProduct> {
  const existing = await readExistingStamp(home)
  if (existing) return existing.product
  const path = aliceProjectProductStampPath(home)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const body = `${JSON.stringify({ version: 1, product } satisfies AliceProjectProductStamp, null, 2)}\n`
  try {
    await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    // A hard link publishes the fully written stamp without replacing an
    // existing birth record. POSIX rename would silently let a later creator
    // overwrite the first writer.
    await link(temporary, path)
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) {
      const raced = await readExistingStamp(home)
      if (raced) return raced.product
    }
    throw error
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
  return product
}

async function readExistingStamp(home: string): Promise<AliceProjectProductStamp | null> {
  const path = aliceProjectProductStampPath(home)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null
    throw new Error(`Could not read AliceProject product stamp at ${path}`, { cause: error })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`Invalid AliceProject product stamp at ${path}`, { cause: error })
  }
  const stamp = parseAliceProjectProductStamp(parsed)
  if (!stamp) throw new Error(`Invalid AliceProject product stamp at ${path}`)
  return stamp
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
