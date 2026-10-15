/** Shipped CLI provenance schemas. Transport/location discovery belongs to the
 * installer adapter; backend and CLI interpret the same persisted record here. */
export type InstallChannel = 'stable' | 'beta' | 'pinned' | 'development' | 'custom'
export interface InstallSource {
  schemaVersion: 1 | 2 | 3
  repository: string
  cliVersion: string
  selector: { kind: 'branch' | 'version'; value: string }
  installerUrl: string
  updateChannel?: InstallChannel
  method?: 'direct' | 'npm' | 'bun' | 'brew' | 'aur'
  artifact?: { platform: string; arch: string; sha256: string }
  installedAt?: string
}

export function parseInstallSource(value: unknown): InstallSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as InstallSource
  const { schemaVersion, repository, cliVersion, selector, installerUrl, method, artifact, installedAt } = source
  if (![1, 2, 3].includes(schemaVersion)
    || repository !== 'TraderAlice/OpenAlice'
    || typeof cliVersion !== 'string' || cliVersion.length < 1
    || !selector || !['branch', 'version'].includes(selector.kind)
    || typeof selector.value !== 'string' || selector.value.length < 1 || selector.value.length > 128
    || selector.value.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(selector.value)
    || typeof installerUrl !== 'string') return null
  try {
    if (!['https:', 'http:'].includes(new URL(installerUrl).protocol)) return null
  } catch { return null }
  if (schemaVersion >= 2 && !['stable', 'beta', 'pinned', 'development', 'custom'].includes(source.updateChannel ?? '')) return null
  if (schemaVersion === 3 && (!['direct', 'npm', 'bun', 'brew', 'aur'].includes(method ?? '')
    || !artifact || !['darwin', 'linux', 'win32'].includes(artifact.platform) || !['arm64', 'x64'].includes(artifact.arch)
    || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)
    || typeof installedAt !== 'string' || !Number.isFinite(Date.parse(installedAt)))) return null
  return { schemaVersion, repository, cliVersion, selector: { kind: selector.kind, value: selector.value }, installerUrl,
    ...(schemaVersion >= 2 ? { updateChannel: source.updateChannel } : {}),
    ...(schemaVersion === 3 ? { method, artifact: { platform: artifact!.platform, arch: artifact!.arch, sha256: artifact!.sha256 }, installedAt } : {}) }
}

export function requireInstallSource(value: unknown): InstallSource {
  const parsed = parseInstallSource(value)
  if (!parsed) throw new Error('OpenAlice install-source metadata is invalid')
  return parsed
}

export function installSourceUpdateChannel(value: unknown): InstallChannel {
  const source = requireInstallSource(value)
  if (source.schemaVersion >= 2) return source.updateChannel!
  if (source.selector.kind === 'version') return 'pinned'
  if (source.selector.value === 'master') return source.installerUrl === 'https://openalice.ai/install' ? 'stable' : 'custom'
  return 'development'
}
