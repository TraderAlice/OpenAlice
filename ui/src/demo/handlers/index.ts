import { authHandlers } from './auth'
import { tradingHandlers } from './trading'
import { workspacesHandlers } from './workspaces'
import { inboxHandlers } from './inbox'
import { entitiesHandlers } from './entities'
import { scheduleHandlers } from './schedule'
import { issuesHandlers } from './issues'
import { wikilinkHandlers } from './wikilink'
import { toolsSimulatorHandlers } from './toolsSimulator'
import { marketHandlers } from './market'
import { configKeysHandlers } from './configKeys'
import { agentStatusHandlers } from './agentStatus'
import { agentConversationHandlers } from './agentConversations'
import { agentRuntimeHandlers } from './agentRuntime'
import { officeHandlers } from './office'
import { newsListHandlers } from './newsList'
import { devMiscHandlers } from './devMisc'
import { headlessHandlers } from './headless'
import { preferencesHandlers } from './preferences'
import { uiLayoutHandlers } from './ui-layout'
import { inquiryHandlers } from './inquiries'
import { connectorsHandlers } from './connectors'
import { harnessSurfaceHandlers } from './harness-surfaces'
import { catchAllHandlers } from './catchAll'

// Order matters: catchAll must be LAST. MSW resolves handlers in registration
// order; catchAll's broad `/api/*` pattern would shadow specific routes if
// placed earlier.
export const handlers = [
  ...authHandlers,
  ...tradingHandlers,
  ...workspacesHandlers,
  ...inboxHandlers,
  ...entitiesHandlers,
  ...scheduleHandlers,
  ...issuesHandlers,
  ...wikilinkHandlers,
  ...toolsSimulatorHandlers,
  ...marketHandlers,
  ...configKeysHandlers,
  ...agentStatusHandlers,
  ...agentConversationHandlers,
  ...agentRuntimeHandlers,
  ...officeHandlers,
  ...newsListHandlers,
  ...devMiscHandlers,
  ...headlessHandlers,
  ...preferencesHandlers,
  ...uiLayoutHandlers,
  ...inquiryHandlers,
  ...connectorsHandlers,
  ...harnessSurfaceHandlers,
  ...catchAllHandlers,
]
