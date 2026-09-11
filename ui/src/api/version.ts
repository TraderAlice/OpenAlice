import type { VersionInfo } from './types'

export const versionApi = {
  async get(signal?: AbortSignal): Promise<VersionInfo> {
    const res = await fetch('/api/version', { signal })
    if (!res.ok) throw new Error(`Failed to fetch version info: ${res.status}`)
    return res.json()
  },
  async check(signal?: AbortSignal): Promise<VersionInfo> {
    const res = await fetch('/api/version/check', { method: 'POST', signal })
    if (!res.ok) throw new Error(`Failed to check for updates: ${res.status}`)
    return res.json()
  },
}
