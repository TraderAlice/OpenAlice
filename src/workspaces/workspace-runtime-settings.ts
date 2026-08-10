import { z } from 'zod'

import { MODEL_REASONING_EFFORTS } from '../ai-providers/model-semantics.js'
import { credentialWireShapeEnum } from '../core/config.js'
import type {
  ResolvedSessionRuntimeBinding,
  SessionRuntimeBinding,
} from './cli-adapter.js'
import { readWorkspaceFile, writeWorkspaceFile } from './file-service.js'
import type { SessionRuntimeSelection } from './session-runtime-binding.js'

export const WORKSPACE_RUNTIME_SETTINGS_REL = '.alice/settings.json'

const MAX_BYTES = 64 * 1024
const runtimeIdSchema = z.string().trim().min(1).max(64)
const modelSchema = z.string().trim().min(1).max(512)
const credentialSlugSchema = z.string().trim().min(1).max(128)
const reasoningEffortSchema = z.enum(MODEL_REASONING_EFFORTS)

const nativePreferenceSchema = z.object({
  accessMode: z.literal('native'),
  model: modelSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
}).strict()

const vaultPreferenceSchema = z.object({
  accessMode: z.literal('vault'),
  credentialSlug: credentialSlugSchema,
  wireShape: credentialWireShapeEnum.optional(),
  model: modelSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
}).strict()

export const workspaceRuntimePreferenceSchema = z.discriminatedUnion('accessMode', [
  nativePreferenceSchema,
  vaultPreferenceSchema,
])

const recentSettingsSchema = z.object({
  agent: runtimeIdSchema.optional(),
  agents: z.record(runtimeIdSchema, workspaceRuntimePreferenceSchema).default({}),
}).strict()

const modeSettingsSchema = z.object({
  defaultAgent: runtimeIdSchema.optional(),
  agents: z.record(runtimeIdSchema, workspaceRuntimePreferenceSchema).default({}),
  recent: recentSettingsSchema.default({ agents: {} }),
}).strict()

export const workspaceRuntimeSettingsSchema = z.object({
  version: z.literal(3),
  runtime: z.object({
    interactive: modeSettingsSchema.default({ agents: {}, recent: { agents: {} } }),
    headless: modeSettingsSchema.default({ agents: {}, recent: { agents: {} } }),
  }).strict().default({
    interactive: { agents: {}, recent: { agents: {} } },
    headless: { agents: {}, recent: { agents: {} } },
  }),
}).strict()

export type WorkspaceRuntimePreference = z.infer<typeof workspaceRuntimePreferenceSchema>
export type WorkspaceRuntimeSettings = z.infer<typeof workspaceRuntimeSettingsSchema>
export type WorkspaceRuntimeMode = keyof WorkspaceRuntimeSettings['runtime']

export type ReadWorkspaceRuntimeSettingsResult =
  | { ok: true; settings: WorkspaceRuntimeSettings }
  | { ok: false; reason: 'absent' }
  | { ok: false; reason: 'invalid'; error: string }

export function emptyWorkspaceRuntimeSettings(): WorkspaceRuntimeSettings {
  return {
    version: 3,
    runtime: {
      interactive: { agents: {}, recent: { agents: {} } },
      headless: { agents: {}, recent: { agents: {} } },
    },
  }
}

export async function readWorkspaceRuntimeSettings(
  wsDir: string,
): Promise<ReadWorkspaceRuntimeSettingsResult> {
  let raw: string | null
  try {
    raw = await readWorkspaceFile(wsDir, WORKSPACE_RUNTIME_SETTINGS_REL)
  } catch (error) {
    return { ok: false, reason: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
  if (raw === null) return { ok: false, reason: 'absent' }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    return { ok: false, reason: 'invalid', error: `workspace runtime settings file too large (max ${MAX_BYTES} bytes)` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, reason: 'invalid', error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  const result = workspaceRuntimeSettingsSchema.safeParse(parsed)
  if (result.success) return { ok: true, settings: result.data }
  return {
    ok: false,
    reason: 'invalid',
    error: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
  }
}

export async function writeWorkspaceRuntimeSettings(
  wsDir: string,
  settings: WorkspaceRuntimeSettings,
): Promise<WorkspaceRuntimeSettings> {
  const parsed = workspaceRuntimeSettingsSchema.parse(settings)
  await writeWorkspaceFile(wsDir, WORKSPACE_RUNTIME_SETTINGS_REL, `${JSON.stringify(parsed, null, 2)}\n`)
  return parsed
}

const updateQueues = new Map<string, Promise<void>>()

/** Serialize read-modify-write updates inside one launcher process. */
async function updateWorkspaceRuntimeSettings(
  wsDir: string,
  update: (current: WorkspaceRuntimeSettings) => WorkspaceRuntimeSettings,
): Promise<WorkspaceRuntimeSettings> {
  const prior = updateQueues.get(wsDir) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  const queued = prior.then(() => next)
  updateQueues.set(wsDir, queued)
  await prior
  try {
    const read = await readWorkspaceRuntimeSettings(wsDir)
    if (!read.ok && read.reason === 'invalid') {
      throw new Error(`cannot update invalid Workspace runtime settings: ${read.error}`)
    }
    return await writeWorkspaceRuntimeSettings(
      wsDir,
      update(read.ok ? read.settings : emptyWorkspaceRuntimeSettings()),
    )
  } finally {
    release()
    if (updateQueues.get(wsDir) === queued) updateQueues.delete(wsDir)
  }
}

function sameCredential(
  preference: WorkspaceRuntimePreference | undefined,
  selection: SessionRuntimeSelection,
): boolean {
  if (selection.credentialSource === 'native') return preference?.accessMode === 'native'
  if (selection.credentialSlug) {
    return preference?.accessMode === 'vault' && preference.credentialSlug === selection.credentialSlug
  }
  return true
}

/**
 * Merge one-launch fields over the selected Workspace surface/Agent default.
 * A newly selected credential does not inherit a model or effort remembered
 * for a different credential.
 */
export function resolveWorkspaceRuntimeSelection(
  settings: WorkspaceRuntimeSettings | null,
  mode: WorkspaceRuntimeMode,
  agent: string,
  explicit: SessionRuntimeSelection | undefined,
): SessionRuntimeSelection | undefined {
  const configured = settings?.runtime[mode].agents[agent]
  const preference = configured ?? settings?.runtime[mode].recent.agents[agent]
  const requested = explicit ?? {}
  const mayInheritModel = sameCredential(preference, requested)
  const credential = requested.credentialSource === 'native'
    ? { credentialSource: 'native' as const }
    : requested.credentialSlug
      ? { credentialSlug: requested.credentialSlug }
      : preference?.accessMode === 'vault'
        ? { credentialSlug: preference.credentialSlug }
        : { credentialSource: 'native' as const }
  const model = requested.model ?? (mayInheritModel ? preference?.model : undefined)
  const reasoningEffort = requested.reasoningEffort
    ?? (mayInheritModel ? preference?.reasoningEffort : undefined)
  return {
    ...credential,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

/** Resolve the launch mode's preferred Agent without consulting installation state. */
export function resolveWorkspaceRuntimeAgent(
  settings: WorkspaceRuntimeSettings | null,
  mode: WorkspaceRuntimeMode,
): string | undefined {
  const configured = settings?.runtime[mode]
  return configured?.defaultAgent ?? configured?.recent.agent
}

export async function replaceWorkspaceRuntimeDefaults(input: {
  readonly wsDir: string
  readonly runtime: Readonly<Record<WorkspaceRuntimeMode, {
    readonly defaultAgent: string | null
    readonly agents: Readonly<Record<string, WorkspaceRuntimePreference>>
  }>>
}): Promise<WorkspaceRuntimeSettings> {
  return updateWorkspaceRuntimeSettings(input.wsDir, (current) => {
    const mode = (name: WorkspaceRuntimeMode) => ({
      ...(input.runtime[name].defaultAgent ? { defaultAgent: input.runtime[name].defaultAgent } : {}),
      agents: { ...input.runtime[name].agents },
      recent: current.runtime[name].recent,
    })
    return {
      ...current,
      runtime: {
        interactive: mode('interactive'),
        headless: mode('headless'),
      },
    }
  })
}

function preferenceFromBinding(binding: SessionRuntimeBinding): WorkspaceRuntimePreference | null {
  if (binding.credential.source === 'workspace') return null
  const modelAndEffort = {
    ...(binding.model ? { model: binding.model } : {}),
    ...(binding.reasoningEffort ? { reasoningEffort: binding.reasoningEffort } : {}),
  }
  if (binding.credential.source === 'native') {
    return { accessMode: 'native', ...modelAndEffort }
  }
  return {
    accessMode: 'vault',
    credentialSlug: binding.credential.credentialSlug,
    wireShape: binding.credential.wireShape,
    ...modelAndEffort,
  }
}

/** Record only a fresh Session's accepted, secret-free launch binding. */
export async function rememberWorkspaceRuntimeBinding(input: {
  readonly wsDir: string
  readonly mode: WorkspaceRuntimeMode
  readonly agent: string
  readonly runtime: ResolvedSessionRuntimeBinding
}): Promise<WorkspaceRuntimeSettings | null> {
  const preference = preferenceFromBinding(input.runtime.binding)
  if (!preference) return null
  return updateWorkspaceRuntimeSettings(input.wsDir, (current) => ({
    ...current,
    runtime: {
      ...current.runtime,
      [input.mode]: {
        ...current.runtime[input.mode],
        recent: {
          agent: input.agent,
          agents: {
            ...current.runtime[input.mode].recent.agents,
            [input.agent]: preference,
          },
        },
      },
    },
  }))
}
