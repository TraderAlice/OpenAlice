import { tool } from 'ai'
import { z } from 'zod'

import {
  provenanceActions,
  type ArtifactRef,
  type ProvenanceRecord,
} from '../core/provenance-store.js'
import type { WorkspaceToolContext, WorkspaceToolFactory } from '../core/workspace-tool-center.js'

const artifactKinds = ['inbox', 'issue', 'report', 'trade-decision'] as const

/** Fingerprints are persistence-only dedupe keys, not part of the public trail. */
export function publicProvenanceRecord(
  record: ProvenanceRecord,
): Omit<ProvenanceRecord, 'fingerprint'> {
  const { fingerprint: _fingerprint, ...publicRecord } = record
  return publicRecord
}

function artifactFromArgs(
  ctx: WorkspaceToolContext,
  args: {
    kind?: (typeof artifactKinds)[number]
    workspaceId?: string
    inboxEntryId?: string
    issueId?: string
    path?: string
    revision?: string
    accountId?: string
    decisionId?: string
  },
): ArtifactRef | { error: string } | undefined {
  if (!args.kind) return undefined
  const workspaceId = args.workspaceId ?? ctx.workspaceId
  if (args.kind === 'inbox') {
    return args.inboxEntryId
      ? { kind: 'inbox', inboxEntryId: args.inboxEntryId }
      : { error: 'kind inbox requires inboxEntryId' }
  }
  if (args.kind === 'issue') {
    return args.issueId
      ? { kind: 'issue', workspaceId, issueId: args.issueId }
      : { error: 'kind issue requires issueId' }
  }
  if (args.kind === 'report') {
    return args.path
      ? { kind: 'report', workspaceId, path: args.path, ...(args.revision ? { revision: args.revision } : {}) }
      : { error: 'kind report requires path' }
  }
  return args.accountId && args.decisionId
    ? { kind: 'trade-decision', accountId: args.accountId, decisionId: args.decisionId }
    : { error: 'kind trade-decision requires accountId and decisionId' }
}

export const provenanceShowFactory: WorkspaceToolFactory = {
  name: 'provenance_show',
  build(ctx) {
    return tool({
      description: [
        'Read immutable Session attribution for one business artifact, or list',
        'artifacts attributed to one product Session. This is a read-only audit',
        'surface: resumeId is the follow-up handle; native runtime ids are never returned.',
        '',
        'Artifact keys: inboxEntryId; issueId (+ optional workspaceId); report path',
        '(+ optional workspaceId/revision); or trade-decision accountId + decisionId.',
        'Omit workspaceId for Issue/report artifacts owned by the current Workspace.',
      ].join('\n'),
      inputSchema: z.object({
        kind: z.enum(artifactKinds).optional(),
        workspaceId: z.string().min(1).optional(),
        inboxEntryId: z.string().min(1).optional(),
        issueId: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
        revision: z.string().min(1).optional(),
        accountId: z.string().min(1).optional(),
        decisionId: z.string().min(1).optional(),
        resumeId: z.string().min(1).optional(),
        action: z.enum(provenanceActions).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      }),
      execute: async (args) => {
        if (!ctx.provenanceStore) return { ok: false as const, error: 'provenance unavailable' }
        if (!args.kind && !args.resumeId) {
          return { ok: false as const, error: 'provide an artifact kind or resumeId' }
        }
        const artifact = artifactFromArgs(ctx, args)
        if (artifact && 'error' in artifact) return { ok: false as const, error: artifact.error }
        const records = ctx.provenanceStore.list({
          ...(artifact ? { artifact } : {}),
          ...(args.resumeId ? { resumeId: args.resumeId } : {}),
          ...(args.action ? { action: args.action } : {}),
          limit: args.limit,
        }).map(publicProvenanceRecord)
        return { ok: true as const, count: records.length, records }
      },
    })
  },
}

