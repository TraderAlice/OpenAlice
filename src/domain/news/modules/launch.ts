import { fileURLToPath } from 'node:url'

/** Launch only the worker entry, without importing Alice or UTA. */
export function createNewsWorkerLaunch(): { command: string; args: string[] } {
  if ((globalThis as { __OPENALICE_BUN_STANDALONE__?: boolean }).__OPENALICE_BUN_STANDALONE__ === true) {
    return { command: process.execPath, args: ['--internal-role', 'news-worker'] }
  }

  const source = import.meta.url.endsWith('/launch.ts')
  const entry = fileURLToPath(new URL(source ? './worker-entry.ts' : './worker-entry.js', import.meta.url))
  return {
    command: process.execPath,
    args: source ? ['--import', import.meta.resolve('tsx'), entry] : [entry],
  }
}
