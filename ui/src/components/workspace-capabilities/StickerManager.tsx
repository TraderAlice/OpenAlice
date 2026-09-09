import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, RefreshCw } from 'lucide-react'
import { useStickerPacks, stickerImage, type StickerPreview, type StickerWorkspace } from '../../hooks/useStickerPacks'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog'
import { inputClass } from '../form'

export function StickerManager({ wsId }: { wsId?: string }) {
  const { t } = useTranslation()
  const state = useStickerPacks()
  const [images, setImages] = useState<File[]>([])
  const [selected, setSelected] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [review, setReview] = useState<{ ws: StickerWorkspace; enabled: boolean; packId: string; plan: StickerPreview } | null>(null)
  const data = state.data
  const pack = data?.packs.find(p => p.id === selected) ?? data?.packs.find(p => p.id === data.defaultPackId) ?? data?.packs[0]
  const workspaces = data?.workspaces.filter(ws => !wsId || ws.id === wsId) ?? []
  const act = async (ws: StickerWorkspace, enabled: boolean, packId: string) => {
    const plan = await state.request<StickerPreview>(`/workspaces/${encodeURIComponent(ws.id)}/preview`, { enabled, packId })
    setReview({ ws, enabled, packId, plan })
  }
  return <section className="space-y-5" aria-label={t('stickers.title')}>
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{t('stickers.title')}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{t('stickers.hint')}</p></div><div className="flex gap-1">
      {!wsId && <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Plus size={14} />{t('stickers.import')}</Button>}
      <Button size="icon" variant="ghost" aria-label={t('harnessSurface.refresh')} disabled={state.busy} onClick={state.refresh}><RefreshCw size={15} /></Button>
    </div></div>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {!data && !state.error && <p role="status">{t('common.loading')}</p>}
    {data && <>
      <div className="flex flex-wrap gap-2">{data.packs.map(item => <button key={item.id} type="button" aria-pressed={pack?.id === item.id} onClick={() => setSelected(item.id)} className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${pack?.id === item.id ? 'border-primary/50 bg-accent' : 'border-border hover:bg-accent/50'}`}>
        <img src={stickerImage(item.id, item.stickers[0].file)} alt="" className="h-12 w-12 object-contain" /><span><span className="block text-sm font-medium">{item.name}</span><span className="text-xs text-muted-foreground">v{item.version} · {item.stickers.length} {data.defaultPackId === item.id ? `· ${t('stickers.default')}` : ''}</span></span>
      </button>)}</div>
      {pack && <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground" title={pack.revision}>{t('stickers.available')} · {pack.revision}</span>{!wsId && data.defaultPackId !== pack.id && <Button size="sm" variant="ghost" disabled={state.busy} onClick={() => void state.request('/default', { packId: pack.id }, 'PUT').then(state.refresh).catch(() => {})}>{t('stickers.makeDefault')}</Button>}</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">{pack.stickers.map(item => <figure key={item.file} className="min-w-0 rounded-lg bg-muted/35 px-2 py-3 text-center"><img loading="lazy" src={stickerImage(pack.id, item.file)} alt={item.description} className="mx-auto h-20 w-20 object-contain" /><figcaption className="mt-2"><span className="block truncate text-xs" title={item.description}>{item.description}</span><code className="block truncate text-[10px] text-muted-foreground" title={`[[sticker/${item.file}]]`}>{item.file}</code></figcaption></figure>)}</div>
      </div>}
      <div className="border-t border-border pt-4"><h3 className="text-sm font-medium">{t('stickers.workspaces')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('stickers.workspaceHint')}</p>
        {!workspaces.length && <p className="py-4 text-sm text-muted-foreground">{t('stickers.empty')}</p>}
        {workspaces.map(ws => <div key={ws.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-4"><div className="min-w-0"><div className="truncate text-sm font-medium">{ws.name}</div><div className="mt-1 text-xs text-muted-foreground">{ws.state && `${data.packs.find(p => p.id === ws.state?.packId)?.name ?? ws.state.packId} · `}{ws.state?.enabled ? ws.skillPresent ? t('stickers.enabled') : t('stickers.missing') : t('stickers.disabled')} · {ws.state?.revision ?? t('stickers.notInstalled')}</div>{ws.changed.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('stickers.changed', { count: ws.changed.length })}</p>}{ws.error && <p role="alert">{ws.error}</p>}</div>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={state.busy || !pack || !!ws.error} onClick={() => pack && void act(ws, true, pack.id).catch(() => {})}>{ws.state?.enabled && ws.state.packId === pack?.id ? t('stickers.restore') : t('stickers.usePack', { name: pack?.name ?? '' })}</Button>{ws.state?.enabled && <Button size="sm" variant="ghost" disabled={state.busy || !!ws.error} onClick={() => void act(ws, false, ws.state!.packId).catch(() => {})}>{t('stickers.disable')}</Button>}</div>
        </div>)}
      </div>
    </>}
    <Dialog open={!!review} onOpenChange={open => { if (!open && !state.busy) setReview(null) }}><DialogContent closeLabel={t('common.close')}><DialogTitle>{t('stickers.review')}</DialogTitle><DialogDescription>{review?.enabled ? t('stickers.reviewEnable') : t('stickers.reviewDisable')}</DialogDescription>
      {review && <><p className="text-sm">{review.ws.name} · {review.plan.revision}</p><div className="max-h-56 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">{review.plan.files.map(path => <div key={path}>{path}</div>)}</div>{review.plan.conflicts.length > 0 && <div role="alert" className="text-sm"><p>{t('stickers.conflicts')}</p>{review.plan.conflicts.map(item => <p key={item.path} className="break-all font-mono text-xs">{item.path}{!item.owned ? ` — ${t('stickers.unowned')}` : ''}</p>)}</div>}
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button disabled={state.busy || review.plan.conflicts.some(item => !item.owned)} onClick={() => void state.request(`/workspaces/${encodeURIComponent(review.ws.id)}/apply`, { enabled: review.enabled, packId: review.packId, digest: review.plan.digest, restore: review.plan.conflicts.length > 0 }).then(() => { setReview(null); state.refresh() }).catch(() => {})}><Check size={14} />{review.plan.conflicts.length ? t('stickers.replaceManaged') : t('stickers.apply')}</Button></>}
    </DialogContent></Dialog>
    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent closeLabel={t('common.close')}><DialogTitle>{t('stickers.import')}</DialogTitle><DialogDescription>{t('stickers.importHint')}</DialogDescription>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void state.request('/import', form).then(() => { setImportOpen(false); state.refresh() }).catch(() => {}) }}>
        <label className="block text-xs">{t('stickers.packName')}<input name="name" className={`${inputClass} mt-1`} required maxLength={80} /></label>
        <label className="block text-xs">{t('stickers.packId')}<input name="id" className={`${inputClass} mt-1`} required pattern="[a-z0-9][a-z0-9-]{0,63}" placeholder="my-stickers" /></label>
        <label className="block text-xs">{t('stickers.version')}<input name="version" className={`${inputClass} mt-1`} required defaultValue="1.0.0" maxLength={40} /></label>
        <input name="files" type="file" accept=".png,.webp,image/png,image/webp" multiple required aria-label={t('stickers.images')} onChange={event => setImages(Array.from(event.target.files ?? []))} className="w-full text-xs" />
        <div className="max-h-48 space-y-2 overflow-auto">{images.map((image, index) => <label key={`${image.name}-${index}`} className="block text-xs"><span className="block truncate">{image.name}</span><input name={`description:${image.name}`} aria-label={image.name} placeholder={t('stickers.meaning')} maxLength={160} className={`${inputClass} mt-1`} /></label>)}</div>
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}<Button type="submit" disabled={state.busy}>{t('stickers.import')}</Button>
      </form>
    </DialogContent></Dialog>
  </section>
}
