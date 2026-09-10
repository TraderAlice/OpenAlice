import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'

/** Pure preview surface; the message consumer decides when to open it. */
export function ConversationImagePreview({ image, onClose }: {
  image: { path: string; href: string } | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  return <Dialog open={image !== null} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="sm:max-w-4xl max-h-[90dvh] overflow-y-auto" closeLabel={t('common.close')}>
      <DialogTitle className="break-all pr-8 text-sm">{image?.path}</DialogTitle>
      {image && <img src={image.href} alt={image.path} className="mx-auto h-auto max-w-full max-h-[75dvh] object-contain" />}
    </DialogContent>
  </Dialog>
}
