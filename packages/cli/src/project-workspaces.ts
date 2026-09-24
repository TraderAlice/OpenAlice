import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const PROJECT_WORKSPACES = ['chat', 'auto-quant', 'auto-prediction'] as const
export type ProjectWorkspace = typeof PROJECT_WORKSPACES[number]
export const PROJECT_WORKSPACE_LABELS: Record<ProjectWorkspace, string> = {
  chat: 'Chat — everyday conversations and tasks',
  'auto-quant': 'Auto Quant — quantitative research',
  'auto-prediction': 'Auto Prediction — prediction market research',
}

/** Birth-time intent only. The owning backend prepares these without starting Agents. */
export async function writeProjectWorkspaceRequest(home: string, workspaces: readonly ProjectWorkspace[]): Promise<void> {
  // Exclusive creation: never replace an existing home's setup choices.
  await writeFile(join(home, 'workspace-setup.json'), JSON.stringify({
    schemaVersion: 1, pending: workspaces,
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
}
