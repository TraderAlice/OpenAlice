import { useRef, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ConfigurationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children: ReactNode
  restoreFocusRef?: RefObject<HTMLElement | null>
  headerAccessory?: ReactNode
  keepMounted?: boolean
}

/**
 * Route-free settings shell for configuration launched from a product surface.
 * Feature components own the form; this shell owns focus, sizing, and scrolling.
 */
export function ConfigurationDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  restoreFocusRef,
  headerAccessory,
  keepMounted = false,
}: ConfigurationDialogProps) {
  const { t } = useTranslation()
  const titleRef = useRef<HTMLHeadingElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        keepMounted={keepMounted}
        initialFocus={titleRef}
        finalFocus={restoreFocusRef}
        closeLabel={t('common.close')}
        closeButtonClassName="right-2.5 top-2.5 size-10 sm:right-2 sm:top-2 sm:size-8"
        className="flex h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:h-auto sm:max-h-[min(46rem,calc(100dvh-2rem))] sm:w-[calc(100%-2rem)] sm:max-w-3xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-5 py-4 pr-12 sm:px-6">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle
                ref={titleRef}
                tabIndex={-1}
                className="truncate text-[16px] font-semibold leading-6 outline-none"
              >
                {title}
              </DialogTitle>
              {description && (
                <DialogDescription className="mt-0.5 text-[12px] leading-5">
                  {description}
                </DialogDescription>
              )}
            </div>
            {headerAccessory && <div className="shrink-0 pr-1">{headerAccessory}</div>}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
