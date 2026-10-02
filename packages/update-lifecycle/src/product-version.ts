import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isVersion } from './index.js'

declare global {
  var __OPENALICE_BUILD_VERSION__: string | undefined
}

let productVersion: string | undefined

/** Product bytes own their identity. Source execution reads the repository's
 * manifest; packaged resource roots are supplied by the existing launcher.
 * Neither the caller's cwd nor a private package version is product identity. */
export function getProductVersion(): string {
  if (productVersion !== undefined) return productVersion
  const compiled = globalThis.__OPENALICE_BUILD_VERSION__
  if (compiled !== undefined) {
    if (!isVersion(compiled)) throw new Error('Invalid compiled OpenAlice product version')
    return productVersion = compiled
  }
  const manifest = process.env.OPENALICE_APP_HOME
    ? resolve(process.env.OPENALICE_APP_HOME, 'package.json')
    : new URL('../../../package.json', import.meta.url)
  const product = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown; version?: unknown }
  if (product.name !== 'open-alice' || typeof product.version !== 'string' || !isVersion(product.version)) {
    throw new Error('OpenAlice product identity is unavailable: invalid product manifest')
  }
  return productVersion = product.version
}
