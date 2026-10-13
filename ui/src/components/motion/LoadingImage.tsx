import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useMotionActivity } from './motion-runtime'
import './loading-image.css'

export interface LoadingImageProps {
  src: string
  alt?: string
  className?: string
  imageClassName?: string
  loadingLabel?: string
  onError?: () => void
}

export function LoadingImage({ src, alt = '', className, imageClassName, loadingLabel, onError }: LoadingImageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const decodingRef = useRef<HTMLImageElement | null>(null)
  const [decodedSource, setDecodedSource] = useState<string | null>(null)
  const revealed = decodedSource === src
  const active = useMotionActivity(rootRef, !revealed)

  const loaded = () => {
    const image = imageRef.current
    if (!image || image.naturalWidth === 0 || decodingRef.current === image) return
    decodingRef.current = image
    const reveal = () => {
      if (imageRef.current !== image) return
      setDecodedSource(src)
    }
    if (typeof image.decode === 'function') void image.decode().then(reveal, () => { if (imageRef.current === image) onError?.() })
    else reveal()
  }

  useLayoutEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) {
      loaded()
    }
  }, [src])

  return (
    <div ref={rootRef} className={cn('oa-loading-image', revealed ? 'is-revealed' : 'is-loading', className)} data-playing={active} aria-busy={!revealed}>
      {loadingLabel && !revealed && <span className="sr-only" role="status">{loadingLabel}</span>}
      <span className="oa-loading-image-field" aria-hidden="true" />
      {src && <img key={src} ref={imageRef} className={cn('oa-loading-image-img', imageClassName)} src={src} alt={alt} aria-hidden={!revealed} decoding="async" onLoad={loaded} onError={onError} />}
    </div>
  )
}
