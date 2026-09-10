import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, sep } from 'node:path'
import { isFileReference } from '@traderalice/connector-protocol'

/** Resolve only existing readable files inside the source Workspace, including symlinks. */
export async function resolveInboxFile(workspaceDir: string | undefined, path: string): Promise<string | null> {
  if (!workspaceDir || !isFileReference(path)) return null
  try {
    const root = await realpath(workspaceDir)
    const target = await realpath(resolve(root, path))
    if (!target.startsWith(root + sep) || !(await stat(target)).isFile()) return null
    await access(target, constants.R_OK)
    return target
  } catch { return null }
}
