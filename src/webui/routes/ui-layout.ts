import { Hono } from 'hono'

import {
  readUiLayout,
  UiLayoutError,
  writeUiLayout,
  type UiLayout,
} from '../../core/ui-layout.js'

interface UiLayoutRouteDeps {
  readUiLayout(): Promise<UiLayout>
  writeUiLayout(input: unknown): Promise<UiLayout>
}

const defaultDeps: UiLayoutRouteDeps = {
  readUiLayout: () => readUiLayout(),
  writeUiLayout: (input) => writeUiLayout(input),
}

export function createUiLayoutRoutes(deps: UiLayoutRouteDeps = defaultDeps) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      return c.json(await deps.readUiLayout())
    } catch (error) {
      return c.json({ error: 'ui_layout_read_failed', message: String(error) }, 500)
    }
  })

  app.put('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_ui_layout', message: 'Expected a JSON object' }, 400)
    }
    try {
      return c.json(await deps.writeUiLayout(body))
    } catch (error) {
      if (error instanceof UiLayoutError) {
        return c.json({ error: 'invalid_ui_layout', message: error.message }, 400)
      }
      return c.json({ error: 'ui_layout_write_failed', message: String(error) }, 500)
    }
  })

  return app
}
