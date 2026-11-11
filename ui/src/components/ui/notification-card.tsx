import { Button } from './button'
import { useState } from 'react'
import { ArrowRight, CheckCircle2, Info, Loader2, Newspaper, OctagonX, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NotificationContent } from '../../lib/notifications/queue'
import { safeNotificationImage } from '../../lib/notifications/image'

export function NotificationCard({ content, onClose }: { content: NotificationContent; onClose(): void }) {
  const { t } = useTranslation()
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const image = safeNotificationImage(content.image)
  const Icon = content.status === 'running' ? Loader2
    : content.status === 'error' ? OctagonX
      : content.status === 'warning' ? TriangleAlert
        : content.status === 'success' ? CheckCircle2
          : content.articleId !== undefined ? Newspaper : Info
  return (
    <div className="oa-notification" data-status={content.status}>
      <div className="oa-notification-header">
        <Icon aria-hidden="true" className={`oa-notification-icon ${content.status === 'running' ? 'animate-spin' : ''}`} />
        <span className="oa-notification-title">{content.title}</span>
        {content.articleId !== undefined ? <span className="oa-notification-count">· {t('activityToast.newsCount', { count: content.count ?? 1 })}</span> : (content.count ?? 0) > 1 && <span className="oa-notification-count">×{content.count}</span>}
      </div>
      <Button type="button" variant="ghost" size="icon-sm" className="oa-notification-close" aria-label={t('activityToast.dismiss')} onClick={onClose}>
        <X size={14} aria-hidden="true" />
      </Button>
      <div className="oa-notification-body">
        <div className="oa-notification-copy">
          {content.description && <p className="oa-notification-description">{content.description}</p>}
          {content.action && <Button type="button" variant="secondary" size="sm" className="oa-notification-action" onClick={() => {
            content.action!.onClick()
            onClose()
          }}>
            {content.action.label}<ArrowRight size={12} aria-hidden="true" />
          </Button>}
        </div>
        {image && image !== failedImage && <img key={image} src={image} alt="" width={64} height={48}
          decoding="async" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} className="oa-notification-image" />}
      </div>
    </div>
  )
}
