import { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import { registerCliRoutes } from './cli.js'
import { it, expect, vi, afterEach } from 'vitest'
afterEach(() => vi.useRealTimers())
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAliceProjectIdentity } from '@traderalice/guardian-runtime'
import { ToolCenter } from '../core/tool-center.js'
import { createBarService } from '../domain/market-data/bars/index.js'
import type { BarServiceDeps } from '../domain/market-data/bars/types.js'
import { createMarketBarsTools } from '../tool/market-bars.js'
import { createBarsRoutes } from '../webui/routes/bars.js'
import { registerProjectCliRoutes } from './project-cli.js'

const exec = promisify(execFile)
const executable = process.env['OPENALICE_CLI_ACCEPTANCE_EXECUTABLE'] ?? process.execPath
const entryArgs = process.env['OPENALICE_CLI_ACCEPTANCE_EXECUTABLE'] ? [] : ['packages/cli/bin/openalice.ts']
it('public Project CLI exports the same bars as the chart, clears inherited Workspace scope and preserves files', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-08T08:00:00Z'))
  const home = await mkdtemp(join(tmpdir(), 'oa-project-bars-'))
  const identity = resolveAliceProjectIdentity({ home, env: {} })
  const rows = [{ date: '2024-01-02', open: 1, high: 3, low: 1, close: 2, volume: 100 }]
  const barService = createBarService({
    equityClient: { getHistorical: async () => rows },
    vendorProviders: { equity: 'yfinance' },
    utaManager: { has: async () => false },
  } as unknown as BarServiceDeps)
  const center = new ToolCenter()
  center.register(createMarketBarsTools({ barService }), 'bars')
  const app = new Hono()
  const headers: Array<{ session?: string; path: string }> = []
  app.use('*', async (c, next) => { headers.push({ path: c.req.path, session: c.req.header('x-openalice-session') }); await next() })
  registerProjectCliRoutes(app, center, identity)
  registerCliRoutes(app, {
    toolCenter: center, workspaceToolCenter: new WorkspaceToolCenter(), inboxStore: {} as never, entityStore: {} as never,
    getWorkspaceService: () => ({ registry: { get: (id: string) => id === 'local-ws' ? { id, tag: 'Local', dir: home } : undefined } }) as never,
  })
  app.route('/api/bars', createBarsRoutes({ barService } as never))
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  const port = (server.address() as { port: number }).port
  try {
    await mkdir(join(home, 'state'))
    await writeFile(join(home, 'state', 'cli-endpoint.json'), JSON.stringify({ schemaVersion: 1, projectId: identity.id, home, appRoot: process.cwd(), url: `http://127.0.0.1:${port}/cli` }))
    const env = { ...process.env, OPENALICE_SUPERVISOR_HOME: join(home, 'supervisor'), AQ_WS_ID: 'foreign-workspace', AQ_SESSION_ID: 'foreign-session', OPENALICE_PROJECT_ID: 'foreign-project' }
    const args = [...entryArgs, 'exec', '--home', home, 'alice', 'market', 'bars', '--symbol', 'AAPL', '--asset-class', 'equity', '--end', '2024-01-02', '--count', '1']
    const result = await exec(executable, args, { env, timeout: 20_000 })
    const cli = JSON.parse(result.stdout)
    const chart = await (await app.request('/api/bars?symbol=AAPL&assetClass=equity&end=2024-01-02&count=1')).json()
    expect(cli).toEqual({ bars: chart.results, meta: chart.meta })
    expect(headers.filter(h => h.path.startsWith('/cli')).every(h => h.path.startsWith('/cli/project/') && !h.session)).toBe(true)
    await mkdir(join(home, 'supervisor'))
    await writeFile(join(home, 'supervisor', 'config.json'), JSON.stringify({ schemaVersion: 2, defaultProject: 'research', projects: { research: { home } } }))
    const commandArgs = args.slice(args.indexOf('alice'))
    const named = await exec(executable, [...entryArgs, 'exec', '--project', 'research', ...commandArgs], { env })
    expect(JSON.parse(named.stdout)).toEqual(cli)
    await expect(exec(executable, [...entryArgs, 'exec', '--project', 'missing', ...commandArgs], { env })).rejects.toThrow()
    const workspaceEnv = { ...env, OPENALICE_HOME: home, OPENALICE_PROJECT_ID: identity.id, AQ_WS_ID: 'local-ws', AQ_SESSION_ID: '' }
    const inherited = await exec(executable, [...entryArgs, 'exec', ...commandArgs], { env: workspaceEnv })
    expect(JSON.parse(inherited.stdout)).toEqual(cli)
    expect(headers.some(h => h.path === '/cli/local-ws/data/invoke')).toBe(true)
    await mkdir(join(home, '.alice'))
    await writeFile(join(home, '.alice', 'alice-harness-config.json'), JSON.stringify({ schemaVersion: 1, cli: { alice: { groups: { market: false } } } }))
    await expect(exec(executable, [...entryArgs, 'exec', ...commandArgs], { env: workspaceEnv })).rejects.toThrow()
    // Explicit Project scope remains independent of Workspace preferences.
    const projectOnly = await exec(executable, [...entryArgs, 'exec', '--project', 'research', ...commandArgs], { env: workspaceEnv })
    expect(JSON.parse(projectOnly.stdout)).toEqual(cli)
    const output = join(home, 'bars.json')
    const saved = await exec(executable, [...args, '--output', output], { env, timeout: 20_000 })
    expect(saved.stdout).toBe('')
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(cli)
    await expect(exec(executable, [...args, '--output', output], { env })).rejects.toThrow()
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(cli)
    await expect(exec(executable, [...args, '--interval', '2h', '--output', join(home, 'bad.json')], { env })).rejects.toThrow()
    await expect(readFile(join(home, 'bad.json'))).rejects.toThrow()
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(home, { recursive: true, force: true })
  }
}, 30_000)
