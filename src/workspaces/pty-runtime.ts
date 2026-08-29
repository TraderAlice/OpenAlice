import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

type NodePtyModule = typeof import('node-pty')

const runtimeRequire = createRequire(import.meta.url)
let cachedNodePty: NodePtyModule | null = null

/**
 * Load the platform PTY only when a Session or probe actually needs it.
 *
 * Source and Electron modes resolve the ordinary workspace dependency. A Bun
 * standalone resolves the installer-owned native sidecar beside the primary
 * executable, keeping native code out of startup for users who never launch an
 * Agent Runtime.
 */
export function loadNodePty(): NodePtyModule {
  if (cachedNodePty) return cachedNodePty
  const standalone = (
    globalThis as { __OPENALICE_BUN_STANDALONE__?: boolean }
  ).__OPENALICE_BUN_STANDALONE__ === true
  const modulePath = standalone
    ? join(dirname(process.execPath), 'native', 'node-pty')
    : 'node-pty'
  cachedNodePty = runtimeRequire(modulePath) as NodePtyModule
  return cachedNodePty
}
