import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'

export const workspaceSessionsFactory: WorkspaceToolFactory = {
  name: 'workspace_sessions',
  build(ctx) {
    return tool({
      description: [
        "List a workspace's known Sessions using OpenAlice-owned resumeId handles.",
        '',
        'Use this to audit who has worked at a workspace or to resolve a known artifact owner.',
        'Do not choose an arbitrary old Session when an artifact has no exact owner: that means',
        'the future collaboration flow should recruit a fresh Session at that workspace.',
        '',
        'Adapter-native session ids are intentionally hidden. Pass only resumeId to OpenAlice',
        'resume/collaboration commands; the backend owns the runtime-specific mapping.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().min(1).describe('Workspace id to inspect.'),
        limit: z.number().int().min(1).max(100).optional().describe('Newest Sessions to return (default 50).'),
      }),
      execute: async ({ id, limit }) => {
        try {
          if (!ctx.resolveWorkspace?.(id)) {
            return { ok: false as const, error: `unknown workspace: ${id}` }
          }
          if (!ctx.sessionDirectory) {
            return { ok: false as const, error: 'workspace Session directory is unavailable in this context' }
          }
          const directory = await ctx.sessionDirectory(id, limit)
          return directory
            ? { ok: true as const, ...directory }
            : { ok: false as const, error: `unknown workspace: ${id}` }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}
