/**
 * Immutable AliceProject product birth (Trader vs Nano).
 *
 * Authority is the complete-home stamp. Missing file means trader so released
 * homes keep their existing behavior. First write wins; callers must not
 * treat this as a runtime switch.
 */
import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { isLiteModeEnv } from './trading-mode.js'

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

/** Missing stamps preserve the released Trader behavior; invalid stamps fail closed. */
export async function readAliceProjectProduct(home: string): Promise<AliceProjectProduct> {
  return (await readExistingStamp(home))?.product ?? 'trader'
}

/**
 * Write the birth stamp if the home has none. An existing valid stamp is
 * left untouched even when `product` differs.
 */
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
    // Publish without replacement: rename() would allow a concurrent creator
    // to overwrite the immutable product chosen by the first writer.
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

export async function shouldSkipUtaForHome(
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<{ skip: boolean; reason: 'nano' | 'lite' | null }> {
  if (await readAliceProjectProduct(home) === 'nano') {
    return { skip: true, reason: 'nano' }
  }
  if (isLiteModeEnv(env)) return { skip: true, reason: 'lite' }
  return { skip: false, reason: null }
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
