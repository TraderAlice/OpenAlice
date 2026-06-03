/**
 * The one create-workspace form. Owns the shared create logic
 * (`useCreateWorkspace`) AND the template-selection state, so every surface
 * that needs to spawn a workspace — the Workspaces sidebar, the Chat
 * section, the template detail page, and whatever comes next — renders
 * `<CreateWorkspaceForm />` and writes zero form logic of its own.
 *
 * Two presentations wrap this: `CreateWorkspaceDialog` (modal, for the
 * sidebar quick-create) and the template detail page (inline panel). The
 * fields are identical; only the chrome (header, modal vs panel) differs,
 * and that lives in the wrappers.
 *
 * Adding a new create-time option (agent count, budget, sandbox tier, …)
 * is a one-place edit here — it appears everywhere at once.
 */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import { TAG_HINT, useCreateWorkspace } from '../../hooks/useCreateWorkspace'
import type { AgentInfo, TemplateInfo, Workspace } from './api'

export interface CreateWorkspaceFormProps {
  /** Full template catalog — drives the select and resolves defaultAgents. */
  readonly templates: readonly TemplateInfo[]
  /** All registered adapters; every workspace enables all of them. */
  readonly agents: readonly AgentInfo[]
  /**
   * Pin the template (Chat section, template detail page). When set, no
   * template select is shown. When omitted, the user picks from `templates`.
   */
  readonly presetTemplate?: string
  /** Seed the tag input once on mount (e.g. the Chat section's `chat-may13`). */
  readonly initialTag?: string
  /** Called with the new workspace after a successful create. */
  readonly onCreated: (workspace: Workspace) => void
  /** When provided, renders a Cancel button (dialog use). */
  readonly onCancel?: () => void
  /** Focus + select the tag input on mount (dialog / toggle-open use). */
  readonly autoFocusTag?: boolean
  /** Submit button label. Default "Create workspace". */
  readonly submitLabel?: string
}

const FIELD =
  'w-full px-3 py-2 text-[13px] bg-bg border border-border rounded text-text focus:outline-none focus:border-accent'
const LABEL = 'block text-[11px] uppercase tracking-wider text-text-muted/70'
const HINT = 'text-[11px] text-text-muted/70'

export function CreateWorkspaceForm(props: CreateWorkspaceFormProps): ReactElement {
  const { templates, agents, presetTemplate, initialTag, onCancel, autoFocusTag } = props

  // Template selection. Fixed when `presetTemplate` is set; otherwise the
  // user picks, defaulting to `chat` (then first available).
  const [selected, setSelected] = useState<string>(presetTemplate ?? '')
  useEffect(() => {
    if (presetTemplate) return
    if (selected !== '') return
    if (templates.length === 0) return
    const preferred = templates.find((t) => t.name === 'chat') ?? templates[0]!
    setSelected(preferred.name)
  }, [templates, selected, presetTemplate])

  const effectiveTemplate = presetTemplate ?? selected
  const selectedMeta = templates.find((t) => t.name === effectiveTemplate)

  const create = useCreateWorkspace({
    template: effectiveTemplate,
    templateDefaultAgents: selectedMeta?.defaultAgents,
    availableAgents: agents,
    onCreated: props.onCreated,
  })

  // Seed the default tag + focus, once, on mount.
  const tagRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (initialTag) create.setTag(initialTag)
    if (autoFocusTag) {
      const id = setTimeout(() => {
        tagRef.current?.focus()
        tagRef.current?.select()
      }, 0)
      return () => clearTimeout(id)
    }
    return undefined
    // Mount-only: seeding/focusing on every render would fight user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    await create.submit()
  }

  const showTemplateSelect = !presetTemplate && templates.length > 1

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {showTemplateSelect && (
        <div className="space-y-1.5">
          <label htmlFor="cw-template" className={LABEL}>
            Template
          </label>
          <select
            id="cw-template"
            value={effectiveTemplate}
            onChange={(e) => setSelected(e.target.value)}
            disabled={create.creating}
            className={FIELD}
          >
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.displayName ?? t.name}
              </option>
            ))}
          </select>
          {selectedMeta?.description && <p className={HINT}>{selectedMeta.description}</p>}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="cw-tag" className={LABEL}>
          Tag
        </label>
        <input
          id="cw-tag"
          ref={tagRef}
          type="text"
          placeholder="e.g. may1"
          value={create.tag}
          onChange={(e) => create.setTag(e.target.value)}
          disabled={create.creating}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className={`${FIELD} font-mono placeholder:text-text-muted/50`}
        />
        <p className={HINT}>{TAG_HINT}</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="cw-tools" className={LABEL}>
          Tools
        </label>
        <select
          id="cw-tools"
          value={create.toolAccess}
          onChange={(e) => create.setToolAccess(e.target.value as 'mcp' | 'cli')}
          disabled={create.creating}
          className={FIELD}
        >
          <option value="mcp">MCP — data tools as MCP servers (default)</option>
          <option value="cli">CLI — data tools via the `alice` command on PATH</option>
        </select>
        <p className={HINT}>
          How the agent reaches Alice&apos;s data tools. Applies to tool-injecting workspaces.
        </p>
      </div>

      {create.error && <div className="text-[12px] text-red">{create.error}</div>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={create.creating}
            className="px-3 py-2 text-[13px] rounded text-text-muted hover:text-text hover:bg-bg-secondary"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={create.creating || create.tag.length === 0 || effectiveTemplate === ''}
          className="btn-primary"
        >
          {create.creating ? 'Creating…' : (props.submitLabel ?? 'Create workspace')}
        </button>
      </div>
    </form>
  )
}
