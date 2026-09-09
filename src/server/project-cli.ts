import type { Hono } from 'hono'
import { z } from 'zod'
import { resolveAliceProjectIdentity } from '@traderalice/guardian-runtime'
import { appResourcesHome, userDataHome } from '../core/paths.js'
import type { ToolCenter } from '../core/tool-center.js'
import { extractMcpShape, wrapToolExecute } from '../core/mcp-export.js'
import { getExport, toolRegistryScope } from './cli-commands.js'

/** Project calls have no Workspace identity and cannot construct scoped tools. */
export function registerProjectCliRoutes(app: Hono, toolCenter: ToolCenter, project = resolveAliceProjectIdentity({ home: userDataHome, appRoot: appResourcesHome })): void {
  app.use('/cli/project/*', async (c, next) => {
    if (c.req.header('x-openalice-project') !== project.id) {
      return c.json({ error: 'Project identity mismatch; reconnect to the selected Project' }, 409)
    }
    await next()
  })
  const catalog = (key: string) => {
    const exp = getExport(key)
    if (!exp) return null
    const groups: Record<string, Record<string, { tool: string; description: string; schema: unknown }>> = {}
    for (const [group, verbs] of Object.entries(exp.commands)) {
      for (const [verb, name] of Object.entries(verbs)) {
        if (toolRegistryScope(exp, name) !== 'global') continue
        const tool = toolCenter.get(name)
        if (!tool) continue
        ;(groups[group] ??= {})[verb] = {
          tool: name, description: tool.description ?? '',
          schema: z.toJSONSchema(tool.inputSchema as z.ZodType, { io: 'input', unrepresentable: 'any' }),
        }
      }
    }
    return { export: key, projectId: project.id, description: exp.description, groupDescriptions: exp.groupDescriptions, groups, unmapped: [] }
  }
  app.get('/cli/project/:export/manifest', c => {
    const result = catalog(c.req.param('export'))
    return result ? c.json(result) : c.json({ error: 'Unknown CLI export' }, 404)
  })
  app.post('/cli/project/:export/invoke', async c => {
    const exp = catalog(c.req.param('export'))
    if (!exp) return c.json({ error: 'Unknown CLI export' }, 404)
    const body = await c.req.json().catch(() => ({})) as { tool?: unknown; args?: unknown }
    const name = typeof body.tool === 'string' ? body.tool : ''
    const allowed = Object.values(exp.groups).some(verbs => Object.values(verbs).some(command => command.tool === name))
    const tool = allowed ? toolCenter.get(name) : null
    if (!tool) return c.json({ error: 'Command unavailable at Project scope; Workspace commands require Workspace context' }, 404)
    const schema = z.strictObject(extractMcpShape(tool))
    const args = await schema.safeParseAsync(body.args ?? {})
    if (!args.success) return c.json({ error: 'Validation failed', details: args.error.message }, 400)
    const result = await wrapToolExecute(tool)(args.data)
    if (result.isError) return c.json({ error: result.content.filter(b => b.type === 'text').map(b => b.text).join('\n') }, 500)
    return c.json({ content: result.content })
  })
}
