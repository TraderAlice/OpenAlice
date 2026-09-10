import { describe, expect, it } from 'vitest'
import { createMemoryInboxStore } from '../../core/inbox-store.js'
import { createInboxRoutes } from './inbox.js'

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
