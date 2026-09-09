import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createStickerRoutes } from './stickers.js'
import { StickerPacks } from '../../workspaces/sticker-packs.js'
import { WorkspaceOperationGuard } from '../../workspaces/workspace-operation-guard.js'
import type { WorkspaceService } from '../../workspaces/service.js'
let root: string
 afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
it('roundtrips preview/apply HTTP bodies and respects checkout leases and Chat scope', async () => {
  root = await mkdtemp(join(tmpdir(), 'sticker-routes-'))
  const dir = join(root, 'ws'); await mkdir(dir)
  const source = join(root, 'bundled', 'alice-color'); await mkdir(source, { recursive: true })
  await writeFile(join(source, 'wave.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  await writeFile(join(source, 'pack.json'), JSON.stringify({ schemaVersion: 1, id: 'alice-color', name: 'Color', version: '1', stickers: [{ file: 'wave.png', description: 'Hello' }] }))
  const ws = { id: 'chat', tag: 'chat', template: 'chat', dir }
  const operationGuard = new WorkspaceOperationGuard()
  const app = createStickerRoutes({ operationGuard, registry: { list: () => [ws], get: (id: string) => id === 'chat' ? ws : undefined } } as unknown as WorkspaceService, new StickerPacks(join(root, 'data'), join(root, 'bundled')))
  const upload = new FormData()
  upload.set('id', 'custom'); upload.set('name', 'Custom'); upload.set('version', '1')
  for (const name of ['hello.png', 'bye.png']) upload.append('files', new File([Buffer.from('89504e470d0a1a0a', 'hex')], name, { type: 'image/png' }))
  upload.set('description:hello.png', 'A friendly hello')
  const imported = await app.request('/import', { method: 'POST', body: upload })
  expect(imported.status).toBe(200)
  expect((await imported.json()).stickers).toEqual([{ file: 'hello.png', description: 'A friendly hello' }, { file: 'bye.png', description: 'bye' }])
  const body = { enabled: true, packId: 'alice-color' }
  const post = (action: string, data: unknown) => app.request('/workspaces/chat/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const plan = await (await post('preview', body)).json()
  expect((await post('apply', { ...body, digest: plan.digest, restore: false })).status).toBe(200)
  const catalog = await (await app.request('/')).json()
  expect(catalog.workspaces[0].skillPresent).toBe(true)
  const lease = operationGuard.acquire('chat', 'offboard')!
  expect((await post('preview', body)).status).toBe(409)
  lease.release()
  expect((await app.request('/workspaces/unknown/preview', { method: 'POST' })).status).toBe(404)
})
