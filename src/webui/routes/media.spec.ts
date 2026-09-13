/**
 * Route-level regression for GET /api/media/:date/:name (CWE-22):
 *  - a benign file inside the store is served,
 *  - percent-encoded '..' traversal is answered 404 instead of disclosing files.
 * Note: createMediaRoutes() mounts at '/:date/:name'; the '/api/media' prefix is
 * added by the web plugin, so requests here omit it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type MediaRoutes = typeof import('./media.js')

describe('GET /api/media/:date/:name path traversal', () => {
  let home = ''
  let createMediaRoutes: MediaRoutes['createMediaRoutes']

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'oa-media-route-spec-'))
    process.env['OPENALICE_HOME'] = home
    const mediaDir = join(home, 'data', 'media', '2026-09-02')
    await mkdir(mediaDir, { recursive: true })
    await writeFile(join(mediaDir, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    vi.resetModules()
    createMediaRoutes = (await import('./media.js')).createMediaRoutes
  })

  it('serves a file that lives inside the store', async () => {
    const app = createMediaRoutes()
    const res = await app.request('/2026-09-02/a.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer())[0]).toBe(0x89)
  })

  it('answers percent-encoded .. traversal with 404 instead of leaking files', async () => {
    const app = createMediaRoutes()
    const res = await app.request(
      '/2026-09-02/..%2F..%2Fconfig%2Fauth.json',
    )
    expect(res.status).toBe(404)
  })
})
