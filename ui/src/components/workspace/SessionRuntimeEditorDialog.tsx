import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { QuickChatLaunchPreference } from '../../api/preferences'
import {
  useAgentLaunchConfig,
  type AgentLaunchPreferencesState,
} from '../../hooks/useAgentLaunchConfig'
import { AgentLaunchSelectors } from './AgentLaunchControls'
import type {
  AgentInfo,
  PausedSessionRuntimeUpdate,
  SessionRecord,
} from './api'

interface SessionRuntimeEditorDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: SessionRecord
  readonly agents: readonly AgentInfo[]
  readonly workspaceId: string
  readonly onSave: (update: PausedSessionRuntimeUpdate) => Promise<void>
}

function runtimeLaunch(record: SessionRecord): QuickChatLaunchPreference {
  const runtime = record.runtime
  const vault = runtime?.credentialSource === 'vault' && Boolean(runtime.credentialSlug)
  return {
    agent: record.agent,
    accessMode: vault ? 'vault' : 'native',
    credentialSlug: vault ? runtime?.credentialSlug ?? null : null,
    model: runtime?.model ?? null,
    reasoningEffort: runtime?.reasoningEffort ?? null,
  }
}

/** Transactional editor for the binding persisted beside one paused Session.
 * Picker changes remain local until Save; they never rewrite Workspace recent
 * preferences or wake the Session as a side effect. */
export function SessionRuntimeEditorDialog({
  open,
  onOpenChange,
  record,
  agents,
  workspaceId,
  onSave,
}: SessionRuntimeEditorDialogProps) {
  const initial = useMemo(() => runtimeLaunch(record), [record])
  const initialKey = JSON.stringify(initial)
  const [draft, setDraft] = useState<QuickChatLaunchPreference>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(initial)
    setError(null)
    // Reset only when this dialog opens for a different persisted binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey, open])

  const rememberLaunch = useCallback(async (launch: QuickChatLaunchPreference) => {
    setDraft(launch)
  }, [])
  const preferences = useMemo<AgentLaunchPreferencesState>(() => ({
    lastCredentialByAgent: draft.credentialSlug
      ? { [record.agent]: draft.credentialSlug }
      : {},
    recentChatWorkspaceId: workspaceId,
    recentLaunch: draft,
    loaded: true,
    rememberLaunch,
    adoptRecentChatWorkspace: () => undefined,
  }), [draft, record.agent, rememberLaunch, workspaceId])
  const runtimeAgents = useMemo(
    () => agents.filter((agent) => agent.id === record.agent),
    [agents, record.agent],
  )
  const config = useAgentLaunchConfig({
    agents: runtimeAgents,
    defaultAgent: record.agent,
    preferences,
    workspaceId,
    hasWorkspace: true,
    managedWorkspaceLaunch: true,
  })
  const runtimeName = runtimeAgents[0]?.displayName ?? record.agent

  const submit = async () => {
    if (saving || !config.effectiveAgent) return
    const vault = config.accessMode === 'vault' && Boolean(config.launchCredentialSlug)
    setSaving(true)
    setError(null)
    try {
      await onSave({
        credentialSource: vault ? 'vault' : 'native',
        ...(vault ? { credentialSlug: config.launchCredentialSlug } : {}),
        model: config.launchModel ?? null,
        reasoningEffort: config.launchReasoningEffort ?? null,
      })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change AI for this Session</DialogTitle>
          <DialogDescription>
            Choose the access and inference settings {runtimeName} will receive the next time it resumes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-2">
          <AgentLaunchSelectors
            config={config}
            onConfigureProvider={() => config.selectRuntimeDefault()}
            showRuntime={false}
            menuPlacement="down"
            toolbar
            layout="settings"
          />
        </div>

        <div className="flex items-start gap-2 rounded-md bg-muted/45 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            This changes only this paused Session. It stays paused, and the new configuration is applied on the next resume.
          </span>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !config.credentialSelectionReady || !config.effectiveAgent}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
