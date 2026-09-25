export type EnvLike = Readonly<Record<string, string | undefined>>

const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY'] as const
const OPENALICE_PROXY_KEY = 'OPENALICE_PROXY_URL'
const LOCAL_BYPASS = ['127.0.0.1', 'localhost', '::1'] as const

/**
 * Convert Chromium proxy rules into the environment Node uses when
 * NODE_USE_ENV_PROXY=1 is enabled. Explicit proxy env always wins.
 */
export function proxyEnvFromRules(
  rules: string,
  env: EnvLike = process.env,
): Record<string, string> {
  const explicitValues = Object.fromEntries(PROXY_KEYS.flatMap((key) => {
    const value = env[key]?.trim() || env[key.toLowerCase()]?.trim()
    return value ? [[key, value]] : []
  }))
  const explicit = Object.keys(explicitValues).length > 0
  if (explicit) {
    return {
      ...explicitValues,
      ...(!env['NODE_USE_ENV_PROXY'] ? { NODE_USE_ENV_PROXY: '1' } : {}),
      ...localBypassEnv(env),
    }
  }

  const configuredProxy = normalizeHttpProxyUrl(env[OPENALICE_PROXY_KEY])
  if (configuredProxy) return proxyEnvForUrl(configuredProxy, env)

  const directive = rules
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^(?:PROXY|HTTPS?)\s+\S+$/i.test(part))
  if (!directive) return {}

  const target = directive.replace(/^(?:PROXY|HTTPS?)\s+/i, '').trim()
  if (!target) return {}
  const proxyUrl = /^https?:\/\//i.test(target) ? target : 'http://' + target
  return proxyEnvForUrl(proxyUrl, env)
}

function proxyEnvForUrl(proxyUrl: string, env: EnvLike): Record<string, string> {
  return {
    HTTPS_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NODE_USE_ENV_PROXY: '1',
    ...localBypassEnv(env),
  }
}

function normalizeHttpProxyUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.hostname ? value : undefined
  } catch {
    return undefined
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
