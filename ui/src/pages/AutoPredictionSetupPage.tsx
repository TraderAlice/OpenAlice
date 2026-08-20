import { Binary } from 'lucide-react'

import { HarnessSetupPage } from '../components/HarnessSetupPage'
import { useWorkspaces } from '../contexts/workspaces-context'

const AUTO_PREDICTION_TEMPLATE = 'auto-prediction'

export function AutoPredictionSetupPage() {
  const ctx = useWorkspaces()
  return (
    <HarnessSetupPage
      icon={Binary}
      testIdPrefix="prediction-setup"
      copyPrefix="autoPredictionSetup"
      templateName={AUTO_PREDICTION_TEMPLATE}
      showHarnessVersion
      extraReady={ctx.autoPredictionPreferenceLoaded ?? false}
      extraError={ctx.autoPredictionPreferenceError ?? null}
      onRetryExtra={() => void ctx.refreshAutoPredictionPreference?.()}
      initialize={() => ctx.initializeAutoPrediction?.() ?? Promise.reject(new Error('Auto Prediction is unavailable'))}
      selectWorkspace={(workspaceId) => ctx.setAutoPredictionDefaultWorkspace?.(workspaceId)
        ?? Promise.reject(new Error('Auto Prediction is unavailable'))}
    />
  )
}
