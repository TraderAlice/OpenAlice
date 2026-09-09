import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { userDataHome } from '../core/paths.js'
import {
  readQuickChatPreferences, readAutoQuantPreferences, readAutoPredictionPreferences,
  rememberRecentChatWorkspace, rememberAutoQuantDefaultWorkspace, rememberAutoPredictionDefaultWorkspace,
} from '../core/preferences.js'
import type { WorkspaceService } from './service.js'

const setupSchema = z.object({
  schemaVersion: z.literal(1),
  pending: z.array(z.enum(['chat', 'auto-quant', 'auto-prediction'])),
  errors: z.record(z.string(), z.string()).optional(),
})

/** Consumes an explicit project-birth request under the backend's writer lease.
 * Success is checkpointed only after the canonical default preference is saved.
 * Resolvers reuse an existing instance if a previous attempt was interrupted.
 */
async function prepareUnlocked(
  service: Pick<WorkspaceService, 'resolveOrCreateChatWorkspace' | 'resolveOrCreateAutoQuantWorkspace' | 'resolveOrCreateAutoPredictionWorkspace'>,
  options: { home?: string; onProgress?: (workspace: string, error?: string) => void } = {},
): Promise<void> {
  const home = options.home ?? userDataHome
  const path = join(home, 'workspace-setup.json')
  let text: string
  try { text = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const request = setupSchema.parse(JSON.parse(text))
  const preferences = join(home, 'data', 'preferences.json')
  for (const kind of [...new Set(request.pending)]) {
    options.onProgress?.(kind)
    try {
      const result = kind === 'chat'
        ? await service.resolveOrCreateChatWorkspace((await readQuickChatPreferences(preferences)).recentChatWorkspaceId)
        : kind === 'auto-quant'
          ? await service.resolveOrCreateAutoQuantWorkspace((await readAutoQuantPreferences(preferences)).defaultWorkspaceId)
          : await service.resolveOrCreateAutoPredictionWorkspace((await readAutoPredictionPreferences(preferences)).defaultWorkspaceId)
      if (!result.ok) throw new Error(result.message)
      if (kind === 'chat') await rememberRecentChatWorkspace(result.workspace.id, preferences)
      else if (kind === 'auto-quant') await rememberAutoQuantDefaultWorkspace(result.workspace.id, preferences)
      else await rememberAutoPredictionDefaultWorkspace(result.workspace.id, preferences)
      request.pending = request.pending.filter(item => item !== kind)
      if (request.errors) delete request.errors[kind]
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      request.errors = { ...request.errors, [kind]: message }
      options.onProgress?.(kind, message)
    }
    const temp = `${path}.tmp`
    await writeFile(temp, JSON.stringify(request, null, 2) + '\n', { mode: 0o600 })
    await rename(temp, path)
  }
}

const gates = new WeakMap<object, Promise<void>>()
export function prepareProjectWorkspaces(...args: Parameters<typeof prepareUnlocked>): Promise<void> {
  const [service] = args
  const run = (gates.get(service) ?? Promise.resolve()).catch(() => {}).then(() => prepareUnlocked(...args))
  gates.set(service, run)
  return run
}

export async function readProjectWorkspaceSetup(home = userDataHome) {
  try {
    return setupSchema.parse(JSON.parse(await readFile(join(home, 'workspace-setup.json'), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, pending: [], errors: {} }
    throw error
  }
}
