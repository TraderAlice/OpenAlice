import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'

export function browserAddress(value: string): string {
  const text = value.trim()
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) && !/^[\w.-]+:\d+(?:[/?#]|$)/.test(text) ? text : `https://${text}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid address')
  return url.href
}

/** Shared web-page presentation. Studio supplies a managed entry URL; ordinary
 * tabs accept a user URL. Host browser frame restrictions remain authoritative. */
export function BrowserPane({ initialUrl = null, title, generation = 0, pending, actions, notice, onNavigate }: {
  initialUrl?: string | null
  title: string
  generation?: string | number
  pending?: ReactNode
  actions?: ReactNode
  notice?: ReactNode
  onNavigate?: (url: string) => void
}) {
  const { t } = useTranslation()
  const [history, setHistory] = useState<string[]>(initialUrl ? [initialUrl] : [])
  const [index, setIndex] = useState(initialUrl ? 0 : -1)
  const [draft, setDraft] = useState(initialUrl ?? '')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState(false)
  const url = history[index] ?? null
  useEffect(() => {
    if (!initialUrl) return
    setHistory([initialUrl]); setIndex(0); setDraft(initialUrl); setError(false)
  }, [initialUrl, generation])
  const go = (next: number) => { setIndex(next); setDraft(history[next] ?? ''); setError(false) }
  return <div className="harness-browser">
    <div className="harness-browser-toolbar">
      <Button variant="ghost" size="icon" disabled={index <= 0} onClick={() => go(index - 1)} aria-label={t('workbench.back')}><ArrowLeft size={15} /></Button>
      <Button variant="ghost" size="icon" disabled={index >= history.length - 1} onClick={() => go(index + 1)} aria-label={t('workbench.forward')}><ArrowRight size={15} /></Button>
      <Button variant="ghost" size="icon" disabled={!url} onClick={() => setRevision((v) => v + 1)} aria-label={t('harnessSurface.refresh')}><RotateCw size={14} /></Button>
      <form className="harness-address" onSubmit={(event) => {
        event.preventDefault()
        try {
          const next = browserAddress(draft)
          setHistory([...history.slice(0, index + 1), next]); setIndex(index + 1); setDraft(next); setError(false); onNavigate?.(next)
        } catch { setError(true) }
      }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={t('workbench.address')} aria-invalid={error} placeholder={t('workbench.address')} spellCheck={false} autoComplete="off" />
      </form>
      {actions}
      <Button variant="ghost" size="icon" disabled={!url} onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')} aria-label={t('harnessSurface.openSeparate')}><ExternalLink size={14} /></Button>
    </div>
    {notice}
    {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{t('workbench.invalidAddress')}</p>}
    <div className="relative min-h-0 flex-1">
      {pending && !initialUrl ? pending : url ? <iframe
        key={`${generation}-${revision}`} src={url} title={title}
        className="h-full w-full border-0 bg-background"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="clipboard-read; clipboard-write" referrerPolicy="no-referrer"
      /> : <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <Globe size={28} strokeWidth={1.5} /><h2 className="text-sm font-medium text-foreground">{t('workbench.startBrowsing')}</h2><p className="text-xs">{t('workbench.enterAddress')}</p>
      </div>}
    </div>
  </div>
}
