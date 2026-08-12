/**
 * Immutable AliceProject product birth (Trader vs Nano).
 *
 * Authority is the complete-home stamp. Missing file means trader so released
 * homes keep their existing behavior. First write wins; callers must not
 * treat this as a runtime switch.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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

/** Missing or malformed stamps are trader. Never throws for ordinary homes. */
export async function readAliceProjectProduct(home: string): Promise<AliceProjectProduct> {
  try {
    const parsed = JSON.parse(await readFile(aliceProjectProductStampPath(home), 'utf8')) as unknown
    return parseAliceProjectProductStamp(parsed)?.product ?? 'trader'
  } catch {
    return 'trader'
  }
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
  try {
    return parseAliceProjectProductStamp(
      JSON.parse(await readFile(aliceProjectProductStampPath(home), 'utf8')) as unknown,
    )
  } catch {
    return null
  }
}
