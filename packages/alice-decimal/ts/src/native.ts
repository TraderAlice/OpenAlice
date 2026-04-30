// Re-export the napi-rs generated module via createRequire (CJS interop).
// Same shape as alice-analysis's loader — see that comment for the rationale.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)
const native = require_(resolve(here, '..', '..', 'index.js')) as NativeShape

export const validateWireDecimal = native.validateWireDecimal
export const addWireDecimals = native.addWireDecimals
export const version = native.version

interface NativeShape {
  validateWireDecimal: (value: string) => string
  addWireDecimals: (a: string, b: string) => string
  version: () => string
}
