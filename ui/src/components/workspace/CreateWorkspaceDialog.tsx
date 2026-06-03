/**
 * Modal presentation of `CreateWorkspaceForm`. The sidebar quick-create
 * (Workspaces activity) and the Chat section's `+` both render this — a
 * popup with room to grow, instead of cramming fields into the sidebar.
 *
 * The form owns all create logic; this only supplies the modal chrome and
 * closes itself on success.
 */

import type { ReactElement } from 'react'

import { Dialog } from '../uta/Dialog'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'
import type { AgentInfo, TemplateInfo, Workspace } from './api'

export interface CreateWorkspaceDialogProps {
  readonly templates: readonly TemplateInfo[]
  readonly agents: readonly AgentInfo[]
  /** Pin the template (Chat section). Omit for the general sidebar create. */
  readonly presetTemplate?: string
  /** Seed the tag input (e.g. the Chat section's date-based default). */
  readonly initialTag?: string
  readonly onCreated: (workspace: Workspace) => void
  readonly onClose: () => void
}

export function CreateWorkspaceDialog(props: CreateWorkspaceDialogProps): ReactElement {
  return (
    <Dialog onClose={props.onClose} width="w-[460px]">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-[15px] font-semibold text-text">New workspace</h2>
        <p className="text-[12px] text-text-muted mt-0.5">
          Spawn a fresh harness instance — a managed, persistent agent session.
        </p>
      </div>
      <div className="px-5 py-4">
        <CreateWorkspaceForm
          templates={props.templates}
          agents={props.agents}
          presetTemplate={props.presetTemplate}
          initialTag={props.initialTag}
          autoFocusTag
          onCancel={props.onClose}
          onCreated={(workspace) => {
            props.onCreated(workspace)
            props.onClose()
          }}
        />
      </div>
    </Dialog>
  )
}
