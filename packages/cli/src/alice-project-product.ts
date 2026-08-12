/**
 * Standalone CLI copy of the AliceProject product stamp.
 * Keep the file path and JSON shape in sync with
 * `packages/guardian-runtime/src/alice-project-product.ts`.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
  try {
    const parsed = JSON.parse(await readFile(aliceProjectProductStampPath(home), 'utf8')) as unknown
    return parseAliceProjectProductStamp(parsed)?.product ?? 'trader'
  } catch {
    return 'trader'
  }
}

export async function writeAliceProjectProductStamp(
  home: string,
  product: AliceProjectProduct,
): Promise<AliceProjectProduct> {
  const existing = await readExistingStamp(home)
  if (existing) return existing.product
  const path = aliceProjectProductStampPath(home)
  const temporary = `${path}.${process.pid}.tmp`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const body = `${JSON.stringify({ version: 1, product } satisfies AliceProjectProductStamp, null, 2)}\n`
  try {
    await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    const raced = await readExistingStamp(home)
    if (raced) return raced.product
    throw error
  }
  return product
}

async function readExistingStamp(home: string): Promise<AliceProjectProductStamp | null> {
  try {
    return parseAliceProjectProductStamp(
      JSON.parse(await readFile(aliceProjectProductStampPath(home), 'utf8')) as unknown,
    )
  } catch {
    return null
  }
}
