import { useEffect, useId, useRef, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CheckCircle2, ChevronRight, CircleAlert, Code2, Copy, File, Folder, Image, Layers, LoaderCircle, Pause, Play, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { MeasuredText } from '@/components/MeasuredText'
import { ConversationImagePreview } from '@/components/conversation/ConversationImagePreview'
import { Skeleton } from '@/components/StateViews'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { inputClass } from '@/components/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { en } from '@/i18n/locales/en'
import { CardStack, CARD_STACK_LAYOUT } from './CardStack'
import { useConfettiBurst } from './useConfettiBurst'
import { useDropInteraction } from './useDropInteraction'
import { HighlightButton } from './HighlightButton'
import { CreateActionMenu } from './CreateActionMenu'
import { LoadingImage, type LoadingImageState } from './LoadingImage'
import { TiltingImage } from './TiltingImage'
import { ShimmerTile } from './ShimmerTile'
import { GradientText } from './GradientText'
import { useDissolveEffect } from './useDissolveEffect'
import { StatusIndicator, type StatusState } from './StatusIndicator'
import { readMotionNumber, useMotionActivity } from './motion-runtime'
import './motion-gallery.css'

const IMAGE = '/demo/news/larch.jpg'
type MotionExampleId = keyof typeof en.motionLab.examples
type PreviewProps = { playing: boolean }
const styleSources = import.meta.glob<string>(['./*.css', '!./motion-gallery.css'], { query: '?raw', import: 'default' })
const implementations = import.meta.glob<string>(['./*.tsx', './use*.ts', '!./MotionGallery.tsx'], { query: '?raw', import: 'default' })

function CardStackPreview() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState('')
  const icons = [File, Image, Folder]
  const labels = [t('motionLab.file'), t('motionLab.image'), t('motionLab.folder')]
  return <>
    <div className="motion-stage"><CardStack label={t('motionLab.examples.card-stack.name')} items={CARD_STACK_LAYOUT.map((position, index) => {
      const Icon = icons[index]
      return { id: ['file', 'image', 'folder'][index], position, label: labels[index], content: <Icon size={24} strokeWidth={1.4} aria-hidden="true" />, onSelect: () => setSelected(labels[index]) }
    })} /></div>
    <p className="motion-feedback" role="status">{selected ? t('motionLab.selected', { name: selected }) : t('motionLab.idle')}</p>
  </>
}

function ConfettiPreview({ playing }: PreviewProps) {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [count, setCount] = useState(0)
  const burst = useConfettiBurst(stageRef, canvasRef, buttonRef, playing)
  return <>
    <div ref={stageRef} className="motion-stage oa-confetti-stage">
      <Button ref={buttonRef} variant="outline" onClick={() => { burst(); setCount(value => value + 1) }}><Sparkles aria-hidden="true" />{t('motionLab.celebrate')}</Button>
      <canvas ref={canvasRef} className="oa-confetti-canvas" aria-hidden="true" />
    </div>
    <p className="motion-feedback" role="status">{t('motionLab.completeCount', { count })}</p>
  </>
}

function DragPreview() {
  const { t } = useTranslation()
  const chipRef = useRef<HTMLButtonElement>(null)
  const zoneRef = useRef<HTMLDivElement>(null)
  const puffsRef = useRef<SVGGElement>(null)
  const filterId = `oa-drop-smoke-${useId().replace(/:/g, '')}`
  const [count, setCount] = useState(0)
  useDropInteraction(chipRef, zoneRef, puffsRef, { onDrop: () => setCount(value => value + 1) })
  return <>
    <div className="motion-stage"><div className="oa-drop-wrap">
      <button ref={chipRef} type="button" className="oa-drop-chip" aria-label={t('motionLab.drop')}><img src={IMAGE} alt="" draggable={false} /></button>
      <div ref={zoneRef} className="oa-drop-zone" aria-label={t('motionLab.dropTarget')}>
        <span className="oa-drop-zone-label"><Plus size={20} aria-hidden="true" /></span>
        <img className="oa-drop-dropped" src={IMAGE} alt="" draggable={false} />
        <svg className="oa-drop-puffs" viewBox="0 0 204 204" aria-hidden="true" focusable="false">
          <defs><filter id={filterId} x="-150%" y="-150%" width="400%" height="400%">
            <feTurbulence type="fractalNoise" baseFrequency="0.046 0.046" numOctaves="2" seed="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="30" xChannelSelector="R" yChannelSelector="G" result="warped" />
            <feGaussianBlur in="warped" stdDeviation="5" />
          </filter></defs>
          <g ref={puffsRef} filter={`url(#${filterId})`} />
        </svg>
      </div>
    </div></div>
    <p className="motion-feedback" role="status">{t('motionLab.completeCount', { count })}</p>
  </>
}

function HighlightPreview({ playing }: PreviewProps) {
  const { t } = useTranslation()
  const [count, setCount] = useState(0)
  return <>
    <div className="motion-stage"><HighlightButton playing={playing} onClick={() => setCount(value => value + 1)}><Sparkles aria-hidden="true" />{t('motionLab.tryAction')}</HighlightButton></div>
    <p className="motion-feedback" role="status">{t('motionLab.completeCount', { count })}</p>
  </>
}

function GooeyPreview() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState('')
  const items = [
    { id: 'file', label: t('motionLab.file'), fx: '-54px', fy: '-34px', icon: <File size={16} aria-hidden="true" /> },
    { id: 'image', label: t('motionLab.image'), fx: '0px', fy: '-64px', icon: <Image size={16} aria-hidden="true" /> },
    { id: 'folder', label: t('motionLab.folder'), fx: '54px', fy: '-34px', icon: <Folder size={16} aria-hidden="true" /> },
  ]
  return <>
    <div className="motion-stage"><CreateActionMenu items={items} label={t('motionLab.create')} onSelect={item => setSelected(item.label)} /></div>
    <p className="motion-feedback" role="status">{selected ? t('motionLab.selected', { name: selected }) : t('motionLab.idle')}</p>
  </>
}

function LoadingImagePreview({ playing }: PreviewProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<LoadingImageState>('idle')
  return <>
    <div className="motion-stage"><LoadingImage state={state} playing={playing} src={state === 'revealed' ? IMAGE : null} alt={t('motionLab.imageAlt')} loadingLabel={t('motionLab.loading')} /></div>
    <div className="motion-controls" role="group" aria-label={t('motionLab.imageState')}>
      <Button variant="ghost" aria-pressed={state === 'loading'} onClick={() => setState('loading')}><LoaderCircle aria-hidden="true" />{t('motionLab.loading')}</Button>
      <Button variant="ghost" aria-pressed={state === 'revealed'} onClick={() => setState('revealed')}><Image aria-hidden="true" />{t('motionLab.reveal')}</Button>
      <Button variant="ghost" size="icon" aria-label={t('motionLab.reset')} onClick={() => setState('idle')}><RotateCcw aria-hidden="true" /></Button>
    </div>
  </>
}

function ImageTiltPreview({ playing }: PreviewProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState(false)
  return <>
    <div className="motion-stage"><TiltingImage src={IMAGE} alt={t('motionLab.imageAlt')} openLabel={t('motionLab.openImage')} closeLabel={t('motionLab.closeImage')} playing={playing} /></div>
    <div className="motion-controls"><Button variant="ghost" onClick={() => setPreview(true)}><Image aria-hidden="true" />{t('motionLab.preview')}</Button></div>
    <ConversationImagePreview image={preview ? { path: t('motionLab.imageAlt'), href: IMAGE } : null} onClose={() => setPreview(false)} />
  </>
}

function ShimmerPreview({ playing }: PreviewProps) {
  const { t } = useTranslation()
  return <>
    <div className="motion-stage"><ShimmerTile playing={playing} /></div>
    <p className="motion-feedback">{t('motionLab.preview')}</p>
  </>
}

function GradientPreview({ playing }: PreviewProps) {
  const { t } = useTranslation()
  const [text, setText] = useState<string>(t('motionLab.gradientLabel'))
  return <>
    <div className="motion-stage"><GradientText playing={playing} className="motion-gradient-label">{text}</GradientText></div>
    <div className="motion-controls"><input type="text" className={inputClass} aria-label={t('motionLab.nameInput')} value={text} maxLength={40} onChange={event => setText(event.target.value)} /></div>
  </>
}

function SmokyPreview({ playing }: PreviewProps) {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [count, setCount] = useState(0)
  const dissolve = useDissolveEffect(stageRef, cardRef, canvasRef, { respawn: true, enabled: playing, onComplete: () => setCount(value => value + 1) })
  return <>
    <div ref={stageRef} className="motion-stage oa-dissolve-stage">
      <div ref={cardRef} className="oa-dissolve-card"><img src={IMAGE} alt={t('motionLab.imageAlt')} /></div>
      <canvas ref={canvasRef} className="oa-dissolve-canvas" aria-hidden="true" />
    </div>
    <div className="motion-controls"><Button variant="ghost" onClick={dissolve}><Trash2 aria-hidden="true" />{t('motionLab.clear')}</Button><span className="motion-count" role="status">{count}</span></div>
  </>
}

function StatusPreview() {
  const { t } = useTranslation()
  const [state, setState] = useState<StatusState>('loading')
  const label = t(`motionLab.${state === 'done' ? 'complete' : state}`)
  return <>
    <div className="motion-stage"><div className="motion-status"><StatusIndicator state={state} size={28} /><span role="status">{label}</span></div></div>
    <div className="motion-controls" role="group" aria-label={t('motionLab.statusState')}>
      <Button variant="ghost" aria-pressed={state === 'done'} onClick={() => setState('done')}><CheckCircle2 aria-hidden="true" />{t('motionLab.complete')}</Button>
      <Button variant="ghost" aria-pressed={state === 'error'} onClick={() => setState('error')}><CircleAlert aria-hidden="true" />{t('motionLab.error')}</Button>
      <Button variant="ghost" size="icon" aria-label={t('motionLab.reset')} onClick={() => setState('loading')}><RotateCcw aria-hidden="true" /></Button>
    </div>
  </>
}

const examples: Record<MotionExampleId, { Preview: ComponentType<PreviewProps>; source: string; styles: string }> = {
  'card-stack': { Preview: CardStackPreview, source: './CardStack.tsx', styles: './card-stack.css' },
  'confetti': { Preview: ConfettiPreview, source: './useConfettiBurst.ts', styles: './confetti-burst.css' },
  'drop-interaction': { Preview: DragPreview, source: './useDropInteraction.ts', styles: './drop-interaction.css' },
  'highlight-button': { Preview: HighlightPreview, source: './HighlightButton.tsx', styles: './highlight-button.css' },
  'create-menu': { Preview: GooeyPreview, source: './CreateActionMenu.tsx', styles: './create-action-menu.css' },
  'loading-image': { Preview: LoadingImagePreview, source: './LoadingImage.tsx', styles: './loading-image.css' },
  'tilting-image': { Preview: ImageTiltPreview, source: './TiltingImage.tsx', styles: './tilting-image.css' },
  'shimmer-tile': { Preview: ShimmerPreview, source: './ShimmerTile.tsx', styles: './shimmer-tile.css' },
  'gradient-text': { Preview: GradientPreview, source: './GradientText.tsx', styles: './gradient-text.css' },
  'dissolve-effect': { Preview: SmokyPreview, source: './useDissolveEffect.ts', styles: './dissolve-effect.css' },
  'status-indicator': { Preview: StatusPreview, source: './StatusIndicator.tsx', styles: './status-indicator.css' },
}
const exampleIds = Object.keys(examples) as MotionExampleId[]

function MotionCard({ id, index, playing, onSource }: { id: MotionExampleId; index: number; playing: boolean; onSource: (id: MotionExampleId) => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLElement>(null)
  const active = useMotionActivity(ref, playing)
  const { Preview } = examples[id]
  const name = t(`motionLab.examples.${id}.name`)
  return <article ref={ref} className="motion-card" data-example={id} data-playing={active} aria-label={name}>
    <header className="motion-card-header"><span className="motion-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><h4>{name}</h4>
      <Button variant="ghost" size="icon" className="motion-source-action" aria-label={t('motionLab.viewSource', { name })} onClick={() => onSource(id)}><Code2 aria-hidden="true" /></Button>
    </header>
    <MeasuredText as="p" className="motion-description">{t(`motionLab.examples.${id}.description`)}</MeasuredText>
    <Preview playing={active} />
  </article>
}

function SourceDialog({ id, onClose }: { id: MotionExampleId | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [lastId, setLastId] = useState<MotionExampleId | null>(id)
  useEffect(() => { if (id) setLastId(id) }, [id])
  const [variant, setVariant] = useState('typescript')
  const displayedId = id ?? lastId
  const sourceKey = `${displayedId}:${variant}`
  const [loadedSource, setLoadedSource] = useState<{ key: string; text: string } | null>(null)
  const [sourceError, setSourceError] = useState<{ key: string; message: string } | null>(null)
  const [copiedKey, setCopiedKey] = useState('')
  const code = loadedSource?.key === sourceKey ? loadedSource.text : null
  const error = sourceError?.key === sourceKey ? sourceError.message : ''
  const copied = copiedKey === sourceKey
  useEffect(() => {
    if (!id) return
    const key = `${id}:${variant}`
    setSourceError(null); setCopiedKey('')
    let disposed = false
    const load = variant === 'styles' ? styleSources[examples[id].styles] : implementations[examples[id].source]
    if (!load) { setSourceError({ key, message: t('motionLab.sourceError') }); return }
    void load().then(value => { if (!disposed) setLoadedSource({ key, text: value }) }, () => { if (!disposed) setSourceError({ key, message: t('motionLab.sourceError') }) })
    return () => { disposed = true }
  }, [id, variant, t])
  const name = displayedId ? t(`motionLab.examples.${displayedId}.name`) : ''
  return <Dialog open={id !== null} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="motion-source-dialog sm:max-w-3xl" closeLabel={t('common.close')}>
      <DialogTitle>{name}</DialogTitle>
      <DialogDescription>{t('motionLab.sourceDescription')}</DialogDescription>
      <Tabs value={variant} onValueChange={value => setVariant(String(value))} className="motion-source-tabs">
        <div className="motion-source-toolbar">
          <TabsList aria-label={t('motionLab.sourceVariants')}>
            <TabsTrigger value="typescript">TypeScript</TabsTrigger><TabsTrigger value="styles">CSS</TabsTrigger>
          </TabsList>
          <Button variant="outline" disabled={code === null} onClick={() => { if (code) void navigator.clipboard.writeText(code).then(() => setCopiedKey(sourceKey), () => setSourceError({ key: sourceKey, message: t('motionLab.copyError') })) }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{t(copied ? 'motionLab.copied' : 'motionLab.copy')}</Button>
        </div>
        {error && <p role="alert" className="motion-source-error">{error}</p>}
        <TabsContent value={variant} className="motion-source-panel">
          {code === null && !error ? <Skeleton className="h-72 w-full" /> : <pre className="motion-source-code" tabIndex={0}><code>{code}</code></pre>}
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
}

export default function MotionGallery() {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(true)
  const [generation, setGeneration] = useState(0)
  const [source, setSource] = useState<MotionExampleId | null>(null)
  const [timing, setTiming] = useState<number[]>([])
  useEffect(() => { setTiming(['--motion-fast', '--motion-standard', '--motion-slow'].map(name => readMotionNumber(name, 0))) }, [])
  return <section className="motion-library" data-paused={!playing} aria-label={t('motionLab.galleryLabel')}>
    <div className="motion-library-heading"><div><div className="motion-eyebrow"><Layers size={14} aria-hidden="true" /><span>OpenAlice</span><ChevronRight size={12} aria-hidden="true" /><span>{t('motionLab.exampleCount', { count: exampleIds.length })}</span></div><h3>{t('motionLab.title')}</h3><MeasuredText as="p" className="motion-intro">{t('motionLab.description')}</MeasuredText></div>
      <div className="motion-library-actions"><Button variant="outline" aria-pressed={!playing} onClick={() => setPlaying(value => !value)}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{t(playing ? 'motionLab.pause' : 'motionLab.play')}</Button><Button variant="ghost" size="icon" aria-label={t('motionLab.reset')} onClick={() => setGeneration(value => value + 1)}><RotateCcw aria-hidden="true" /></Button></div>
    </div>
    <dl className="motion-timing" aria-label={t('motionLab.tokens')}>{(['fast', 'standard', 'slow'] as const).map((kind, index) => <div key={kind}><dt>{t(`motionLab.${kind}`)}</dt><dd>{timing[index] ?? '—'}<span>ms</span></dd></div>)}</dl>
    <div className="motion-grid" key={generation}>{exampleIds.map((id, index) => <MotionCard key={id} id={id} index={index} playing={playing} onSource={setSource} />)}</div>
    <SourceDialog id={source} onClose={() => setSource(null)} />
  </section>
}
