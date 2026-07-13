/**
 * Workspace-owned display metadata.
 *
 * Identity stays in the launcher registry (`workspaces.json`): id, dir, tag,
 * template, and agents are launcher-owned and must remain stable. This file is
 * the workspace's own self-description for UI labels and short descriptions.
 */

import { z } from 'zod'

import { readWorkspaceFile, writeWorkspaceFile } from './file-service.js'

export const WORKSPACE_METADATA_REL = '.alice/workspace.json'

const MAX_BYTES = 16 * 1024
const MAX_DISPLAY_NAME = 120
const MAX_DESCRIPTION = 1000

export const workspaceMetadataSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME).optional(),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION).optional(),
}).strict()

export type WorkspaceMetadata = z.infer<typeof workspaceMetadataSchema>

export type ReadWorkspaceMetadataResult =
  | { ok: true; metadata: WorkspaceMetadata }
  | { ok: false; reason: 'absent' }
  | { ok: false; reason: 'invalid'; error: string }

export async function readWorkspaceMetadata(wsDir: string): Promise<ReadWorkspaceMetadataResult> {
  let raw: string | null
  try {
    raw = await readWorkspaceFile(wsDir, WORKSPACE_METADATA_REL)
  } catch (err) {
    return { ok: false, reason: 'invalid', error: err instanceof Error ? err.message : String(err) }
  }
  if (raw === null) return { ok: false, reason: 'absent' }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    return { ok: false, reason: 'invalid', error: `workspace metadata file too large (max ${MAX_BYTES} bytes)` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: 'invalid', error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }

  const res = workspaceMetadataSchema.safeParse(parsed)
  if (!res.success) {
    return { ok: false, reason: 'invalid', error: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  return { ok: true, metadata: res.data }
}

export async function writeWorkspaceMetadata(wsDir: string, metadata: WorkspaceMetadata): Promise<WorkspaceMetadata> {
  const parsed = workspaceMetadataSchema.parse(metadata)
  await writeWorkspaceFile(wsDir, WORKSPACE_METADATA_REL, `${JSON.stringify(parsed, null, 2)}\n`)
  return parsed
}
