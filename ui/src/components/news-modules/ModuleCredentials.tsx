import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type NewsModuleCredential } from '../../api'
import { Button } from '../ui/button'
import { Field, inputClass } from '../form'
import { ConfirmDialog } from '../ConfirmDialog'

export function ModuleCredentials({ hash }: { hash: string }) {
  const { t } = useTranslation()
  const prefix = useId()
  const [credentials, setCredentials] = useState<NewsModuleCredential[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState<NewsModuleCredential | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [invalidKey, setInvalidKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void api.news.getModuleCredentials(hash, controller.signal).then(result => {
      if (!controller.signal.aborted) { setCredentials(result.credentials); setError(null) }
    }).catch(() => { if (!controller.signal.aborted) setError(t('newsModules.credentialsError')) })
    return () => controller.abort()
  }, [hash, refresh, t])
  const update = async (key: string, operation: 'set' | 'clear') => {
    if (busy) return
    setBusy(true); setError(null)
    setMessage(t('common.saving'))
    try {
      const result = await api.news.updateModuleCredential(hash, key, operation, operation === 'set' ? values[key] : undefined)
      setCredentials(result.credentials); setValues(previous => ({ ...previous, [key]: '' })); setClearing(null)
      setMessage(t(operation === 'set' ? 'newsModules.keySaved' : 'newsModules.keyCleared'))
    } catch { setMessage(''); setError(t('newsModules.credentialsError')) }
    finally { setBusy(false) }
  }
  return <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
    <p className="text-xs text-muted-foreground">{t('newsModules.credentialsHint')}</p>
    {credentials.map(credential => <form key={credential.key} noValidate onSubmit={event => {
      event.preventDefault()
      if (busy) return
      if (!values[credential.key]?.trim()) {
        setInvalidKey(credential.key)
        requestAnimationFrame(() => document.getElementById(prefix + credential.key)?.focus())
        return
      }
      setInvalidKey(null)
      void update(credential.key, 'set')
    }}>
      <Field label={credential.label} controlId={prefix + credential.key}>
        <input id={prefix + credential.key} name="credential" className={inputClass} type="password" autoComplete="off" required maxLength={4096} value={values[credential.key] ?? ''} onChange={event => setValues(previous => ({ ...previous, [credential.key]: event.target.value }))} readOnly={busy} aria-invalid={invalidKey === credential.key} aria-describedby={invalidKey === credential.key ? prefix + credential.key + '-error' : undefined} />
        {invalidKey === credential.key && <p id={prefix + credential.key + '-error'} className="text-xs text-destructive">{t('newsModules.keyRequired')}</p>}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t(credential.available ? credential.configured ? 'newsModules.credentialConfigured' : 'newsModules.credentialMissing' : 'newsModules.keyUnavailable')}</span>
        <Button type="submit" size="sm" variant="outline" aria-disabled={busy} className="aria-disabled:opacity-50">{t('newsModules.keySet')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || !credential.configured} onClick={() => setClearing(credential)}>{t('newsModules.keyClear')}</Button>
      </div>
    </form>)}
    <p role="status" className="text-xs text-muted-foreground">{message}</p>
    {error && <p role="alert" className="text-xs text-destructive">{error} <Button type="button" size="sm" variant="ghost" onClick={() => setRefresh(value => value + 1)}>{t('newsModules.retry')}</Button></p>}
    {clearing && <ConfirmDialog title={t('newsModules.credentialClearTitle')} message={t('newsModules.credentialClearWarning', { name: clearing.label })} confirmLabel={t('newsModules.keyClear')} onConfirm={() => update(clearing.key, 'clear')} onClose={() => setClearing(null)} />}
  </div>
}
