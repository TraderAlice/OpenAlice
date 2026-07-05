import { PageHeader } from '../components/PageHeader'
import { PushApprovalPanel } from '../components/PushApprovalPanel'

export function TradingAsGitPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Trading as Git"
        description="Review broker writes staged by agents before they are pushed to the venue."
      />
      <div className="flex-1 min-h-0 min-w-0 px-4 md:px-6 py-5">
        <PushApprovalPanel />
      </div>
    </div>
  )
}
