import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export type PiTuiModule = typeof import('@earendil-works/pi-tui')

export async function loadPiTui(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PiTuiModule> {
  try {
    return await import('@earendil-works/pi-tui')
  } catch (error: unknown) {
    const managedPiEntry = env.OPENALICE_MANAGED_PI_PATH
    if (!managedPiEntry || !isMissingPackage(error)) throw error
    const requireFromManagedPi = createRequire(managedPiEntry)
    const entry = requireFromManagedPi.resolve('@earendil-works/pi-tui')
    return import(pathToFileURL(entry).href) as Promise<PiTuiModule>
  }
}

function isMissingPackage(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'ERR_MODULE_NOT_FOUND'
}
