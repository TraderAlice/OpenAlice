import { HarnessWorkbench } from '../components/harness/HarnessWorkbench'
import type { ViewSpec } from '../tabs/types'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageContentLayout } from '../components/PageTopBar'

export type HarnessSidebarMode = 'chat' | 'auto-quant' | 'prediction'

interface ChatPageShellProps {
  spec?: ViewSpec
  children: ReactNode
  mode?: HarnessSidebarMode
}

export function ChatPageShell({ children, mode = 'chat', spec }: ChatPageShellProps) {
  const { t } = useTranslation()
  // Sessions live in the global rail. Landing pages still own readiness;
  // their working surfaces no longer mount a second conversation navigator.
  const title = t(mode === 'chat' ? 'nav.generalChat'
    : mode === 'auto-quant' ? 'nav.item.autoQuant' : 'nav.item.autoPrediction')
  return spec
    ? <HarnessWorkbench spec={spec} source={mode} title={title}>{children}</HarnessWorkbench>
    : <PageContentLayout title={title}>{children}</PageContentLayout>
}
