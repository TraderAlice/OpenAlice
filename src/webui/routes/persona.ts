import { Hono } from 'hono'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath, defaultPath } from '@/core/paths.js'

const PERSONA_FILE = dataPath('brain', 'persona.md')
const PERSONA_DEFAULT = defaultPath('persona.default.md')

/** Persona routes: GET / (read), PUT / (write) */
export function createPersonaRoutes() {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const content = await readFile(PERSONA_FILE, 'utf-8')
      return c.json({ content, path: PERSONA_FILE })
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          const fallback = await readFile(PERSONA_DEFAULT, 'utf-8')
          return c.json({ content: fallback, path: PERSONA_FILE })
        } catch { /* default also missing */ }
        return c.json({ content: '', path: PERSONA_FILE })
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  app.put('/', async (c) => {
    try {
      const { content } = await c.req.json<{ content: string }>()
      await mkdir(dirname(PERSONA_FILE), { recursive: true })
      await writeFile(PERSONA_FILE, content, 'utf-8')
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return app
}
