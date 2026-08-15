import { MessageSquare } from 'lucide-react'

import { HarnessSetupPage } from '../components/HarnessSetupPage'
import { useWorkspaces } from '../contexts/workspaces-context'

export function ChatSetupPage() {
  const ctx = useWorkspaces()
  return (
    <HarnessSetupPage
      icon={MessageSquare}
      testIdPrefix="chat-setup"
      copyPrefix="chatSetup"
      templateName="chat"
      showHarnessVersion={false}
      requireTemplates={false}
      initialize={() => ctx.initializeChat()}
    />
  )
}
