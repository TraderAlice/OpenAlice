import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '../uta/Dialog'
import {
  getWorkspaceOffboardingAssessment,
  offboardWorkspace,
  type Workspace,
  type WorkspaceOffboardingAssessment,
} from './api'
import { workspaceDisplayTitle } from './display'

interface WorkspaceOffboardingDialogProps {
  workspace: Workspace
  onOffboarded: () => void
  onClose: () => void
}

/**
 * A Workspace departure is a handoff, not a filesystem delete prompt. This
 * dialog snapshots the work that will travel with the desk and refuses to race
 * an active headless run. The backend rechecks the same guard before moving.
 */
export function WorkspaceOffboardingDialog({
  workspace,
  onOffboarded,
  onClose,
}: WorkspaceOffboardingDialogProps): ReactElement {
  const { t } = useTranslation()
  const [assessment, setAssessment] = useState<WorkspaceOffboardingAssessment | null>(null)
  const [reason, setReason] = useState('Workspace no longer active')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getWorkspaceOffboardingAssessment(workspace.id)
      .then((value) => { if (!cancelled) setAssessment(value) })
      .catch((err) => { if (!cancelled) setError((err as Error).message) })
    return () => { cancelled = true }
  }, [workspace.id])

  const submit = async (): Promise<void> => {
    if (!assessment?.canOffboard || !reason.trim()) return
    setBusy(true)
    setError(null)
    try {
      await offboardWorkspace(workspace.id, {
        reason: reason.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      onOffboarded()
    } catch (err) {
      setError((err as Error).message)
      // The backend may have found a run that started after the preview.
      await getWorkspaceOffboardingAssessment(workspace.id)
        .then(setAssessment)
        .catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onClose={busy ? () => {} : onClose} width="w-[560px]">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-semibold text-text">{t('workspace.offboardTitle')}</h2>
        <p className="mt-1 text-[12px] text-text-muted">
          {t('workspace.offboardDescription', { workspace: workspaceDisplayTitle(workspace) })}
        </p>
      </div>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
        {!assessment && !error && <p className="text-[13px] text-text-muted">{t('workspace.offboardLoading')}</p>}

        {assessment && (
          <>
            {assessment.blockers.length > 0 && (
              <div className="rounded-lg border border-red/30 bg-red/5 px-3 py-2.5 text-[12px] text-red">
                <div className="font-semibold">{t('workspace.offboardBlocked')}</div>
                {assessment.blockers.map((blocker) => <div key={blocker} className="mt-1">{blocker}</div>)}
              </div>
            )}

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted/70">
                {t('workspace.offboardHandoffSnapshot')}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
                <Snapshot label={t('workspace.offboardSessions')} value={assessment.sessionRecords} />
                <Snapshot label={t('workspace.offboardSignatures')} value={assessment.resumeIds.length} />
                <Snapshot label={t('workspace.offboardOpenIssues')} value={assessment.openIssueIds.length} />
                <Snapshot label={t('workspace.offboardScheduledIssues')} value={assessment.scheduledIssueIds.length} />
                <Snapshot label={t('workspace.offboardDirtyFiles')} value={assessment.git?.files.length ?? 0} />
                <Snapshot label={t('workspace.offboardRunning')} value={assessment.runningHeadless.length} />
              </div>
            </div>
          </>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-text">{t('workspace.offboardReason')}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-accent"
            placeholder={t('workspace.offboardReasonPlaceholder')}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-text">{t('workspace.offboardNotes')}</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={busy}
            rows={4}
            className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-accent"
            placeholder={t('workspace.offboardNotesPlaceholder')}
          />
        </label>

        {error && <p className="text-[12px] text-red">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
          {t('createWorkspace.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !assessment?.canOffboard || !reason.trim()}
          className="btn-danger"
        >
          {busy ? t('workspace.offboardWorking') : t('workspace.offboardConfirm')}
        </button>
      </div>
    </Dialog>
  )
}

function Snapshot({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="rounded-lg border border-border/70 bg-bg-secondary/45 px-3 py-2">
      <div className="text-[16px] font-semibold text-text">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-text-muted">{label}</div>
    </div>
  )
}
