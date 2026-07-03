/**
 * Local Tool Gateway — loopback-only HTTP surface for workspace CLI shims.
 *
 * `alice`, `alice-workspace`, `traderhub`, and `alice-uta` are intentionally
 * plain shell commands inside a workspace. They need a local argv->tool bridge,
 * but they do not need the MCP protocol. Keeping this gateway separate lets
 * Electron/dev reuse the web listener for `/cli` while Docker/public-web
 * topologies can keep an unauthenticated CLI surface on a private loopback
 * port.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import type { Plugin, EngineContext } from '../core/types.js'
import type { ToolCenter } from '../core/tool-center.js'
import type { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import type { IInboxStore } from '../core/inbox-store.js'
import type { IEntityStore } from '../core/entity-store.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { registerCliRoutes } from './cli.js'

export interface LocalToolGatewayDeps {
  readonly toolCenter: ToolCenter
  readonly workspaceToolCenter: WorkspaceToolCenter
  readonly inboxStore: IInboxStore
  readonly entityStore: IEntityStore
  readonly getWorkspaceService: () => WorkspaceService | null
}

export function mountLocalToolGateway(app: Hono, deps: LocalToolGatewayDeps): void {
  registerCliRoutes(app, deps)
}

export class LocalToolGatewayPlugin implements Plugin {
  name = 'local-tool-gateway'
  private server: ReturnType<typeof serve> | null = null

  constructor(
    private port: number,
    private deps: LocalToolGatewayDeps,
  ) {}

  async start(_ctx: EngineContext) {
    const app = new Hono()
    app.use('*', cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'x-openalice-run', 'x-openalice-session'],
    }))
    mountLocalToolGateway(app, this.deps)
    this.server = serve({ fetch: app.fetch, port: this.port, hostname: '127.0.0.1' }, (info) => {
      console.log(`local tool gateway listening on http://127.0.0.1:${info.port}/cli`)
    })
  }

  async stop() {
    this.server?.close()
  }
}
