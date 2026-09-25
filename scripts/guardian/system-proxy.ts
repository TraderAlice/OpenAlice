import { execFile } from 'node:child_process'

import { proxyEnvFromRules, type EnvLike } from '../../packages/guardian-runtime/src/proxy-env.js'

const WINDOWS_INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const WINDOWS_PROXY_VALUES = ['ProxyEnable', 'ProxyServer', 'AutoConfigURL'] as const

export type RunCommand = (command: string, args: readonly string[]) => Promise<string>

export interface SystemProxyResolverOptions {
  platform?: NodeJS.Platform
  runCommand?: RunCommand
}

export interface GuardianProxyResolution {
  envPatch: Record<string, string>
  diagnostic?: string
}

export interface WindowsProxySettings {
  proxyEnable?: boolean
  proxyServer?: string
  autoConfigUrl?: string
}

const DIAGNOSTICS = {
  nonWindows: 'system proxy auto-discovery is unavailable on this platform; continuing without proxy',
  unavailable: 'system proxy settings could not be resolved; continuing without proxy',
  disabled: 'system proxy is disabled or DIRECT; continuing without proxy',
  pac: 'system proxy uses PAC/auto-configuration; continuing without proxy',
  unsupported: 'system proxy has no usable HTTP(S) endpoint; continuing without proxy',
} as const

/** Parse the named values emitted by Windows reg query. */
export function parseWindowsProxyRegistryOutput(output: string): WindowsProxySettings {
  const values: Partial<Record<(typeof WINDOWS_PROXY_VALUES)[number], string>> = {}
  const valuePattern = /^\s*(ProxyEnable|ProxyServer|AutoConfigURL)\s+REG_[A-Z0-9_]+\s+(.+?)\s*$/gim
  for (const match of output.matchAll(valuePattern)) {
    values[match[1] as (typeof WINDOWS_PROXY_VALUES)[number]] = match[2].trim()
  }

  const proxyEnable = values.ProxyEnable === undefined
    ? undefined
    : parseRegistryBoolean(values.ProxyEnable)

  return {
    proxyEnable,
    ...(values.ProxyServer ? { proxyServer: values.ProxyServer } : {}),
    ...(values.AutoConfigURL ? { autoConfigUrl: values.AutoConfigURL } : {}),
  }
}

/** Convert Windows manual proxy forms into Chromium-style HTTP rules. */
export function windowsProxyServerToRules(raw: string | undefined): string {
  if (!raw?.trim()) return ''

  const entries = raw.split(';').map((entry) => entry.trim()).filter(Boolean)
  const protocolEntries = entries.flatMap((entry) => {
    const equals = entry.indexOf('=')
    if (equals <= 0) return []
    const protocol = entry.slice(0, equals).trim().toLowerCase()
    const target = entry.slice(equals + 1).trim()
    if ((protocol !== 'http' && protocol !== 'https') || !target) return []
    return [{ protocol, target }]
  })

  const selected = protocolEntries.find((entry) => entry.protocol === 'https')
    ?? protocolEntries.find((entry) => entry.protocol === 'http')
  if (selected) {
    return (selected.protocol === 'https' ? 'HTTPS ' : 'PROXY ') + selected.target
  }

  if (entries.some((entry) => entry.includes('='))) return ''
  const target = entries[0]
  if (/^(?:DIRECT|PAC|SOCKS(?:4|5)?)(?::|\s|$)/i.test(target)) return ''
  return 'PROXY ' + target
}

/** Resolve one stable, non-secret proxy patch for the dev Guardian children. */
export async function resolveGuardianProxyEnv(
  env: EnvLike = process.env,
  options: SystemProxyResolverOptions = {},
): Promise<GuardianProxyResolution> {
  const explicit = proxyEnvFromRules('', env)
  if (Object.keys(explicit).length > 0) {
    return { envPatch: explicit }
  }

  if ((options.platform ?? process.platform) !== 'win32') {
    return { envPatch: {}, diagnostic: DIAGNOSTICS.nonWindows }
  }

  const query = await queryWindowsProxySettings(options.runCommand ?? runCommand)
  if (!query.readAny) {
    return { envPatch: {}, diagnostic: DIAGNOSTICS.unavailable }
  }

  const settings = query.settings
  if (settings.proxyEnable === false) {
    return { envPatch: {}, diagnostic: DIAGNOSTICS.disabled }
  }
  if (settings.proxyEnable !== true) {
    return {
      envPatch: {},
      diagnostic: settings.autoConfigUrl ? DIAGNOSTICS.pac : DIAGNOSTICS.unavailable,
    }
  }

  const rules = windowsProxyServerToRules(settings.proxyServer)
  if (!rules) {
    return {
      envPatch: {},
      diagnostic: settings.autoConfigUrl ? DIAGNOSTICS.pac : DIAGNOSTICS.unsupported,
    }
  }

  const resolved = proxyEnvFromRules(rules, env)
  return Object.keys(resolved).length > 0
    ? { envPatch: resolved }
    : { envPatch: {}, diagnostic: DIAGNOSTICS.unsupported }
}

/** Resolve the proxy once and apply the same patch to every Guardian child spec. */
export async function buildGuardianChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  options: SystemProxyResolverOptions = {},
): Promise<{ env: NodeJS.ProcessEnv; diagnostic?: string }> {
  const resolution = await resolveGuardianProxyEnv(baseEnv, options)
  return {
    env: { ...baseEnv, ...resolution.envPatch },
    ...(resolution.diagnostic ? { diagnostic: resolution.diagnostic } : {}),
  }
}

async function queryWindowsProxySettings(
  run: RunCommand,
): Promise<{ readAny: boolean; settings: WindowsProxySettings }> {
  const results = await Promise.all(WINDOWS_PROXY_VALUES.map(async (valueName) => {
    try {
      return { output: await run('reg.exe', ['query', WINDOWS_INTERNET_SETTINGS, '/v', valueName]), ok: true }
    } catch {
      // A missing named registry value is normal; continue with the values that exist.
      return { output: '', ok: false }
    }
  }))
  return {
    readAny: results.some((result) => result.ok),
    settings: parseWindowsProxyRegistryOutput(results.map((result) => result.output).join('\n')),
  }
}

function parseRegistryBoolean(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric !== 0 : undefined
}

const runCommand: RunCommand = (command, args) => new Promise((resolve, reject) => {
  execFile(command, [...args], { encoding: 'utf8', windowsHide: true, timeout: 2_000 }, (error, stdout) => {
    if (error) {
      reject(error)
      return
    }
    resolve(String(stdout))
  })
})
