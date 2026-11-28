import { describe, expect, it } from 'vitest'
import { createMemoryInboxStore } from '../../../src/core/inbox-store.js'
import { createInboxRoutes } from '../../../src/webui/routes/inbox.js'

describe('inbox routes', () => {
  it('marks entries read and unread through HTTP', async () => {
    const inboxStore = createMemoryInboxStore()
    const entry = await inboxStore.append({
      workspaceId: 'ws-1',
      body: 'done'
    })
    const app = createInboxRoutes({ inboxStore })

    const readRes = await app.request(`/${entry.id}/read`, { method: 'PUT' })
    expect(readRes.status).toBe(200)
    const readBody = await readRes.json() as { ok: true; id: string; readAt: number }
    expect(readBody.id).toBe(entry.id)
    expect(readBody.readAt).toBeGreaterThan(0)

    let history = await (await app.request('/history')).json() as {
      entries: Array<{ id: string; readAt?: number }>
    }
    expect(history.entries[0]).toMatchObject({ id: entry.id, readAt: readBody.readAt })

    const unreadRes = await app.request(`/${entry.id}/read`, { method: 'DELETE' })
    expect(unreadRes.status).toBe(200)

    history = await (await app.request('/history')).json() as {
      entries: Array<{ id: string; readAt?: number }>
    }
    expect(history.entries[0]).toEqual({
      id: entry.id,
      ts: entry.ts,
      workspaceId: 'ws-1',
      body: 'done'
    })
  })

  it('returns 404 when marking a missing entry', async () => {
    const app = createInboxRoutes({ inboxStore: createMemoryInboxStore() })
    expect((await app.request('/missing/read', { method: 'PUT' })).status).toBe(404)
    expect((await app.request('/missing/read', { method: 'DELETE' })).status).toBe(404)
  })
})

it('resolves inline files in the publisher Workspace and serves only the stored reference index', async () => {
  const { mkdtemp, mkdir, writeFile, rm, symlink } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const home = await mkdtemp(join(tmpdir(), 'inbox-http-files-'))
  try {
    const source = join(home, 'source'); await mkdir(source)
    await writeFile(join(source, 'report.md'), '# Source report')
    await writeFile(join(home, 'secret.md'), 'private')
    await symlink(join(home, 'secret.md'), join(source, 'escape.md'))
    const inboxStore = createMemoryInboxStore()
    const entry = await inboxStore.append({ workspaceId: 'publisher', body: 'Before [[report.md]] after [[missing.pdf]] [[escape.md]] `[[example.md]]`' })
    const app = createInboxRoutes({ inboxStore, resolveWorkspace: id => id === 'publisher' ? { dir: source } : undefined })
    const metadata = await (await app.request(`/${entry.id}/files`)).json()
    expect(metadata.files.map((file: { path: string; available: boolean }) => [file.path, file.available])).toEqual([
      ['report.md', true], ['missing.pdf', false], ['escape.md', false],
    ])
    const response = await app.request(`/${entry.id}/files/0?workspaceId=other`)
    expect(await response.text()).toBe('# Source report')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    for (const index of ['1', '2', '3', '-1']) expect((await app.request(`/${entry.id}/files/${index}`)).status).toBe(404)
    expect((await inboxStore.get(entry.id))?.body).toBe(entry.body)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('bulk marks every existing unread across pages and workspaces, preserves exclusions and future arrivals', async () => {
  const inboxStore = createMemoryInboxStore()
  for (let i = 0; i < 125; i++) await inboxStore.append({ workspaceId: `ws-${i % 2}`, body: `report ${i}` })
  const app = createInboxRoutes({ inboxStore })
  const page = await (await app.request('/history?limit=100&workspaceId=ws-1')).json()
  expect(page.unreadCount).toBe(125)
  const protectedId = page.entries[0].id
  const response = await app.request('/read-all', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ excludeIds: [protectedId] }) })
  const result = await response.json()
  expect(response.status).toBe(200)
  expect(result.ids).toHaveLength(124)
  expect(result.unreadCount).toBe(1)
  const arrival = await inboxStore.append({ workspaceId: 'new', body: 'new arrival' })
  expect((await inboxStore.get(arrival.id))?.readAt).toBeUndefined()
  expect((await inboxStore.get(protectedId))?.readAt).toBeUndefined()
  expect((await inboxStore.read()).unreadCount).toBe(2)
  const repeat = await inboxStore.markAllRead([protectedId, arrival.id])
  expect(repeat.ids).toEqual([])
  expect((await inboxStore.read({ limit: 200 })).entries).toHaveLength(126)
})

it('rejects malformed bulk requests without changing read state', async () => {
  const inboxStore = createMemoryInboxStore()
  await inboxStore.append({ workspaceId: 'ws', body: 'report' })
  const app = createInboxRoutes({ inboxStore })
  for (const body of ['null', '{}', '{"excludeIds":[1]}', 'bad json']) {
    expect((await app.request('/read-all', { method: 'PUT', body })).status).toBe(400)
  }
  expect((await inboxStore.read()).unreadCount).toBe(1)
})

it('supports ETag / 304 Not Modified on history, files, and file bytes and invalidates on updates', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const home = await mkdtemp(join(tmpdir(), 'inbox-http-etag-'))
  try {
    const source = join(home, 'source')
    await mkdir(source)
    await writeFile(join(source, 'report.md'), '# v1')
    const inboxStore = createMemoryInboxStore()
    const entry = await inboxStore.append({ workspaceId: 'ws', body: 'See [[report.md]]' })
    const app = createInboxRoutes({ inboxStore, resolveWorkspace: () => ({ dir: source }) })

    // /history ETag -> 304 -> mutated -> 200 with new ETag (also works with gzip Accept-Encoding)
    const h1 = await app.request('/history?limit=20', { headers: { 'Accept-Encoding': 'gzip' } })
    expect(h1.status).toBe(200)
    const hEtag = h1.headers.get('etag')
    expect(hEtag).toBeTruthy()
    const h304 = await app.request('/history?limit=20', {
      headers: { 'If-None-Match': hEtag!, 'Accept-Encoding': 'gzip' },
    })
    expect(h304.status).toBe(304)

    await inboxStore.markRead(entry.id)
    const h2 = await app.request('/history?limit=20', { headers: { 'If-None-Match': hEtag! } })
    expect(h2.status).toBe(200)
    expect(h2.headers.get('etag')).not.toBe(hEtag)

    // /:id/files ETag -> 304 + includes file size
    const f1 = await app.request(`/${entry.id}/files`)
    expect(f1.status).toBe(200)
    const fEtag = f1.headers.get('etag')
    const fBody = await f1.json() as { files: Array<{ path: string; size?: number }> }
    expect(fBody.files[0]?.size).toBe(4)
    expect((await app.request(`/${entry.id}/files`, { headers: { 'If-None-Match': fEtag! } })).status).toBe(304)

    // /:id/files/0 ETag -> 304 -> file modified -> 200
    const b1 = await app.request(`/${entry.id}/files/0`)
    expect(b1.status).toBe(200)
    expect(b1.headers.get('cache-control')).toBe('private, no-cache')
    const bEtag = b1.headers.get('etag')
    expect((await app.request(`/${entry.id}/files/0`, { headers: { 'If-None-Match': bEtag! } })).status).toBe(304)

    await writeFile(join(source, 'report.md'), '# v2 updated')
    const b2 = await app.request(`/${entry.id}/files/0`, { headers: { 'If-None-Match': bEtag! } })
    expect(b2.status).toBe(200)
    expect(await b2.text()).toBe('# v2 updated')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
