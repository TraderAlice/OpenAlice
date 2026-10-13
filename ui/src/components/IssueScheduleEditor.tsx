import { useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { scheduleValidationError } from '../../../src/core/schedule-expr'
import { ISSUE_TIMEOUTS, type IssueDetailIssue, type IssuePatch, type IssueTimeout } from '../api/issues'
import type { ScheduleWhen } from '../api/schedule'
import { inputClass } from './form'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Select } from './ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

type Draft = {
  kind: ScheduleWhen['kind']
  every: string
  cron: string
  at: string
  timezone?: string
  catchUp?: boolean
  timeout: IssueTimeout | ''
}
function draftFrom(issue: IssueDetailIssue): Draft {
  const when = issue.when!
  return {
    kind: when.kind,
    every: when.kind === 'every' ? when.every : '',
    cron: when.kind === 'cron' ? when.cron : '',
    at: when.kind === 'at' ? when.at : '',
    timezone: when.kind === 'cron' ? when.timezone : undefined,
    catchUp: when.kind === 'cron' ? when.catchUp : undefined,
    timeout: issue.timeout ?? '',
  }
}
function whenFrom(draft: Draft): ScheduleWhen {
  switch (draft.kind) {
    case 'every': return { kind: 'every', every: draft.every.trim() }
    case 'at': return { kind: 'at', at: draft.at.trim() }
    case 'cron': return {
      kind: 'cron', cron: draft.cron.trim(),
      ...(draft.timezone === undefined ? {} : { timezone: draft.timezone.trim() }),
      ...(draft.catchUp === undefined ? {} : { catchUp: draft.catchUp }),
    }
  }
}
const signature = (issue: IssueDetailIssue) => JSON.stringify([issue.when, issue.timeout ?? ''])

/** Owns only a transient draft. PATCH response, file mutation and scanner own truth. */
export function IssueScheduleEditor({ issue, saving, onPatch, children }: {
  issue: IssueDetailIssue
  saving: boolean
  onPatch: (patch: IssuePatch) => Promise<boolean>
  children: ReactNode
}) {
  const { t } = useTranslation()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const selectedType = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [base, setBase] = useState('')
  const [original, setOriginal] = useState<Draft | null>(null)
  const [discard, setDiscard] = useState(false)
  const [failed, setFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const busy = saving || submitting
  const when = draft ? whenFrom(draft) : undefined
  const error = when ? scheduleValidationError(when) : null
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(original)
  const changedWhen = when && original && JSON.stringify(when) !== JSON.stringify(whenFrom(original))
  const changed = changedWhen || (draft && original && draft.timeout !== original.timeout)
  const stale = open && base !== signature(issue)
  const reset = () => {
    const next = draftFrom(issue)
    setDraft(next)
    setOriginal(next)
    setBase(signature(issue))
    setFailed(false)
    setDiscard(false)
  }
  const edit = (patch: Partial<Draft>) => {
    setDraft((prev) => prev ? { ...prev, ...patch } : prev)
    setFailed(false)
  }
  const close = () => { setOpen(false); setDiscard(false) }
  const save = async () => {
    if (busy || stale || error || !changed || !draft || !when) return
    setSubmitting(true)
    setFailed(false)
    try {
      const patch: IssuePatch = {
        ...(changedWhen ? { when } : {}),
        ...(draft.timeout !== original?.timeout ? { timeout: draft.timeout || null } : {}),
      }
      if (await onPatch(patch)) close()
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }
  if (!issue.when) return null
  if (issue.connectorDesk) return <div className="space-y-2 text-xs">{children}<p className="text-muted-foreground">{t('issues.detail.scheduleEditor.connector')}</p></div>
  const fieldError = error && error !== 'invalid_timezone'
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (busy) return
      if (!next && discard) { setDiscard(false); return }
      if (!next && dirty) { setDiscard(true); return }
      setOpen(next)
    }}>
      <Button ref={trigger} type="button" variant="ghost" size="sm" disabled={saving}
        onClick={() => { reset(); setOpen(true) }} aria-label={t('issues.detail.editSchedule')}
        className="h-auto w-full justify-start px-2 py-2 text-left">
        {children}<ChevronRight size={13} className="ml-auto shrink-0 text-muted-foreground" aria-hidden />
      </Button>
      <DialogContent initialFocus={selectedType} finalFocus={trigger} showCloseButton={!busy}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(discard ? 'issues.detail.scheduleEditor.discardTitle' : 'issues.detail.scheduleSettings')}</DialogTitle>
          <DialogDescription>{t(discard ? 'issues.detail.scheduleEditor.discardHint' : 'issues.detail.scheduleSettingsDescription')}</DialogDescription>
        </DialogHeader>
        {discard ? <DialogFooter>
          <Button variant="outline" onClick={() => setDiscard(false)}>{t('issues.detail.scheduleEditor.keepEditing')}</Button>
          <Button onClick={close}>{t('issues.detail.scheduleEditor.discard')}</Button>
        </DialogFooter> : draft && <form className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-0.5">
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <legend className="mb-2 font-medium">{t('issues.detail.scheduleEditor.cadence')}</legend>
              <div className="flex rounded-lg border border-border bg-muted/20 p-1">
                {(['every', 'cron', 'at'] as const).map((kind) => <label key={kind} className={`relative flex min-h-9 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md px-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring ${draft.kind === kind ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>
                  <input ref={draft.kind === kind ? selectedType : undefined} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="radio" name={`${id}-kind`} value={kind} checked={draft.kind === kind} onChange={() => edit({ kind })} />
                  {t(`issues.detail.scheduleEditor.${kind}`)}
                </label>)}
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">{t(`issues.detail.scheduleEditor.${draft.kind}Label`)}</span>
                <input className={inputClass} value={draft[draft.kind]} spellCheck={false}
                  aria-invalid={Boolean(fieldError)} aria-describedby={`${id}-hint${fieldError ? ` ${id}-error` : ''}`}
                  onChange={(event) => edit({ [draft.kind]: event.target.value })} />
              </label>
              <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">{t(`issues.detail.scheduleEditor.${draft.kind}Hint`)}</p>
              {draft.kind === 'at' && !error && <p className="text-xs text-muted-foreground"><time dateTime={draft.at.trim()}>{new Date(draft.at.trim()).toISOString()}</time> · UTC</p>}
              {draft.kind === 'cron' && <>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium">{t('issues.detail.scheduleEditor.timezone')}</span>
                  <input className={inputClass} list={`${id}-zones`} value={draft.timezone ?? ''} placeholder="local" spellCheck={false}
                    aria-invalid={error === 'invalid_timezone'} aria-describedby={`${id}-zone-hint${error === 'invalid_timezone' ? ` ${id}-error` : ''}`}
                    onChange={(event) => edit({ timezone: event.target.value || undefined })} />
                  <datalist id={`${id}-zones`}><option value="local" /><option value="America/Los_Angeles" /><option value="America/New_York" /><option value="UTC" /></datalist>
                </label>
                <p id={`${id}-zone-hint`} className="text-xs leading-relaxed text-muted-foreground">{t('issues.detail.scheduleEditor.timezoneHint')}</p>
                <label className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <Checkbox disabled={busy} checked={draft.catchUp !== false} onChange={(event) => edit({ catchUp: event.target.checked })} />
                  <span><span className="block text-sm font-medium">{t('issues.detail.catchUp')}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t('issues.detail.catchUpDescription')}</span></span>
                </label>
              </>}
              {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{t(`issues.detail.scheduleEditor.${error}`)}</p>}
            </fieldset>
            <fieldset disabled={busy} className="min-w-0 border-t border-border pt-4">
              <legend className="sr-only">{t('issues.detail.scheduleEditor.limits')}</legend>
              <h3 className="mb-3 font-medium">{t('issues.detail.scheduleEditor.limits')}</h3>
              <label className="block space-y-1.5"><span className="text-xs font-medium">{t('issues.detail.timeout')}</span>
                <Select type="button" disabled={busy} value={draft.timeout} aria-label={t('issues.detail.timeout')}
                  onValueChange={(timeout) => edit({ timeout: timeout as Draft['timeout'] })}
                  options={[{ value: '', label: t('issues.detail.timeoutNone') }, ...ISSUE_TIMEOUTS.map((value) => ({ value, label: value }))]} />
              </label>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('issues.detail.scheduleEditor.timeoutHint')}</p>
            </fieldset>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('issues.detail.scheduleEditor.applies')}</p>
            {stale && <div role="alert" className="space-y-2 text-xs"><p>{t('issues.detail.scheduleEditor.stale')}</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={reset}>{t('issues.detail.scheduleEditor.reload')}</Button></div>}
            {failed && <p role="alert" className="text-xs text-destructive">{t('issues.detail.scheduleEditor.failed')}</p>}
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 rounded-none border-t border-border pt-3">
            <Button type="button" variant="outline" disabled={busy} onClick={close}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={busy || Boolean(error) || stale || !changed}>{t(busy ? 'common.saving' : 'issues.detail.scheduleEditor.save')}</Button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  )
}
