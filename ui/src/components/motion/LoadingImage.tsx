import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { readMotionNumber, useMotionActivity } from './motion-runtime'
import './loading-image.css'

export type LoadingImageState = 'idle' | 'loading' | 'revealed'

export interface LoadingImageProps {
  state?: LoadingImageState
  src?: string | null
  alt?: string
  className?: string
  imageClassName?: string
  style?: CSSProperties
  playing?: boolean
  loadingLabel?: string
  onLoad?: () => void
  onError?: () => void
}

function buildField(field: HTMLElement) {
  const width = field.clientWidth, height = field.clientHeight
  if (width === 0 || height === 0) return
  const pitch = Math.max(1, readMotionNumber('--loading-image-pitch', 5))
  const spread = Math.min(0.9, Math.max(0, readMotionNumber('--loading-image-spread', 0.1)))
  const phase = Math.max(0, readMotionNumber('--loading-image-phase', 6000))
  const columns = Math.min(20, Math.max(1, Math.round(width / pitch)))
  const rows = Math.min(20, Math.max(1, Math.round(height / pitch)))
  const fragment = document.createDocumentFragment()
  let seed = 7
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const dot = document.createElement('i')
      dot.style.left = `${(column + 0.5) * 100 / columns}%`
      dot.style.top = `${(row + 0.5) * 100 / rows}%`
      dot.style.setProperty('--k', String(1 - spread + random() * spread * 2))
      dot.style.setProperty('--delay', `${Math.round(-random() * phase)}ms`)
      dot.style.setProperty('--v', String(0.2 + random() * 0.8))
      fragment.appendChild(dot)
    }
  }
  field.replaceChildren(fragment)
}

export function LoadingImage({ state = 'idle', src, alt = '', className, imageClassName, style, playing = true, loadingLabel, onLoad, onError }: LoadingImageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLSpanElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const decodingRef = useRef<HTMLImageElement | null>(null)
  const [decodedSource, setDecodedSource] = useState<string | null>(null)
  const active = useMotionActivity(rootRef, playing)
  const revealed = state === 'revealed' && Boolean(src) && decodedSource === src

  const loaded = () => {
    const image = imageRef.current
    if (!image || image.naturalWidth === 0 || decodingRef.current === image) return
    decodingRef.current = image
    const reveal = () => {
      if (imageRef.current !== image) return
      setDecodedSource(src ?? null)
      onLoad?.()
    }
    if (typeof image.decode === 'function') void image.decode().then(reveal, () => { if (imageRef.current === image) onError?.() })
    else reveal()
  }

  useLayoutEffect(() => {
    const field = fieldRef.current
    if (!field) return
    buildField(field)
    const observer = new ResizeObserver(() => buildField(field))
    observer.observe(field)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) {
      loaded()
    }
  }, [src])

  return (
    <div ref={rootRef} className={cn('oa-loading-image', (state === 'loading' || (state === 'revealed' && !revealed)) && 'is-loading', revealed && 'is-revealed', className)} data-playing={active} aria-busy={state === 'loading' || (Boolean(src) && !revealed)} style={style}>
      {loadingLabel && (state === 'loading' || (src && !revealed)) && <span className="sr-only" role="status">{loadingLabel}</span>}
      <span ref={fieldRef} className="oa-loading-image-field" aria-hidden="true" />
      {src && <img key={src} ref={imageRef} className={cn('oa-loading-image-img', imageClassName)} src={src} alt={alt} aria-hidden={!revealed} decoding="async" onLoad={loaded} onError={onError} />}
    </div>
  )
}
