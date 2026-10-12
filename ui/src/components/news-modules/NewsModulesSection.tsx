import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { ConfirmDialog } from '../ConfirmDialog'
import { ConfigSection, Field, inputClass } from '../form'
import { Toggle } from '../Toggle'
import { Button } from '../ui/button'

type Selection = { moduleId: string; contentHash: string; enabled: boolean }
type Subscription = {
  id: string; moduleId: string; sourceKey: string; name: string; source: string
  enabled: boolean; params: Record<string, string | number | boolean>; categories: string[]
}
type Parameter = { key: string; label: string; type: 'string' | 'number' | 'boolean'; required: boolean }
type Source = { key: string; name: string; parameters: Parameter[] }
type ModuleStatus = {
  moduleId: string | null; manifest: { moduleId: string; version: string; name: string; description: string; entry: string; sources: Source[] } | null
  contentHash: string; installed: boolean; approved: boolean; desiredEnabled: boolean; loaded: boolean
  loadedHash: string | null; state: 'disabled' | 'running' | 'failed' | 'unapproved' | 'missing' | 'invalid'; lastError: string | null
}
type KeyStatus = { configured: boolean; available: boolean; baseUrl: string | null }

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export function RssHubKeySection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let active = true
    void api.news.getRssHubKeyStatus().then(value => { if (active) { setStatus(value); setError(null) } })
      .catch((cause: unknown) => { if (active) setError(errorText(cause)) })
    return () => { active = false }
  }, [refreshKey])
  const update = async (operation: 'set' | 'clear') => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.news.updateRssHubKey(operation, operation === 'set' ? key : undefined)
      setStatus(result)
      setKey('')
      setConfirmClear(false)
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }
  return <ConfigSection title={t('newsModules.rssHubKey')} description={t('newsModules.rssHubKeyDescription')}>
    {status && <p className="mb-3 text-[12px] text-muted-foreground" role="status">
      {status.available ? status.configured ? t('newsModules.keyConfigured', { baseUrl: status.baseUrl ?? '' }) : t('newsModules.keyMissing') : t('newsModules.keyUnavailable')}
    </p>}
    <form onSubmit={event => { event.preventDefault(); if (key.trim()) void update('set') }}>
      <Field label={t('newsModules.keyInput')} controlId="news-rsshub-secret">
        <input id="news-rsshub-secret" type="password" autoComplete="off" className={inputClass} value={key} onChange={event => setKey(event.target.value)} maxLength={4096} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={busy || !key.trim()}>{t('newsModules.keySet')}</Button>
        <Button type="button" variant="outline" disabled={busy || !status?.configured} onClick={() => setConfirmClear(true)}>{t('newsModules.keyClear')}</Button>
        {error && <Button type="button" variant="outline" onClick={() => setRefreshKey(value => value + 1)}>{t('newsModules.retry')}</Button>}
      </div>
    </form>
    {error && <p role="alert" className="mt-2 text-[12px] text-destructive">{error}</p>}
    {confirmClear && <ConfirmDialog title={t('newsModules.keyClearTitle')} message={t('newsModules.keyClearWarning')} confirmLabel={t('newsModules.keyClear')} onConfirm={() => update('clear')} onClose={() => setConfirmClear(false)} />}
  </ConfigSection>
}

function SubscriptionEditor({ initial, modules, selections, onSave, onCancel }: {
  initial?: Subscription; modules: ModuleStatus[]; selections: Selection[]
  onSave: (row: Subscription) => void; onCancel: () => void
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const selectedModules = modules.filter(module => module.manifest && module.approved && selections.some(selection => selection.moduleId === module.moduleId && selection.contentHash === module.contentHash))
  const initialModule = selectedModules.find(module => module.moduleId === initial?.moduleId) ?? selectedModules[0]
  const [moduleId, setModuleId] = useState(initial?.moduleId ?? initialModule?.moduleId ?? '')
  const [sourceKey, setSourceKey] = useState(initial?.sourceKey ?? initialModule?.manifest?.sources[0]?.key ?? '')
  const [name, setName] = useState(initial?.name ?? initialModule?.manifest?.sources[0]?.name ?? '')
  const [source, setSource] = useState(initial?.source ?? initialModule?.manifest?.sources[0]?.name ?? '')
  const [categories, setCategories] = useState(initial?.categories.join(', ') ?? '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [params, setParams] = useState<Subscription['params']>(initial?.params ?? {})
  const [validationError, setValidationError] = useState<string | null>(null)
  const manifest = selectedModules.find(module => module.moduleId === moduleId)?.manifest
  const definition = manifest?.sources.find(item => item.key === sourceKey)
  const changeModule = (next: string) => {
    const first = selectedModules.find(module => module.moduleId === next)?.manifest?.sources[0]
    setModuleId(next); setSourceKey(first?.key ?? ''); setName(first?.name ?? ''); setSource(first?.name ?? ''); setParams({})
  }
  const changeSource = (next: string) => {
    const item = manifest?.sources.find(entry => entry.key === next)
    setSourceKey(next); setName(item?.name ?? ''); setSource(item?.name ?? ''); setParams({})
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!definition || !name.trim() || !source.trim()) return
    const parsedCategories = categories.split(',').map(category => category.trim()).filter(Boolean)
    if (parsedCategories.length > 32 || parsedCategories.some(category => category.length > 80)) {
      setValidationError(t('newsModules.categoriesInvalid')); return
    }
    setValidationError(null)
    const typed: Subscription['params'] = {}
    for (const parameter of definition.parameters) {
      const value = params[parameter.key]
      if (parameter.type === 'boolean') { typed[parameter.key] = Boolean(value) }
      else if (value !== undefined && String(value).trim() !== '') {
        const parsed = parameter.type === 'number' ? Number(value) : String(value)
        if (typeof parsed === 'number' && !Number.isFinite(parsed)) return
        typed[parameter.key] = parsed
      } else if (parameter.required) return
    }
    onSave({ id: initial?.id ?? crypto.randomUUID(), moduleId, sourceKey, name: name.trim(), source: source.trim(), enabled,
      params: typed, categories: parsedCategories })
  }
  return <form className="space-y-2 rounded-lg border border-border/60 p-3" onSubmit={submit}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('newsModules.module')} controlId={prefix + '-module'}>
        <select id={prefix + '-module'} className={inputClass} value={moduleId} onChange={event => changeModule(event.target.value)} required>
          {selectedModules.filter((module, index) => selectedModules.findIndex(entry => entry.moduleId === module.moduleId) === index)
            .map(module => <option key={module.moduleId!} value={module.moduleId!}>{module.manifest!.name}</option>)}
        </select>
      </Field>
      <Field label={t('newsModules.sourceKey')} controlId={prefix + '-key'}>
        <select id={prefix + '-key'} className={inputClass} value={sourceKey} onChange={event => changeSource(event.target.value)} required>
          {manifest?.sources.map(item => <option key={item.key} value={item.key}>{item.name} ({item.key})</option>)}
        </select>
      </Field>
      <Field label={t('newsModules.subscriptionName')} controlId={prefix + '-name'}>
        <input id={prefix + '-name'} className={inputClass} value={name} maxLength={200} required onChange={event => setName(event.target.value)} />
      </Field>
      <Field label={t('newsModules.sourceLabel')} controlId={prefix + '-source'}>
        <input id={prefix + '-source'} className={inputClass} value={source} maxLength={128} required onChange={event => setSource(event.target.value)} />
      </Field>
    </div>
    {definition?.parameters.map(parameter => <Field key={parameter.key} label={parameter.label + (parameter.required ? ' *' : '')} controlId={prefix + '-' + parameter.key}>
      {parameter.type === 'boolean'
        ? <input id={prefix + '-' + parameter.key} type="checkbox" checked={Boolean(params[parameter.key])} onChange={event => setParams(previous => ({ ...previous, [parameter.key]: event.target.checked }))} />
        : <input id={prefix + '-' + parameter.key} className={inputClass} type={parameter.type === 'number' ? 'number' : 'text'} step={parameter.type === 'number' ? 'any' : undefined} required={parameter.required} maxLength={parameter.type === 'string' ? 4096 : undefined} value={params[parameter.key] === undefined ? '' : String(params[parameter.key])} onChange={event => setParams(previous => ({ ...previous, [parameter.key]: event.target.value }))} />}
    </Field>)}
    <Field label={t('newsModules.categories')} description={t('newsModules.categoriesHint')} controlId={prefix + '-categories'}>
      <input id={prefix + '-categories'} className={inputClass} value={categories} onChange={event => setCategories(event.target.value)} />
    {validationError && <p role="alert" className="text-[12px] text-destructive">{validationError}</p>}
    </Field>
    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{t('newsModules.subscriptionEnabled')}</label>
    <div className="flex gap-2"><Button type="submit" variant="outline" disabled={!definition}>{t('newsModules.save')}</Button><Button type="button" variant="ghost" onClick={onCancel}>{t('newsModules.cancel')}</Button></div>
  </form>
}

export function NewsModulesSection({ selections, subscriptions, onSelectionsChange, onSubscriptionsChange, collectorEnabled, saveStatus }: {
  selections: Selection[]; subscriptions: Subscription[]; onSelectionsChange: (next: Selection[]) => void
  onSubscriptionsChange: (next: Subscription[]) => void; collectorEnabled: boolean; saveStatus: 'idle' | 'saving' | 'saved' | 'error'
}) {
  const { t } = useTranslation()
  const [modules, setModules] = useState<ModuleStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingApprove, setPendingApprove] = useState<ModuleStatus | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<ModuleStatus | null>(null)
  const [pendingRemove, setPendingRemove] = useState<Subscription | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [approvalInput, setApprovalInput] = useState('')
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [pendingSelectionSave, setPendingSelectionSave] = useState(false)
  const [sawSelectionSave, setSawSelectionSave] = useState(false)
  useEffect(() => {
    if (!pendingSelectionSave) return
    if (saveStatus === 'saving') setSawSelectionSave(true)
    if (saveStatus === 'saved' && sawSelectionSave) { setPendingSelectionSave(false); setSawSelectionSave(false) }
  }, [saveStatus, pendingSelectionSave, sawSelectionSave])
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const result = await api.news.getModules()
        if (active) { setModules(result.modules); setError(null) }
      } catch (cause) { if (active) setError(errorText(cause)) }
      finally { if (active) setLoading(false) }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [refreshKey])
  const refresh = () => setRefreshKey(value => value + 1)
  const act = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true); setError(null)
    try { await action(); refresh(); return true }
    catch (cause) { setError(errorText(cause)); return false }
    finally { setBusy(false) }
  }
  const importFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('artifact') as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) return
    await act(async () => {
      const artifact = JSON.parse(await file.text()) as Parameters<typeof api.news.importModule>[0]
      await api.news.importModule(artifact)
      if (input) input.value = ''
    })
  }
  const ids = [...new Set([...modules.map(module => module.moduleId).filter((id): id is string => id !== null), ...selections.map(item => item.moduleId)])]
  const selectionFor = (id: string) => selections.find(item => item.moduleId === id)
  const selectVersion = (moduleId: string, contentHash: string) => {
    const other = selections.filter(item => item.moduleId !== moduleId)
    setPendingSelectionSave(true)
    onSelectionsChange(contentHash ? [...other, { moduleId, contentHash, enabled: false }] : other)
  }
  return <ConfigSection title={t('newsModules.title')} description={t('newsModules.description')}>
    <form onSubmit={event => { void importFile(event) }} className="mb-4 flex flex-wrap items-end gap-2">
      <Field label={t('newsModules.artifact')} controlId="news-module-artifact" description={t('newsModules.artifactHint')}>
        <input id="news-module-artifact" name="artifact" type="file" accept=".json,application/json" required className={inputClass} />
      </Field>
      <Button type="submit" variant="outline" disabled={busy}>{t('newsModules.import')}</Button>
    </form>
    {error && <div role="alert" className="mb-3 text-[12px] text-destructive">{error} <Button type="button" variant="outline" size="sm" onClick={refresh}>{t('newsModules.retry')}</Button></div>}
    {loading && <p role="status" className="text-[12px] text-muted-foreground">{t('newsModules.loading')}</p>}
    {!loading && modules.length === 0 && <p className="text-[12px] text-muted-foreground">{t('newsModules.noModules')}</p>}
    <div className="space-y-3">
      {ids.map(id => {
        const versions = modules.filter(module => module.moduleId === id)
        const selected = selectionFor(id)
        const active = versions.find(module => module.contentHash === selected?.contentHash)
        const label = versions.find(module => module.manifest)?.manifest?.name ?? id
        return <div key={id} className="rounded-lg border border-border/60 p-3">
          <h4 className="text-[13px] font-semibold">{label}</h4>
          <p className="break-all text-[11px] text-muted-foreground">{id}</p>
          {versions.find(module => module.manifest)?.manifest?.description && <p className="mt-1 text-[12px] text-muted-foreground">{versions.find(module => module.manifest)?.manifest?.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-[12px]" htmlFor={'module-version-' + id}>{t('newsModules.version')}</label>
            <select id={'module-version-' + id} className={inputClass + ' max-w-sm'} value={selected?.contentHash ?? ''} disabled={busy} onChange={event => selectVersion(id, event.target.value)}>
              <option value="">{t('newsModules.noSelection')}</option>
              {versions.map(module => <option key={module.contentHash} value={module.contentHash}>{module.manifest?.version ?? t('newsModules.versionMissing')} · {module.contentHash.slice(0, 12)}</option>)}
            </select>
            <Toggle ariaLabel={t('newsModules.enableModule', { name: label })} size="sm" checked={selected?.enabled ?? false} disabled={!selected || (Boolean(!active?.approved) && !selected?.enabled)} onChange={enabled => { if (selected) onSelectionsChange(selections.map(item => item.moduleId === id ? { ...item, enabled } : item)) }} />
          </div>
          {selected && !active?.installed && <p role="status" className="mt-2 text-[12px] text-muted-foreground">{t('newsModules.versionMissing')}</p>}
          {versions.map(module => <div key={module.contentHash} className="mt-3 rounded border border-border/50 p-2 text-[12px]">
            <p>{t('newsModules.version')} {module.manifest?.version ?? t('newsModules.versionMissing')} · {t('newsModules.state.' + module.state, { defaultValue: module.state })}</p>
            <p className="break-all font-mono text-[11px]">{t('newsModules.hash')}: {module.contentHash}</p>
            {module.manifest && <details className="mt-1"><summary className="cursor-pointer">{t('newsModules.manifest')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(module.manifest, null, 2)}</pre></details>}
            <p>{t('newsModules.approved')}: {module.approved ? t('newsModules.yes') : t('newsModules.no')} · {t('newsModules.desired')}: {module.desiredEnabled ? t('newsModules.yes') : t('newsModules.no')} · {t('newsModules.loaded')}: {module.loaded ? t('newsModules.yes') : t('newsModules.no')}</p>
            <p className="break-all">{t('newsModules.loadedHash')}: {module.loadedHash ?? '—'}</p>
            {module.lastError && <p role="alert" className="text-destructive">{module.lastError}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {module.installed && module.manifest && !module.approved && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setApprovalInput(''); setApprovalError(null); setPendingApprove(module) }}>{t('newsModules.approve')}</Button>}
              {module.state === 'failed' && module.desiredEnabled && module.installed && <Button type="button" size="sm" variant="outline" disabled={busy || !collectorEnabled} onClick={() => void act(() => api.news.retryModule(module.contentHash))}>{t('newsModules.retryModule')}</Button>}
              {module.installed && <Button type="button" size="sm" variant="outline" disabled={busy || pendingSelectionSave || Boolean(selected?.contentHash === module.contentHash) || saveStatus === 'saving' || saveStatus === 'error'} onClick={() => setPendingUninstall(module)}>{t('newsModules.uninstall')}</Button>}
            </div>
          </div>)}
          {selected?.contentHash && <p className="mt-2 text-[11px] text-muted-foreground">{t('newsModules.deselectBeforeUninstall')}</p>}
        </div>
      })}
    </div>
    <div className="mt-5 border-t border-border/60 pt-4">
      <h4 className="mb-1 text-[13px] font-semibold">{t('newsModules.subscriptions')}</h4>
      <p className="mb-3 text-[12px] text-muted-foreground">{t('newsModules.subscriptionDescription')}</p>
      {subscriptions.map(row => {
        const installed = selections.some(selection => selection.moduleId === row.moduleId && modules.some(module => module.manifest?.moduleId === row.moduleId && module.contentHash === selection.contentHash && module.installed))
        const editable = modules.some(module => module.manifest?.moduleId === row.moduleId && module.approved && selections.some(selection => selection.moduleId === row.moduleId && selection.contentHash === module.contentHash))
        return <div key={row.id} className="mb-2 rounded-lg border border-border/60 p-3 text-[12px]">
          <div className="flex flex-wrap items-center gap-2"><strong>{row.name}</strong><span>{row.moduleId} / {row.sourceKey}</span>{!installed && <span role="status">{t('newsModules.archived')}</span>}</div>
          <p className="text-muted-foreground">{row.source} · {row.categories.join(', ') || '—'} · {row.enabled ? t('newsModules.enabled') : t('newsModules.disabled')}</p>
          <div className="mt-2 flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!editable} onClick={() => setEditing(row.id)}>{t('newsModules.edit')}</Button><Button type="button" size="sm" variant="outline" onClick={() => setPendingRemove(row)}>{t('newsModules.remove')}</Button></div>
          {editing === row.id && <div className="mt-2"><SubscriptionEditor initial={row} modules={modules} selections={selections} onSave={next => { onSubscriptionsChange(subscriptions.map(item => item.id === row.id ? next : item)); setEditing(null) }} onCancel={() => setEditing(null)} /></div>}
        </div>
      })}
      {editing === 'new' ? <SubscriptionEditor modules={modules} selections={selections} onSave={next => { onSubscriptionsChange([...subscriptions, next]); setEditing(null) }} onCancel={() => setEditing(null)} />
        : <Button type="button" variant="outline" disabled={!modules.some(module => module.manifest && module.approved && selections.some(selection => selection.moduleId === module.moduleId && selection.contentHash === module.contentHash))} onClick={() => setEditing('new')}>{t('newsModules.addSubscription')}</Button>}
    </div>
    {pendingApprove && <ConfirmDialog title={t('newsModules.approveTitle')} message={<div className="space-y-2"><p>{t('newsModules.trustWarning')}</p><pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(pendingApprove.manifest, null, 2)}</pre><p className="break-all font-mono">{pendingApprove.contentHash}</p><label className="block" htmlFor="news-approval-hash">{t('newsModules.approvalPrompt')}</label><input id="news-approval-hash" className={inputClass} spellCheck={false} autoComplete="off" value={approvalInput} onChange={event => { setApprovalInput(event.target.value); setApprovalError(null) }} />{approvalError && <p role="alert" className="text-destructive">{approvalError}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}</div>} confirmLabel={t('newsModules.approveHash')} variant="primary" onConfirm={async () => { if (approvalInput !== pendingApprove.contentHash) { setApprovalError(t('newsModules.approvalMismatch')); return } if (await act(() => api.news.approveModule(pendingApprove.contentHash))) { setPendingApprove(null); setApprovalInput('') } }} onClose={() => { setPendingApprove(null); setApprovalInput(''); setApprovalError(null) }} />
    }
    {pendingUninstall && <ConfirmDialog title={t('newsModules.uninstallTitle')} message={<div className="space-y-2"><p>{t('newsModules.uninstallWarning')}</p><p className="break-all font-mono">{pendingUninstall.contentHash}</p>{error && <p role="alert" className="text-destructive">{error}</p>}</div>} confirmLabel={t('newsModules.uninstall')} onConfirm={async () => { if (await act(() => api.news.uninstallModule(pendingUninstall.contentHash))) setPendingUninstall(null) }} onClose={() => setPendingUninstall(null)} />}
    {pendingRemove && <ConfirmDialog title={t('newsModules.removeTitle')} message={t('newsModules.removeWarning', { name: pendingRemove.name })} confirmLabel={t('newsModules.remove')} onConfirm={() => { onSubscriptionsChange(subscriptions.filter(item => item.id !== pendingRemove.id)); setPendingRemove(null) }} onClose={() => setPendingRemove(null)} />}
  </ConfigSection>
}
