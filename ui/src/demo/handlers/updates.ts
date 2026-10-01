import { createUpdatePlan, approveUpdate, UpdateCoordinator, projectUpdateUnit, type UpdateOperation, type UpdatePlan } from '@traderalice/update-lifecycle'
import { http, HttpResponse } from 'msw'
import { DEMO_AUTO_QUANT_WORKSPACE_ID, DEMO_AUTO_PREDICTION_WORKSPACE_ID, DEMO_CHAT_WORKSPACE_ID, demoChatWorkspace, demoWorkspaces } from '../fixtures/workspaces'

export const demoProjectUpdatesReady = typeof location !== 'undefined' && new URLSearchParams(location.search).get('updates') === 'ready'
if (demoProjectUpdatesReady) Object.assign(demoChatWorkspace, { upgradeAvailable: { from: '0.1.0', to: '0.2.0' } })
let preferences = {
  autoCheckApp: true,
  autoUpdateAutoQuant: true,
  autoUpdateAutoPrediction: true,
}
// Deliberately blocked by the seeded running Quant Session. Toggling auto
// application does not make the observable upstream release disappear.
export const demoHarnessSourceCandidate = {
  fromVersion: 'v0.8.31', toVersion: 'v0.8.32', verified: false,
  toCommit: 'b'.repeat(40),
}
const snapshot = () => ({ preferences, workspaces: [
  { workspaceId: DEMO_CHAT_WORKSPACE_ID, template: 'chat', checkedAt: new Date().toISOString(),
    fromVersion: demoChatWorkspace.currentVersion ?? '0.1.0',
    ...(demoChatWorkspace.upgradeAvailable ? { phase: 'available', toVersion: demoChatWorkspace.upgradeAvailable.to } : { phase: 'current' }) },
  { workspaceId: DEMO_AUTO_QUANT_WORKSPACE_ID, template: 'auto-quant-v2', checkedAt: new Date().toISOString(),
    fromVersion: demoHarnessSourceCandidate.fromVersion,
    ...(demoProjectUpdatesReady ? { phase: 'current' } : {
      phase: preferences.autoUpdateAutoQuant ? 'blocked' : 'available',
      toVersion: demoHarnessSourceCandidate.toVersion, verified: demoHarnessSourceCandidate.verified,
      ...(preferences.autoUpdateAutoQuant ? { reason: 'active_runtime' } : {}),
    }) },
  { workspaceId: DEMO_AUTO_PREDICTION_WORKSPACE_ID, template: 'auto-prediction', phase: 'current', checkedAt: new Date().toISOString(),
    fromVersion: demoWorkspaces.find(workspace => workspace.id === DEMO_AUTO_PREDICTION_WORKSPACE_ID)?.harnessSource?.version },
] })

let clientPreferences = { autoCheck: true }
const clientSnapshot = () => ({
  kind: 'cli', currentVersion: '0.94.1-beta.2', preferences: clientPreferences,
  discovery: { value: { status: 'current', currentVersion: '0.94.1-beta.2', channel: 'beta' },
    checking: false, error: null, checkedAt: Date.now(), succeededAt: Date.now() },
})
let operation: UpdateOperation | null = null
const injection = projectUpdateUnit('alice-harness:demo-ws', 'alice-harness', 'demo', { version: '1' }, { version: '2' })
const inventory = [injection, projectUpdateUnit(`template:${DEMO_CHAT_WORKSPACE_ID}`, 'template', 'demo', { version: '0.1.0' }, { version: '0.2.0' }), projectUpdateUnit(`source:${DEMO_AUTO_QUANT_WORKSPACE_ID}`, 'source', 'demo', { version: 'v0.8.31' }, { version: 'v0.8.32' })]
export const updatesHandlers = [
  http.get('/api/updates/inventory', () => HttpResponse.json({ units: inventory, capabilities: { 'project-updates': 1 } })),
  http.get('/relay/v1/updates/operation', () => HttpResponse.json(operation)),
  http.post('/relay/v1/updates/abandon', () => { operation = null; return HttpResponse.json({ ok: true }) }),
  http.post('/relay/v1/updates/review', async ({ request }) => {
    const input = await request.json() as { backend: boolean; projectUnits: string[] }
    if (input.projectUnits.some(id => !inventory.some(unit => unit.id === id))) return HttpResponse.json({ error: 'Unknown project content' }, { status: 400 })
    const proposals = input.projectUnits.map(id => ({ unit: inventory.find(u => u.id === id)!, fingerprint: id.startsWith('template:') ? 'demo-template-upgrade-plan' : id.startsWith('source:') ? `demo-source-${id.slice(7)}` : 'demo-exact-files', stages: ['apply', 'verify'] as const, blockers: id.startsWith('source:') && !demoProjectUpdatesReady ? ['active_runtime'] : [] }))
    if (input.backend) proposals.unshift({ unit: projectUpdateUnit('backend', 'remote', 'demo', { version: '0.94.0' }, { version: '0.94.1' }), fingerprint: 'demo-release', blockers: [], stages: ['apply', 'verify'] })
    return HttpResponse.json(createUpdatePlan('demo', proposals.map(p => ({ ...p, stages: [...p.stages] }))))
  }),
  http.post('/relay/v1/updates/approve', async ({ request }) => {
    const input = await request.json() as { plan: UpdatePlan; fingerprint: string }
    operation = approveUpdate(input.plan, input.fingerprint, 'demo-operation', new Date().toISOString())
    return HttpResponse.json(operation)
  }),
  http.post('/relay/v1/updates/resume', async () => {
    if (operation) await new UpdateCoordinator({ read: async () => operation, write: async next => { operation = next } }, {
      reconcile: async () => ({ status: 'ready' }), execute: async step => ({ status: 'complete', receipt: `demo:${step.id}` }),
    }).run()
    if (operation?.phase === 'succeeded') for (const p of operation.plan.proposals) { const unit = inventory.find(u => u.id === p.unit.id); if (unit) unit.installed = unit.desired; const workspace = demoWorkspaces.find(workspace => unit?.id === `template:${workspace.id}`); if (workspace) Object.assign(workspace, { currentVersion: unit!.desired!.version, upgradeAvailable: null }) }
    return HttpResponse.json({ accepted: true })
  }),
  http.get('/relay/v1/updates', () => HttpResponse.json(clientSnapshot())),
  http.post('/relay/v1/updates/check', () => HttpResponse.json(clientSnapshot())),
  http.post('/relay/v1/updates/activate', () => HttpResponse.json({ accepted: true }, { status: 202 })),
  http.put('/relay/v1/updates/preferences', async ({ request }) => {
    const body = await request.json() as { autoCheck?: unknown }
    if (typeof body?.autoCheck !== 'boolean') return HttpResponse.json({ error: 'invalid_preferences' }, { status: 400 })
    clientPreferences = { autoCheck: body.autoCheck }
    return HttpResponse.json(clientSnapshot())
  }),
  http.post('/api/updates/activate', () => HttpResponse.json({ accepted: true }, { status: 202 })),
  http.get('/api/updates', () => HttpResponse.json(snapshot())),
  http.post('/api/updates/check', () => HttpResponse.json(snapshot())),
  http.get('/api/preferences/updates', () => HttpResponse.json(preferences)),
  http.put('/api/preferences/updates', async ({ request }) => {
    const body = await request.json().catch(() => null) as typeof preferences | null
    if (!body || Object.values(body).some(value => typeof value !== 'boolean')) {
      return HttpResponse.json({ error: 'invalid_update_preferences' }, { status: 400 })
    }
    preferences = body
    return HttpResponse.json(preferences)
  }),
]
