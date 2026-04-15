/**
 * Codex authentication — reads ~/.codex/auth.json and manages token refresh.
 *
 * Users authenticate via `codex login` (OpenAI Codex CLI). This module reads
 * either the cached OAuth tokens or API key mode credentials, writing refreshed
 * OAuth tokens back to disk so the Codex CLI stays in sync.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { pino } from 'pino'

const logger = pino({
  transport: { target: 'pino/file', options: { destination: 'logs/codex.log', mkdir: true } },
})

// ==================== Constants ====================

const REFRESH_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

// ==================== Types ====================

export interface CodexAuthFile {
  auth_mode?: string
  OPENAI_API_KEY?: string | null
  tokens?: {
    id_token: string
    access_token: string
    refresh_token: string
    account_id?: string
  }
  last_refresh?: string
}

/** Read API key mode credentials from auth.json when Codex CLI is configured with an API key. */
export async function getApiKeyFromAuthFile(): Promise<string | null> {
  const auth = await readAuthFile()
  if (auth.auth_mode !== 'apikey') return null
  const apiKey = auth.OPENAI_API_KEY?.trim()
  return apiKey ? apiKey : null
}

// ==================== Helpers ====================

/** Resolve the Codex home directory ($CODEX_HOME or ~/.codex). */
export function resolveCodexHome(): string {
  const env = process.env.CODEX_HOME
  if (env) return env
  return join(homedir(), '.codex')
}

function authFilePath(): string {
  return join(resolveCodexHome(), 'auth.json')
}

/**
 * Decode a JWT payload without signature verification.
 * Returns the parsed claims object.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
}

/** Extract the `exp` (expiration) claim from a JWT as epoch seconds. */
function getJwtExpiration(token: string): number | null {
  try {
    const claims = decodeJwtPayload(token)
    return typeof claims.exp === 'number' ? claims.exp : null
  } catch {
    return null
  }
}

// ==================== Core ====================

/** Read and parse the auth.json file. */
export async function readAuthFile(): Promise<CodexAuthFile> {
  const path = authFilePath()
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new Error(
        `Codex auth not found at ${path}. Run \`codex login\` to authenticate.`,
      )
    }
    throw new Error(`Failed to read Codex auth file: ${err?.message}`)
  }
}

/** Write the auth file back to disk (0o600 permissions on unix). */
async function writeAuthFile(auth: CodexAuthFile): Promise<void> {
  const path = authFilePath()
  await mkdir(dirname(path), { recursive: true })
  const json = JSON.stringify(auth, null, 2)
  await writeFile(path, json, { mode: 0o600 })
}

/** Check whether the access token is expired or stale. */
function isTokenExpired(auth: CodexAuthFile): boolean {
  const token = auth.tokens?.access_token
  if (!token) return true

  // Check JWT exp claim
  const exp = getJwtExpiration(token)
  if (exp != null && exp <= Date.now() / 1000) return true

  // Proactive refresh: 8+ days since last refresh
  if (auth.last_refresh) {
    const lastRefresh = new Date(auth.last_refresh).getTime()
    const eightDays = 8 * 24 * 60 * 60 * 1000
    if (Date.now() - lastRefresh > eightDays) return true
  }

  return false
}

/** Request new tokens from the OpenAI auth service. */
async function refreshTokens(
  refreshToken: string,
): Promise<{ id_token?: string; access_token?: string; refresh_token?: string }> {
  const res = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error({ status: res.status, body: body.slice(0, 500) }, 'token_refresh_failed')
    throw new Error(
      `Codex token refresh failed (${res.status}). You may need to run \`codex login\` again.`,
    )
  }

  return await res.json() as { id_token?: string; access_token?: string; refresh_token?: string }
}

// ==================== In-memory cache ====================

let cachedToken: { token: string; expiresAt: number } | null = null
let refreshPromise: Promise<string> | null = null

/**
 * Get a valid access token, refreshing if necessary.
 *
 * Uses an in-memory cache to avoid repeated disk reads. A promise-based
 * mutex prevents concurrent refreshes from racing on disk writes.
 */
export async function getAccessToken(): Promise<string> {
  // Fast path: cached and not expired
  if (cachedToken && cachedToken.expiresAt > Date.now() / 1000) {
    return cachedToken.token
  }

  // Mutex: if a refresh is already in progress, wait for it
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const auth = await readAuthFile()

      if (auth.auth_mode === 'apikey') {
        const apiKey = auth.OPENAI_API_KEY?.trim()
        if (!apiKey) {
          throw new Error('Codex auth.json is in API key mode but has no OPENAI_API_KEY set.')
        }
        cachedToken = {
          token: apiKey,
          expiresAt: Date.now() / 1000 + 3600,
        }
        return cachedToken.token
      }

      if (!auth.tokens?.access_token) {
        throw new Error('Codex auth.json has no tokens. Run `codex login` to authenticate.')
      }

      if (!isTokenExpired(auth)) {
        // Token is still valid — cache it
        const exp = getJwtExpiration(auth.tokens.access_token)
        cachedToken = {
          token: auth.tokens.access_token,
          expiresAt: exp ?? Date.now() / 1000 + 3600,
        }
        return cachedToken.token
      }

      // Token expired — refresh
      logger.info('refreshing_codex_token')
      const refreshed = await refreshTokens(auth.tokens.refresh_token)

      // Merge refreshed tokens
      if (refreshed.access_token) auth.tokens.access_token = refreshed.access_token
      if (refreshed.refresh_token) auth.tokens.refresh_token = refreshed.refresh_token
      if (refreshed.id_token) auth.tokens.id_token = refreshed.id_token
      auth.last_refresh = new Date().toISOString()

      await writeAuthFile(auth)
      logger.info('codex_token_refreshed')

      const exp = getJwtExpiration(auth.tokens.access_token)
      cachedToken = {
        token: auth.tokens.access_token,
        expiresAt: exp ?? Date.now() / 1000 + 3600,
      }
      return cachedToken.token
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

/** Clear the in-memory token cache (useful after auth errors). */
export function clearTokenCache(): void {
  cachedToken = null
}
