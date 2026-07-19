import type { VersionInfo } from './types'

export const versionApi = {
  async get(): Promise<VersionInfo> {
    const res = await fetch('/api/version')
    if (!res.ok) throw new Error(`Failed to fetch version info: ${res.status}`)
    return res.json()
  },
  async check(): Promise<VersionInfo> {
    const res = await fetch('/api/version/check', { method: 'POST' })
    if (!res.ok) throw new Error(`Failed to check for updates: ${res.status}`)
    return res.json()
  },
}
