import { authHandlers } from './auth'
import { tradingHandlers } from './trading'
import { workspacesHandlers } from './workspaces'
import { inboxHandlers } from './inbox'
import { entitiesHandlers } from './entities'
import { personaHeartbeatHandlers } from './personaHeartbeat'
import { scheduleHandlers } from './schedule'
import { issuesHandlers } from './issues'
import { wikilinkHandlers } from './wikilink'
import { toolsSimulatorHandlers } from './toolsSimulator'
import { marketHandlers } from './market'
import { configKeysHandlers } from './configKeys'
import { agentStatusHandlers } from './agentStatus'
import { newsListHandlers } from './newsList'
import { devMiscHandlers } from './devMisc'
import { headlessHandlers } from './headless'
import { preferencesHandlers } from './preferences'
import { inquiryHandlers } from './inquiries'
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
  ...personaHeartbeatHandlers,
  ...scheduleHandlers,
  ...issuesHandlers,
  ...wikilinkHandlers,
  ...toolsSimulatorHandlers,
  ...marketHandlers,
  ...configKeysHandlers,
  ...agentStatusHandlers,
  ...newsListHandlers,
  ...devMiscHandlers,
  ...headlessHandlers,
  ...preferencesHandlers,
  ...inquiryHandlers,
  ...catchAllHandlers,
]
