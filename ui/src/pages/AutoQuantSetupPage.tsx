import { Microscope } from 'lucide-react'

import { HarnessSetupPage } from '../components/HarnessSetupPage'
import { useWorkspaces } from '../contexts/workspaces-context'

const AUTO_QUANT_TEMPLATE = 'auto-quant-v2'

export function AutoQuantSetupPage() {
  const ctx = useWorkspaces()
  return (
    <HarnessSetupPage
      icon={Microscope}
      testIdPrefix="autoquant-setup"
      copyPrefix="autoQuantSetup"
      templateName={AUTO_QUANT_TEMPLATE}
      showHarnessVersion
      extraReady={ctx.autoQuantPreferenceLoaded}
      extraError={ctx.autoQuantPreferenceError}
      onRetryExtra={() => void ctx.refreshAutoQuantPreference()}
      initialize={() => ctx.initializeAutoQuant()}
      selectWorkspace={(workspaceId) => ctx.setAutoQuantDefaultWorkspace(workspaceId)}
    />
  )
}
