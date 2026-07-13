type EnvLike = Readonly<Record<string, string | undefined>>

const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY'] as const
const LOCAL_BYPASS = ['127.0.0.1', 'localhost', '::1'] as const

/**
 * Convert Electron/Chromium's `resolveProxy()` result into the environment
 * Node 22.22+ uses when `NODE_USE_ENV_PROXY=1` is enabled.
 *
 * Explicit proxy env always wins. `DIRECT` (or unsupported SOCKS-only rules)
 * produces no override. Chromium may return a fallback list such as
 * `PROXY 127.0.0.1:7890; DIRECT`; the first HTTP-capable directive wins.
 */
export function proxyEnvFromRules(
  rules: string,
  env: EnvLike = process.env,
): Record<string, string> {
  const explicit = PROXY_KEYS.some((key) => !!env[key]?.trim())
  if (explicit) {
    return {
      ...(!env['NODE_USE_ENV_PROXY'] ? { NODE_USE_ENV_PROXY: '1' } : {}),
      ...localBypassEnv(env),
    }
  }

  const directive = rules
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^(?:PROXY|HTTPS?)\s+\S+$/i.test(part))
  if (!directive) return {}

  const target = directive.replace(/^(?:PROXY|HTTPS?)\s+/i, '').trim()
  if (!target) return {}
  const proxyUrl = /^https?:\/\//i.test(target) ? target : `http://${target}`
  return {
    HTTPS_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NODE_USE_ENV_PROXY: '1',
    ...localBypassEnv(env),
  }
}

function localBypassEnv(env: EnvLike): { NO_PROXY?: string } {
  const current = (env['NO_PROXY'] ?? env['no_proxy'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const lower = new Set(current.map((entry) => entry.toLowerCase()))
  const merged = [...current, ...LOCAL_BYPASS.filter((entry) => !lower.has(entry.toLowerCase()))]
  return { NO_PROXY: merged.join(',') }
}
