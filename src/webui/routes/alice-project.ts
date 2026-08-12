import { Hono } from 'hono'
import { resolveAliceProjectIdentity } from '@traderalice/guardian-runtime'
import { appResourcesHome, userDataHome } from '../../core/paths.js'

export interface AliceProjectRouteOptions {
  home?: string
  appRoot?: string | null
  env?: NodeJS.ProcessEnv
}

/**
 * Read-only projection of the top-level runtime boundary that owns this Web UI.
 * It deliberately contains paths and identifiers, never credentials or
 * Workspace-owned state.
 */
export function createAliceProjectRoutes(
  options: AliceProjectRouteOptions = {},
) {
  const app = new Hono()

  app.get('/', (c) => c.json({
    project: resolveAliceProjectIdentity({
      home: options.home ?? userDataHome,
      appRoot: options.appRoot === undefined
        ? appResourcesHome
        : options.appRoot,
      env: options.env,
    }),
  }))

  return app
}
