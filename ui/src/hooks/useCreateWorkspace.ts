import { useCallback, useState } from 'react'
import { createWorkspace, type AgentInfo, type Workspace } from '../components/workspace/api'

export const TAG_HINT = 'a-z, 0-9, "-", "_", up to 33 chars'
export const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/

interface UseCreateWorkspaceOpts {
  /** Workspace template to create from. Empty string = not yet selected. */
  template: string
  /**
   * Template's declared defaultAgents. Used to determine agents[0], which
   * is the default adapter when the user spawns a new session via "+".
   * The full set of adapters is always enabled regardless — this only
   * sets the head of the list.
   */
  templateDefaultAgents?: readonly string[]
  /** All adapters registered with the workspace launcher. All get enabled. */
  availableAgents: readonly AgentInfo[]
  /** Called with the new workspace after a successful create. */
  onCreated: (workspace: Workspace) => void
}

interface UseCreateWorkspaceState {
  tag: string
  setTag: (s: string) => void
  creating: boolean
  error: string | null
  submit: () => Promise<void>
  reset: () => void
}

/**
 * Shared "create workspace" form logic. The three create surfaces
 * (Workspaces sidebar quick-create, Chat workspace section, Template
 * detail page) used to each carry their own copy of tag validation +
 * agent-checkbox state + submit handler. They've drifted in small ways
 * over time; bundling here keeps them in lockstep.
 *
 * Agent policy: every workspace gets every available adapter enabled.
 * The CLI-checkbox row that previously asked users to pick was a
 * decision with no first-action judgement basis; defaults were also
 * wrong (only claude when a template didn't explicitly opt in to more).
 * `templateDefaultAgents` is still honored as the head of the list so
 * `agents[0]` — the "spawn a new session" default — follows template
 * intent. Template authors can still steer the new-session default
 * without restricting what's available.
 */
export function useCreateWorkspace(opts: UseCreateWorkspaceOpts): UseCreateWorkspaceState {
  const [tag, setTag] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async (): Promise<void> => {
    const t = tag.trim()
    if (!TAG_RE.test(t)) {
      setError(`invalid tag (${TAG_HINT})`)
      return
    }
    if (opts.template === '') {
      setError('no template selected')
      return
    }
    const head = opts.templateDefaultAgents ?? []
    const seen = new Set<string>(head)
    const agents: string[] = [...head]
    for (const a of opts.availableAgents) {
      if (!seen.has(a.id)) {
        agents.push(a.id)
        seen.add(a.id)
      }
    }
    setCreating(true)
    setError(null)
    const result = await createWorkspace(t, opts.template, agents)
    setCreating(false)
    if (result.ok) {
      setTag('')
      opts.onCreated(result.workspace)
    } else {
      const msg = result.error.message ?? result.error.error ?? `HTTP ${result.status}`
      setError(msg)
    }
  }, [tag, opts])

  const reset = useCallback((): void => {
    setTag('')
    setError(null)
  }, [])

  return { tag, setTag, creating, error, submit, reset }
}
