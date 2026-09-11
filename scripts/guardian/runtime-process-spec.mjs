export const INTERNAL_ROLE_FLAG = '--internal-role'

/**
 * Resolve a Guardian child launch without changing the Guardian lifecycle.
 * Source/bundle/docker providers retain their built Node entrypoints. The Bun
 * standalone provider re-enters the same executable under a private role.
 */
export function runtimeProcessSpec({
  role,
  legacyPath,
  provider,
  executable = process.execPath,
  nodeBinary = process.execPath,
}) {
  if (provider === 'bun') {
    return {
      cmd: executable,
      args: [INTERNAL_ROLE_FLAG, role],
    }
  }
  return {
    cmd: nodeBinary,
    args: [legacyPath],
  }
}
