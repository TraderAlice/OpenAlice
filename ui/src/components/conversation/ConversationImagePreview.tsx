import { useState } from 'react'
import { LoadingImage } from '../motion/LoadingImage'
import { Button } from '../ui/button'
import './conversation-image-preview.css'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'

/** Pure preview surface; the message consumer decides when to open it. */
export function ConversationImagePreview({ image, onClose }: {
  image: { path: string; href: string } | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  return <Dialog open={image !== null} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="sm:max-w-4xl max-h-[90dvh] overflow-y-auto" closeLabel={t('common.close')}>
      <DialogTitle className="break-all pr-8 text-sm">{image?.path}</DialogTitle>
      {image && (failedSource === image.href ? (
        <div className="oa-image-preview-error" role="alert">
          <p>{t('common.imageLoadFailed')}</p>
          <Button type="button" variant="outline" onClick={() => { setFailedSource(null); setRetry(value => value + 1) }}>{t('common.retry')}</Button>
        </div>
      ) : <LoadingImage key={`${image.href}:${retry}`} state="revealed" src={image.href} alt={image.path}
        loadingLabel={t('common.loading')} className="oa-image-preview" imageClassName="oa-image-preview-content" onError={() => setFailedSource(image.href)} />)}
    </DialogContent>
  </Dialog>
}
