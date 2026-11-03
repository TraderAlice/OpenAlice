/**
 * Admin token store.
 *
 * The single source of "is this the legitimate operator." A 32-byte random
 * token generated on first run. The plaintext is shown ONCE (stdout + the
 * post-bootstrap caller). On disk we keep only a scrypt-derived hash so
 * `cat data/config/auth.json` doesn't leak the live credential.
 *
 * Threat model assumptions:
 *  - Token is the only "identity." There is no user concept.
 *  - We trust the disk inode permissions to be tight (chmod 600).
 *  - We do NOT defend against host root — root can read anything.
 *  - We DO defend against accidental log-spillage and stale backups
 *    revealing the live token.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'

const TOKEN_BYTES = 32         // 256 bits of entropy
const SALT_BYTES = 16
const KEY_LEN = 64
// scrypt parameters: N=16384, r=8, p=1 is the OWASP-recommended floor for
// interactive-login workloads as of 2024.
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

const AUTH_FILE = () => dataPath('config', 'auth.json')

interface AuthFile {
  version: 1
  scheme: 'scrypt'
  salt: string        // base64
  hash: string        // base64
  params: { N: number; r: number; p: number; keyLen: number }
  createdAt: string
  lastRotatedAt: string
}

export interface TokenInfo {
  /** True iff `auth.json` exists with a valid record. */
  exists: boolean
  createdAt?: string
  lastRotatedAt?: string
}

async function readAuthFile(): Promise<AuthFile | null> {
  try {
    const raw = await readFile(AUTH_FILE(), 'utf-8')
    const parsed = JSON.parse(raw) as AuthFile
    if (parsed.version !== 1 || parsed.scheme !== 'scrypt') return null
    return parsed
  } catch {
    return null
  }
}

async function writeAuthFile(file: AuthFile): Promise<void> {
  const path = AUTH_FILE()
  await mkdir(dirname(path), { recursive: true })
  const data = JSON.stringify(file, null, 2) + '\n'
  // Tight permissions: only owner can read. Important because the hash, if
  // leaked alongside the salt, could in principle be brute-forced. 256-bit
  // input makes that infeasible, but defense in depth still wants chmod 600.
  await writeFile(path, data, { mode: 0o600 })
  // Some platforms ignore the `mode` option on writeFile (windows, certain
  // Docker images with restrictive umask). Force a second chmod to be sure
  // — best-effort, ignore failures on platforms that don't support it.
  await chmod(path, 0o600).catch(() => { /* noop */ })
}

function deriveHash(token: string, salt: Buffer): Buffer {
  return scryptSync(token, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
}

/**
 * Generate a fresh admin token, persist its hash, return the plaintext.
 * The plaintext is the only place the token exists in the clear — caller
 * is responsible for displaying/forwarding it once and then discarding.
 */
export async function generateToken(): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const salt = randomBytes(SALT_BYTES)
  const hash = deriveHash(token, salt)
  const now = new Date().toISOString()
  const file: AuthFile = {
    version: 1,
    scheme: 'scrypt',
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    params: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keyLen: KEY_LEN },
    createdAt: now,
    lastRotatedAt: now,
  }
  await writeAuthFile(file)
  return token
}

/**
 * Constant-time check of a candidate token against the stored hash.
 * Returns false if no auth file exists or the file is malformed.
 */
export async function verifyToken(candidate: string): Promise<boolean> {
  const file = await readAuthFile()
  if (!file) return false
  const salt = Buffer.from(file.salt, 'base64')
  const stored = Buffer.from(file.hash, 'base64')
  // Re-derive using the params actually recorded in the file (forward
  // compatibility — if we ever bump N/r/p, old records still verify).
  const computed = scryptSync(candidate, salt, file.params.keyLen, {
    N: file.params.N,
    r: file.params.r,
    p: file.params.p,
  })
  if (computed.length !== stored.length) return false
  return timingSafeEqual(computed, stored)
}

/** Returns metadata about the current token without exposing the secret. */
export async function getTokenInfo(): Promise<TokenInfo> {
  const file = await readAuthFile()
  if (!file) return { exists: false }
  return {
    exists: true,
    createdAt: file.createdAt,
    lastRotatedAt: file.lastRotatedAt,
  }
}

/**
 * Remove the auth file, forcing the next start to regenerate. Operator
 * recovery path: "I lost the token, give me a fresh one." All sessions
 * naturally invalidate (they get rejected on next request — see
 * `session-store.ts`).
 */
export async function clearToken(): Promise<void> {
  await unlink(AUTH_FILE()).catch(() => { /* already gone, fine */ })
}

/**
 * Idempotent bootstrap: if no auth file exists, generate one and surface
 * the plaintext token. Otherwise no-op (returns the existing metadata).
 *
 * `onFirstGeneration` is called exactly once with the plaintext — typical
 * caller writes to stdout. Plaintext is never persisted; once this callback
 * returns, the only proof of authority is the operator's clipboard.
 */
export async function bootstrapToken(opts: {
  onFirstGeneration?: (token: string) => void | Promise<void>
}): Promise<TokenInfo> {
  const existing = await readAuthFile()
  if (existing) {
    return {
      exists: true,
      createdAt: existing.createdAt,
      lastRotatedAt: existing.lastRotatedAt,
    }
  }
  const token = await generateToken()
  if (opts.onFirstGeneration) {
    await opts.onFirstGeneration(token)
  }
  return getTokenInfo()
}
