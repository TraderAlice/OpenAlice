import { http, HttpResponse } from 'msw'
import { DEMO_CHAT_WORKSPACE_ID } from '../fixtures/workspaces'
import type { StickerCatalog } from '../../hooks/useStickerPacks'
const catalog: StickerCatalog = { defaultPackId: 'demo-color', packs: [{ id: 'demo-color', name: 'Demo expressions', version: '1.0.0', revision: '1.0.0+demo', source: 'builtin', stickers: [{ file: 'wave.png', description: 'Hello' }] }], workspaces: [{ id: DEMO_CHAT_WORKSPACE_ID, name: 'Chat', state: null, skillPresent: false, changed: [] }] }
export const stickerHandlers = [
  http.get('/api/workspaces/stickers', () => HttpResponse.json(catalog)),
  http.get('/api/workspaces/stickers/packs/:id/:file', () => HttpResponse.redirect('/office/coworkers/codex-portrait-v2.png')),
  http.put('/api/workspaces/stickers/default', async ({ request }) => { const body = await request.json() as { packId: string }; catalog.defaultPackId = body.packId; return HttpResponse.json({ ok: true }) }),
  http.post('/api/workspaces/stickers/import', async ({ request }) => { const form = await request.formData(); const pack = { ...catalog.packs[0], id: String(form.get('id')), name: String(form.get('name')), version: String(form.get('version')), source: 'imported' as const }; catalog.packs.push(pack); return HttpResponse.json(pack) }),
  http.post('/api/workspaces/stickers/workspaces/:id/preview', () => HttpResponse.json({ digest: 'demo', revision: '1.0.0+demo', conflicts: [], files: ['sticker/wave.png', '.agents/skills/alice-stickers/SKILL.md', '.claude/skills/alice-stickers/SKILL.md'] })),
  http.post('/api/workspaces/stickers/workspaces/:id/apply', async ({ request }) => { const body = await request.json() as { enabled: boolean; packId: string }; catalog.workspaces[0].state = { ...body, revision: '1.0.0+demo' }; catalog.workspaces[0].skillPresent = body.enabled; return HttpResponse.json(catalog.workspaces[0].state) }),
]
