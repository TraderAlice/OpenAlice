import { parse } from 'yaml'
import { useEffect, useState } from 'react'
import {
  listFiles,
  readWorkspaceFile,
  type ReadFileResult,
} from '../components/workspace/api'
import { fetchJson } from '../api/client'

export const cliExports = [
  { key: 'data', name: 'alice' },
  { key: 'traderhub', name: 'traderhub' },
  { key: 'uta', name: 'alice-uta' },
] as const
export interface CliManifest {
  description: string
  groupDescriptions: Record<string, string>
  groups: Record<
    string,
    Record<
      string,
      {
        description: string
        schema: {
          properties?: Record<
            string,
            {
              type?: string
              description?: string
              enum?: unknown[]
              default?: unknown
            }
          >
          required?: string[]
        }
      }
    >
  >
}
export type CapabilityOwner = 'alice-harness' | 'workspace' | 'unknown'
export interface WorkspaceSkill {
  owner?: CapabilityOwner
  name: string
  description?: string
  path: string
  content: ReadFileResult
  locations: string[]
  source?: 'canonical' | 'mirror-only' | 'legacy' | 'unchecked'
  mirrors?: { path: string; label: string; present?: boolean }[]
}
export interface CapabilityInventory {
  skills: WorkspaceSkill[]
  instructions: WorkspaceSkill[]
  errors: string[]
  roots: string[]
}

/** Actual Workspace files, not a projection of today's template catalog. */
export async function loadWorkspaceCapabilities(
  wsId: string,
): Promise<CapabilityInventory> {
  const roots: string[] = []
  const errors: string[] = []
  const skills: WorkspaceSkill[] = []
  const [root, ownership] = await Promise.all([
    listFiles(wsId, ''),
    fetchJson<{ managedSkillNames: string[] }>(`/api/workspaces/${encodeURIComponent(wsId)}/alice-harness`)
      .then((value) => {
        if (!value || !Array.isArray(value.managedSkillNames) || !value.managedSkillNames.every((name) => typeof name === 'string')) throw new Error('Alice Harness ownership inventory unavailable')
        return new Set(value.managedSkillNames)
      })
      .catch((error) => { errors.push(`Alice Harness: ${error instanceof Error ? error.message : String(error)}`); return null }),
  ])
  await Promise.all(
    ['.agents', '.claude', '.pi'].map(async (parent) => {
      if (
        !root.entries.some(
          (e) => e.name === parent && ['dir', 'symlink'].includes(e.kind),
        )
      )
        return
      try {
        const folder = await listFiles(wsId, parent)
        if (!folder.entries.some((e) => e.name === 'skills')) return
        const path = `${parent}/skills`
        roots.push(path)
        const entries = await listFiles(wsId, path)
        const loaded = await Promise.all(
          entries.entries
            .filter((e) => ['dir', 'symlink'].includes(e.kind))
            .map(async (entry) => {
              const file = `${path}/${entry.name}/SKILL.md`
              return {
                name: entry.name,
                path: file,
                locations: [file],
                content: await readWorkspaceFile(wsId, file),
              }
            }),
        )
        skills.push(...loaded)
      } catch (error) {
        errors.push(
          `${parent}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),
  )
  const grouped: WorkspaceSkill[] = []
  for (const name of [...new Set(skills.map((s) => s.name))]) {
    const copies = skills.filter((s) => s.name === name)
    const primary = copies.find((s) => s.path.startsWith('.agents/'))
    const claude = copies.find((s) => s.path.startsWith('.claude/'))
    const pi = copies.find((s) => s.path.startsWith('.pi/'))
    const chosen = primary ?? claude ?? pi!
    grouped.push({
      ...chosen,
      owner: ownership ? ownership.has(name) ? 'alice-harness' : 'workspace' : 'unknown',
      locations: copies.map((s) => s.path),
      source: primary
        ? 'canonical'
        : errors.some((e) => e.startsWith('.agents:'))
          ? 'unchecked'
          : claude
            ? 'mirror-only'
            : 'legacy',
      mirrors: [
        {
          path: `.claude/skills/${name}`,
          label: 'Claude',
          present: errors.some((e) => e.startsWith('.claude:'))
            ? undefined
            : Boolean(claude),
        },
        ...(pi
          ? [{ path: `.pi/skills/${name}`, label: 'Pi', present: true }]
          : []),
      ],
    })
  }
  const [agents, claude] = await Promise.all(
    ['AGENTS.md', 'CLAUDE.md'].map((path) => readWorkspaceFile(wsId, path)),
  )
  const instructions: WorkspaceSkill[] = [
    {
      name: 'AGENTS.md',
      owner: 'workspace',
      path:
        agents.kind === 'file_missing' && claude.kind === 'ok'
          ? 'CLAUDE.md'
          : 'AGENTS.md',
      content:
        agents.kind === 'file_missing' && claude.kind === 'ok'
          ? claude
          : agents,
      locations: ['AGENTS.md'],
      source:
        agents.kind === 'ok'
          ? 'canonical'
          : agents.kind === 'file_missing'
            ? 'mirror-only'
            : 'unchecked',
      mirrors: [
        {
          path: 'CLAUDE.md',
          label: 'Claude',
          present:
            claude.kind === 'file_missing'
              ? false
              : claude.kind === 'ok'
                ? true
                : undefined,
        },
      ],
    },
  ]
  for (const skill of grouped) {
    if (skill.content.kind !== 'ok') continue
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
      skill.content.content,
    )
    if (!header) continue
    try {
      const metadata = parse(header[1]!, { maxAliasCount: 0 }) as unknown
      if (
        metadata &&
        typeof metadata === 'object' &&
        'description' in metadata &&
        typeof metadata.description === 'string'
      )
        skill.description = metadata.description
    } catch {
      /* The complete source remains available even for invalid YAML. */
    }
  }
  return {
    skills: grouped.sort((a, b) => a.name.localeCompare(b.name)),
    instructions,
    roots: roots.sort(),
    errors,
  }
}

export function useWorkspaceCapabilities(wsId: string, attempt: number) {
  const [state, setState] = useState<{
    id: string
    data?: CapabilityInventory
    error?: string
  }>()
  useEffect(() => {
    let alive = true
    setState(undefined)
    void loadWorkspaceCapabilities(wsId).then(
      (data) => {
        if (alive) setState({ id: wsId, data })
      },
      (error) => {
        if (alive)
          setState({
            id: wsId,
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      alive = false
    }
  }, [wsId, attempt])
  return state?.id === wsId ? state : undefined
}

export function useWorkspaceCli(
  wsId: string,
  exportKey: string,
  attempt: number,
) {
  const id = `${wsId}:${exportKey}`
  const [state, setState] = useState<{
    id: string
    data?: CliManifest
    error?: string
  }>()
  useEffect(() => {
    let alive = true
    setState(undefined)
    void fetchJson<CliManifest>(
      `/api/workspaces/${encodeURIComponent(wsId)}/cli/${exportKey}/manifest`,
    ).then(
      (data) => {
        if (alive) setState({ id, data })
      },
      (error) => {
        if (alive)
          setState({
            id,
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      alive = false
    }
  }, [wsId, exportKey, attempt, id])
  return state?.id === id ? state : undefined
}
