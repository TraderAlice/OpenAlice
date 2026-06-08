/**
 * Credential inference helpers — shared between the 0002 migration
 * and the runtime test path.
 *
 * Single source of truth for "given a profile-shaped record, what
 * vendor + authType does it represent?". The migration uses this to
 * extract credentials from inline profile fields. The test path uses
 * it to synthesize a Credential when the profile body comes from the
 * wizard and has no `credentialSlug` yet.
 */

import type { Credential, CredentialAuthType, CredentialVendor, ResolvedProfile } from './config.js'

/** Profile-like record — works on both raw migration data and ResolvedProfile. */
export interface ProfileLike {
  backend?: string
  loginMethod?: string
  apiKey?: string
  baseUrl?: string
  provider?: string
}

const VENDORS_BY_BASEURL: Array<[RegExp, CredentialVendor]> = [
  [/bigmodel\.cn|z\.ai/i, 'glm'],
  [/minimaxi\.com|minimax\.io/i, 'minimax'],
  [/moonshot\.cn|moonshot\.ai/i, 'kimi'],
  [/deepseek\.com/i, 'deepseek'],
]

export function inferVendor(profile: ProfileLike): CredentialVendor {
  const { backend, loginMethod } = profile
  const baseUrl = profile.baseUrl ?? ''

  if (backend === 'codex') return 'openai'

  if (backend === 'agent-sdk' && loginMethod === 'claudeai') return 'anthropic'

  if (backend === 'agent-sdk') {
    for (const [pattern, vendor] of VENDORS_BY_BASEURL) {
      if (pattern.test(baseUrl)) return vendor
    }
    return 'anthropic'
  }

  if (backend === 'vercel-ai-sdk') {
    const provider = profile.provider
    if (provider === 'openai' || provider === 'google' || provider === 'anthropic') return provider
    return 'anthropic'
  }

  return 'custom'
}

/**
 * Infer a credential vendor from the workspace AI-config modal's context — a
 * CLI agent tab + the entered baseUrl. Unlike `inferVendor` (profile-shaped),
 * this is the standalone "save to Alice" path where there's no profile/backend.
 *
 * A recognized baseUrl wins (GLM/MiniMax/Kimi/DeepSeek gateways); otherwise the
 * agent decides: claude → anthropic, codex → openai. opencode/pi are
 * OpenAI-compatible against arbitrary endpoints, so an unrecognized baseUrl
 * falls back to 'custom' rather than guessing a first-party vendor.
 */
export function inferCredentialVendor(opts: { agent?: string; baseUrl?: string }): CredentialVendor {
  const baseUrl = opts.baseUrl ?? ''
  for (const [pattern, vendor] of VENDORS_BY_BASEURL) {
    if (pattern.test(baseUrl)) return vendor
  }
  if (opts.agent === 'claude') return 'anthropic'
  if (opts.agent === 'codex') return 'openai'
  return 'custom'
}

export function inferAuthType(profile: ProfileLike): CredentialAuthType {
  if (profile.loginMethod === 'claudeai' || profile.loginMethod === 'codex-oauth') {
    return 'subscription'
  }
  return 'api-key'
}

/**
 * Resolve which HTTP header carries the key for an Anthropic-shape request
 * (agent-sdk backend, or vercel-ai-sdk with provider=anthropic).
 *
 * `x-api-key` is Anthropic's first-party standard and the safe default;
 * `bearer` sends `Authorization: Bearer`, which anthropic-compatible
 * *gateways* require. An explicit `authMode` on the profile always wins —
 * that's the per-profile choice the wizard / Apply path stores.
 *
 * Fallback inference is deliberately narrow: only `api.minimax.io` (MiniMax's
 * international endpoint) is auto-promoted to bearer, because it's the one
 * endpoint confirmed to *reject* x-api-key with a 401. This lets pre-existing
 * MiniMax-international profiles (created before the authMode field landed)
 * work without being recreated. The China endpoint (minimaxi.com) tolerates
 * x-api-key, and other gateways (GLM, Kimi, DeepSeek) are left at the default
 * until confirmed otherwise — over-promoting would silently break a working
 * x-api-key setup.
 */
export function resolveAnthropicAuthMode(
  profile: { authMode?: 'x-api-key' | 'bearer'; baseUrl?: string },
): 'x-api-key' | 'bearer' {
  if (profile.authMode) return profile.authMode
  if (/api\.minimax\.io/i.test(profile.baseUrl ?? '')) return 'bearer'
  return 'x-api-key'
}

/** Whether the profile's inline fields contain a credential to extract. */
export function hasExtractableCredential(profile: ProfileLike): boolean {
  if (profile.apiKey) return true
  if (profile.loginMethod === 'claudeai' || profile.loginMethod === 'codex-oauth') return true
  return false
}

/** Build a Credential from a ResolvedProfile's inline credential fields. */
export function profileToCredential(profile: ResolvedProfile): Credential {
  const cred: Credential = {
    vendor: inferVendor(profile),
    authType: inferAuthType(profile),
  }
  if (profile.apiKey) cred.apiKey = profile.apiKey
  if (profile.baseUrl) cred.baseUrl = profile.baseUrl
  return cred
}
