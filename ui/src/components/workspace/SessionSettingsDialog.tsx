import { useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { pinnedLaunchFromBinding, usePinnedRuntimeDraft } from '../../hooks/usePinnedRuntimeDraft'
import { AgentLaunchSelectors } from './AgentLaunchControls'
import { sessionCoworkerLabel } from './display'
import type {
  AgentInfo,
  PausedSessionRuntimeUpdate,
  SessionRecord,
} from './api'

const DISPLAY_NAME_MAX = 120

const inputClass =
  'w-full bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary'

export interface SessionSettingsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: SessionRecord
  readonly agents: readonly AgentInfo[]
  readonly workspaceId: string
  /** Persist coworker nametag. Empty string / null clears the field. */
  readonly onSaveDisplayName: (displayName: string | null) => Promise<void>
  /**
   * Replace the paused Session AI binding. Omit for shell / read-only AI.
   * Must only be invoked when the Session is paused.
   */
  readonly onSaveRuntime?: (update: PausedSessionRuntimeUpdate) => Promise<void>
  /** Optional pause action when AI is locked because the Session is running. */
  readonly onPause?: () => void
}

function normalizeDisplayName(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, DISPLAY_NAME_MAX) : null
}

/**
 * Session Settings: coworker nametag (anytime) plus credential/model/effort
 * when the Session is paused. Picker drafts stay local until Save; Save never
 * rewrites Workspace recent preferences or wakes the Session.
 */
export function SessionSettingsDialog({
  open,
  onOpenChange,
  record,
  agents,
  workspaceId,
  onSaveDisplayName,
  onSaveRuntime,
  onPause,
}: SessionSettingsDialogProps) {
  const { t } = useTranslation()
  const initialLaunch = useMemo(
    () => pinnedLaunchFromBinding(record.agent, record.runtime),
    [record.agent, record.runtime],
  )
  const initialDisplayName = record.displayName ?? ''
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const paused = record.state === 'paused'
  const supportsAi = record.agent !== 'shell' && Boolean(onSaveRuntime)
  const aiEditable = supportsAi && paused
  const editor = usePinnedRuntimeDraft({
    workspaceId,
    agent: record.agent,
    agents,
    initial: initialLaunch,
    active: open,
  })
  const config = editor.config

  useEffect(() => {
    if (!open) return
    setDisplayName(initialDisplayName)
    setError(null)
  }, [initialDisplayName, open])

  const runtimeName = config.selectedAgent?.displayName ?? record.agent
  const coworkerLabel = sessionCoworkerLabel(record)

  const nextDisplayName = normalizeDisplayName(displayName)
  const currentDisplayName = normalizeDisplayName(initialDisplayName)
  const displayNameDirty = nextDisplayName !== currentDisplayName
  const canSaveAi = aiEditable && editor.dirty && config.credentialSelectionReady && Boolean(config.effectiveAgent)
  const canSave = !saving && (displayNameDirty || canSaveAi)

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (displayNameDirty) {
        await onSaveDisplayName(nextDisplayName)
      }
      if (canSaveAi && onSaveRuntime) {
        await onSaveRuntime(editor.toRuntimeUpdate())
      }
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
          <DialogTitle>{t('workspace.sessionSettings.title')}</DialogTitle>
          <DialogDescription>
            {t('workspace.sessionSettings.description', { name: coworkerLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted-foreground"
              htmlFor="session-settings-display-name"
            >
              {t('workspace.sessionSettings.displayName')}
            </label>
            <input
              id="session-settings-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, DISPLAY_NAME_MAX))}
              maxLength={DISPLAY_NAME_MAX}
              placeholder={record.title?.trim() || record.name}
              className={inputClass}
              disabled={saving}
            />
            <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-muted-foreground/70">
              <span>{t('workspace.sessionSettings.displayNameHelp')}</span>
              <span className="tabular-nums">{displayName.trim().length}/{DISPLAY_NAME_MAX}</span>
            </div>
          </div>

          {supportsAi && (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="text-xs font-medium text-muted-foreground">
                {t('workspace.sessionSettings.aiSection', { runtime: runtimeName })}
              </div>
              <fieldset disabled={!aiEditable || saving} className="min-w-0 disabled:opacity-60">
                <AgentLaunchSelectors
                  config={config}
                  onConfigureProvider={() => config.selectRuntimeDefault()}
                  showRuntime={false}
                  menuPlacement="down"
                  toolbar
                  layout="settings"
                />
              </fieldset>
              <div className="flex items-start gap-2 rounded-md bg-muted/45 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {aiEditable
                    ? t('workspace.sessionSettings.aiPausedHint')
                    : t('workspace.sessionSettings.pauseRequired')}
                </span>
                {!aiEditable && onPause && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={onPause}
                    disabled={saving}
                  >
                    {t('workspace.sessionSettings.pauseAction')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canSave}
          >
            {saving ? t('workspace.sessionSettings.saving') : t('workspace.sessionSettings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
