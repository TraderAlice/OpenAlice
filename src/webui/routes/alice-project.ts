import { Hono } from 'hono'
import {
  readAliceProjectProduct,
  resolveAliceProjectIdentity,
} from '@traderalice/guardian-runtime'
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

  app.get('/', async (c) => {
    const home = options.home ?? userDataHome
    const identity = resolveAliceProjectIdentity({
      home,
      appRoot: options.appRoot === undefined
        ? appResourcesHome
        : options.appRoot,
      env: options.env,
    })
    return c.json({
      project: {
        ...identity,
        product: await readAliceProjectProduct(home),
      },
    })
  })

  return app
}
