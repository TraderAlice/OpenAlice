import { useCallback, useState } from 'react'
import { createWorkspace, type Workspace } from '../components/workspace/api'

export const TAG_HINT = 'a-z, 0-9, "-", "_", up to 33 chars'
export const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/

/**
 * Derive a default tag for a new workspace: `<template>-<month><day>`
 * (`chat-jun11`), suffixed `-2`, `-3`, … on collision with existing tags.
 * Truncates the template part so the result always fits TAG_RE's 33 chars.
 */
export function defaultTagFor(template: string, workspaces: readonly Workspace[]): string {
  const now = new Date()
  const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase()
  const date = `${month}${now.getDate()}`
  const head = template.slice(0, 33 - date.length - 4) // room for "-" + date + "-NN"
  const base = `${head}-${date}`
  const taken = new Set(workspaces.map((w) => w.tag))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

interface UseCreateWorkspaceOpts {
  /** Workspace template to create from. Empty string = not yet selected. */
  template: string
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
 * Adapter enablement policy lives in the backend (`WorkspaceCreator.create`):
 * every workspace gets every registered adapter enabled, with template
 * defaults kept only as ordering hints. The user's default runtime is stored
 * separately; `shell` is a utility adapter, not a default workload candidate.
 * This hook sends NO agent set, so the form, quick-chat, and headless all
 * converge on that one source of truth.
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
    setCreating(true)
    setError(null)
    const result = await createWorkspace(t, opts.template)
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
