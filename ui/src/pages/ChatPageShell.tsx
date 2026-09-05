import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageContentLayout } from '../components/PageTopBar'

export type HarnessSidebarMode = 'chat' | 'auto-quant' | 'prediction'

interface ChatPageShellProps {
  children: ReactNode
  mode?: HarnessSidebarMode
}

export function ChatPageShell({ children, mode = 'chat' }: ChatPageShellProps) {
  const { t } = useTranslation()
  // Sessions live in the global rail. Landing pages still own readiness;
  // their working surfaces no longer mount a second conversation navigator.
  return (
    <PageContentLayout title={t(mode === 'chat' ? 'nav.generalChat'
      : mode === 'auto-quant' ? 'nav.item.autoQuant' : 'nav.item.autoPrediction')}>
      {children}
    </PageContentLayout>
  )
}
