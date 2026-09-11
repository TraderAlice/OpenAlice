import { tool } from 'ai'
import { z } from 'zod'

import { ALICE_HARNESS_SKILLS } from '../workspaces/alice-harness-policy.js'
import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'
import type {
  SkillProjectionRequest,
  TemplateUpgradeFilePlan,
  TemplateUpgradePlan,
  TemplateUpgradeResolution,
} from '../workspaces/template-upgrade.js'

type OutputMode = 'summary' | 'detailed'

function fileSummary(file: TemplateUpgradeFilePlan, mode: OutputMode) {
  return {
    path: file.path,
    status: file.status,
    operation: file.operation,
    canUseTemplate: file.canUseTemplate,
    ...(file.note ? { note: file.note } : {}),
    ...(mode === 'detailed'
      ? {
          basePreview: file.basePreview,
          baseTruncated: file.baseTruncated,
          mergedPreview: file.mergedPreview,
          mergedTruncated: file.mergedTruncated,
          currentPreview: file.currentPreview,
          templatePreview: file.templatePreview,
          currentTruncated: file.currentTruncated,
          templateTruncated: file.templateTruncated,
        }
      : {}),
  }
}

function previewPayload(plan: TemplateUpgradePlan, mode: OutputMode, explicitTarget = false) {
  const changes = plan.files.filter((file) => file.status === 'ready')
  const preserved = plan.files.filter((file) => file.status === 'preserved')
  const conflicts = plan.files.filter((file) => file.status === 'conflict')
  const sameVersion = plan.fromVersion === plan.toVersion
  const versionMismatch = plan.template !== 'alice-harness' && sameVersion && (changes.length > 0 || conflicts.length > 0)
  const current = sameVersion && changes.length === 0 && conflicts.length === 0
  const status = plan.blocked
    ? 'blocked'
    : versionMismatch
      ? 'template_version_not_bumped'
      : current
      ? 'current'
      : conflicts.length > 0
        ? 'needs_resolution'
        : 'ready'

  return {
    status,
    workspaceId: plan.workspaceId,
    template: plan.template,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    source: plan.source,
    summary: plan.summary,
    blockers: plan.blockers,
    activity: {
      busy: plan.activity.busy,
      activeSessions: plan.activity.sessions.length,
      headlessRuns: plan.activity.headless.length,
    },
    changes: changes.map((file) => fileSummary(file, mode)),
    preserved: preserved.map((file) => fileSummary(file, mode)),
    conflicts: conflicts.map((file) => fileSummary(file, mode)),
    nextCommand: plan.blocked || current || versionMismatch
      ? null
      : conflicts.length > 0
        ? 'Run with --mode detailed to compare Base, Workspace and incoming content. Edit conflicting files to retain user intent and adopt current CLI instructions, then re-run the preview. Use --keep-workspace <path> for your resolved file or --use-template <path> to replace it; add --apply to finish.'
        : `alice ${plan.template === 'alice-harness' ? 'harness' : 'template'} upgrade${explicitTarget ? ` --id ${plan.workspaceId}` : ''} --apply`,
  }
}

function errorPayload(err: unknown, mode: OutputMode, explicitTarget = false) {
  const value = err && typeof err === 'object' ? err as Record<string, unknown> : null
  const plan = value?.['plan'] as TemplateUpgradePlan | undefined
  return {
    ok: false as const,
    error: {
      code: typeof value?.['code'] === 'string' ? value['code'] : 'upgrade_failed',
      message: err instanceof Error ? err.message : String(err),
    },
    ...(plan ? { preview: previewPayload(plan, mode, explicitTarget) } : {}),
  }
}

/**
 * Current-Workspace template reconciliation for the embedded CLI.
 *
 * The default call is deliberately read-only. `--apply` is the explicit user
 * confirmation; the tool still obtains and submits the manager's plan digest
 * internally, so agents never need to hand-roll the HTTP transaction.
 */
export const workspaceTemplateUpgradeFactory: WorkspaceToolFactory = {
  name: 'workspace_template_upgrade',
  build(ctx) {
    return tool({
      description: [
        "Preview or safely apply the current Workspace's managed template upgrade.",
        '',
        'Without --apply this is read-only and returns the changed, preserved, and conflicting managed files.',
        'With --apply it re-plans and submits the exact current plan through the launcher transaction.',
        'Omit --id for this Workspace, or pass a peer Workspace id when acting as an interactive manager.',
        'Research, reports, Issues, credentials, runtime state, and other user files are outside the managed set.',
        'Non-overlapping text changes merge automatically with Git; the official source remains the next baseline.',
        'If conflicts exist, inspect --mode detailed, edit the files to resolve them, then resolve every one with repeatable --keep-workspace <path> or --use-template <path>.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().min(1).optional()
          .describe('Workspace id to upgrade. Defaults to the current Workspace.'),
        apply: z.boolean().optional().default(false)
          .describe('Apply the current plan. Omit for a read-only preview.'),
        keepWorkspace: z.array(z.string().min(1)).optional()
          .describe('Conflict path to keep from the Workspace (repeatable; requires --apply).'),
        useTemplate: z.array(z.string().min(1)).optional()
          .describe('Conflict path to replace with the template copy (repeatable; requires --apply).'),
        skill: z.enum(ALICE_HARNESS_SKILLS).optional().describe('Alice Harness only: scope the operation to this Skill.'),
        action: z.enum(['install', 'update', 'remove', 'restore']).optional().describe('Requires --skill. Defaults to update; restore replaces local files with the Project copy.'),
        mode: z.enum(['summary', 'detailed']).optional().default('summary')
          .describe('Detailed includes conflict file previews; summary is the compact default.'),
      }),
      execute: async ({ id, apply, keepWorkspace = [], useTemplate = [], mode, skill, action }) => {
        const manager = ctx.templateUpgrades
        const workspaceId = id ?? ctx.workspaceId
        const explicitTarget = id !== undefined
        const crossWorkspace = workspaceId !== ctx.workspaceId
        if (!manager) {
          return {
            ok: false as const,
            error: {
              code: 'unavailable',
              message: 'Workspace template upgrades are unavailable in this context.',
            },
          }
        }
        if (!apply && (keepWorkspace.length > 0 || useTemplate.length > 0)) {
          return {
            ok: false as const,
            error: {
              code: 'apply_required',
              message: 'Conflict resolution flags require --apply. Omit them for a read-only preview.',
            },
          }
        }
        if (apply && crossWorkspace && ctx.origin?.kind === 'headless') {
          return {
            ok: false as const,
            error: {
              code: 'interactive_required',
              message: 'A headless run may preview a peer upgrade but cannot apply one. Ask the user to apply it interactively.',
            },
          }
        }

        if (action && !skill) return { ok: false as const, error: { code: 'skill_required', message: '--action requires --skill.' } }
        const projection: SkillProjectionRequest | undefined = skill ? { skill, action: action ?? 'update' } : undefined
        try {
          const plan = await (projection ? manager.plan(workspaceId, projection) : manager.plan(workspaceId))
          const preview = previewPayload(plan, mode, explicitTarget)
          if (projection && typeof preview.nextCommand === 'string' && preview.nextCommand.startsWith('alice ')) {
            preview.nextCommand += ` --skill ${projection.skill} --action ${projection.action}`
          }
          if (!apply) return { ok: true as const, action: 'preview' as const, preview }
          if (plan.blocked) {
            return {
              ok: false as const,
              error: { code: 'blocked', message: 'Prepare this Workspace before applying the upgrade.' },
              preview,
            }
          }
          const changedAtSameVersion = plan.template !== 'alice-harness' && plan.fromVersion === plan.toVersion
            && plan.files.some((file) => file.status === 'ready' || file.status === 'conflict')
          if (changedAtSameVersion) {
            return {
              ok: false as const,
              error: {
                code: 'template_version_not_bumped',
                message: 'The template contents changed without a version bump. Update the template version before applying.',
              },
              preview,
            }
          }
          if (plan.fromVersion === plan.toVersion && !plan.files.some((file) => file.status === 'ready' || file.status === 'conflict')) {
            return { ok: true as const, action: 'noop' as const, preview }
          }

          const conflictPaths = new Set(
            plan.files.filter((file) => file.status === 'conflict').map((file) => file.path),
          )
          const duplicate = keepWorkspace.filter((path) => useTemplate.includes(path))
          const unknown = [...keepWorkspace, ...useTemplate].filter((path) => !conflictPaths.has(path))
          const supplied = new Set([...keepWorkspace, ...useTemplate])
          const unresolved = [...conflictPaths].filter((path) => !supplied.has(path))
          if (duplicate.length > 0 || unknown.length > 0 || unresolved.length > 0) {
            return {
              ok: false as const,
              error: {
                code: 'invalid_resolutions',
                message: 'Resolve each conflict exactly once before applying.',
                duplicate,
                unknown,
                unresolved,
              },
              preview,
            }
          }

          const resolutions: Record<string, TemplateUpgradeResolution> = {}
          for (const path of keepWorkspace) resolutions[path] = 'workspace'
          for (const path of useTemplate) resolutions[path] = 'template'
          const result = await manager.apply(workspaceId, {
            planDigest: plan.planDigest,
            ...(projection ? { projection } : {}),
            ...(Object.keys(resolutions).length > 0 ? { resolutions } : {}),
          })
          return {
            ok: true as const,
            action: 'applied' as const,
            result,
          }
        } catch (err) {
          return errorPayload(err, mode, explicitTarget)
        }
      },
    })
  },
}

/** Same reconciliation contract, independently versioned Project injection layer. */
export const aliceHarnessUpgradeFactory: WorkspaceToolFactory = {
  name: 'alice_harness_upgrade',
  build(ctx) {
    const result = workspaceTemplateUpgradeFactory.build({ ...ctx, templateUpgrades: ctx.aliceHarnessUpgrades })
    return { ...result, description: result.description?.replace('managed template upgrade', 'Alice Harness Skills file update (respects Workspace Skill preferences; CLI runtime updates with the Project, independently of this operation)') }
  },
}
