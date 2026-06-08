import { authHandlers } from './auth'
import { tradingHandlers } from './trading'
import { workspacesHandlers } from './workspaces'
import { eventsHandlers } from './events'
import { inboxHandlers } from './inbox'
import { entitiesHandlers } from './entities'
import { personaHeartbeatHandlers } from './personaHeartbeat'
import { cronHandlers } from './cron'
import { toolsSimulatorHandlers } from './toolsSimulator'
import { marketHandlers } from './market'
import { configKeysHandlers } from './configKeys'
import { agentStatusHandlers } from './agentStatus'
import { newsListHandlers } from './newsList'
import { devMiscHandlers } from './devMisc'
import { headlessHandlers } from './headless'
import { catchAllHandlers } from './catchAll'

// Order matters: catchAll must be LAST. MSW resolves handlers in registration
// order; catchAll's broad `/api/*` pattern would shadow specific routes if
// placed earlier.
export const handlers = [
  ...authHandlers,
  ...tradingHandlers,
  ...workspacesHandlers,
  ...eventsHandlers,
  ...inboxHandlers,
  ...entitiesHandlers,
  ...personaHeartbeatHandlers,
  ...cronHandlers,
  ...toolsSimulatorHandlers,
  ...marketHandlers,
  ...configKeysHandlers,
  ...agentStatusHandlers,
  ...newsListHandlers,
  ...devMiscHandlers,
  ...headlessHandlers,
  ...catchAllHandlers,
]
