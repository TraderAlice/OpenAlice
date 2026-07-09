/**
 * Credential inference helpers for the workspace "save to Alice" path.
 *
 * Given a CLI agent + the entered baseUrl, infer the credential vendor and the
 * Anthropic auth-header mode. Used by the workspace AI-config modal's save-back
 * route (`/api/workspaces/credentials`) and the credential probe.
 *
 * (The profile-shaped inference that fed the 0002/0003 migrations — inferVendor /
 * inferAuthType / hasExtractableCredential / profileToCredential — went with
 * those migrations + the in-process provider stack at the 0.40 baseline.)
 */

import type { CredentialVendor } from './config.js'

const VENDORS_BY_BASEURL: Array<[RegExp, CredentialVendor]> = [
  [/bigmodel\.cn|z\.ai/i, 'glm'],
  [/minimaxi\.com|minimax\.io/i, 'minimax'],
  [/moonshot\.cn|moonshot\.ai/i, 'kimi'],
  [/deepseek\.com/i, 'deepseek'],
  [/longcat\.chat/i, 'longcat'],
  [/api\.x\.ai/i, 'xai'],
]

/**
 * Infer a credential vendor from the workspace AI-config modal's context — a
 * CLI agent tab + the entered baseUrl.
 *
 * A recognized baseUrl wins (GLM/MiniMax/Kimi/DeepSeek/LongCat gateways); otherwise the
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

/**
 * Resolve which HTTP header carries the key for an Anthropic-shape request.
 *
 * `x-api-key` is Anthropic's first-party standard and the safe default;
 * `bearer` sends `Authorization: Bearer`, which anthropic-compatible *gateways*
 * require. An explicit `authMode` always wins. Fallback inference is deliberately
 * narrow: only `api.minimax.io` (MiniMax's international endpoint) is
 * auto-promoted to bearer, because it's the one endpoint confirmed to *reject*
 * x-api-key with a 401. Other gateways stay at the default until confirmed —
 * over-promoting would silently break a working x-api-key setup.
 */
export function resolveAnthropicAuthMode(
  opts: { authMode?: 'x-api-key' | 'bearer'; baseUrl?: string },
): 'x-api-key' | 'bearer' {
  if (opts.authMode) return opts.authMode
  if (/api\.minimax\.io/i.test(opts.baseUrl ?? '')) return 'bearer'
  return 'x-api-key'
}
