import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type AutoUpdateCapability =
  | {
      readonly enabled: true
      readonly configPath: string
    }
  | {
      readonly enabled: false
      readonly reason: 'not-packaged'
      readonly configPath: null
    }
  | {
      readonly enabled: false
      readonly reason: 'missing-config'
      readonly configPath: string
    }

export function resolveAutoUpdateCapability(opts: {
  readonly isPackaged: boolean
  readonly resourcesPath: string
}): AutoUpdateCapability {
  if (!opts.isPackaged) {
    return { enabled: false, reason: 'not-packaged', configPath: null }
  }

  const configPath = join(opts.resourcesPath, 'app-update.yml')
  if (!existsSync(configPath)) {
    return { enabled: false, reason: 'missing-config', configPath }
  }
  return { enabled: true, configPath }
}
