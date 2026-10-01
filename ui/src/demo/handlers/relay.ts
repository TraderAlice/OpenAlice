import { delay, http, HttpResponse } from 'msw'
import type { MachineOperation, MachinePlan, MachinePlanInput } from '../../lib/updates/machine-types'

const defaultTarget = { machine: 'local', machineName: 'This computer', project: 'demo', projectName: 'Demo AliceProject' }
let target = readDemoTarget() ?? defaultTarget
let generation = 0
let demoOperation: MachineOperation | null = null
const plans = new Map<string, MachinePlan>()
let probeFailures = 0
let applyFailures = 0
// Capture once: the tab URL projector may remove query parameters after adoption.
const machineScenario = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('machineScenario')

function readDemoTarget(): typeof defaultTarget | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.sessionStorage.getItem('openalice.demo.relay-target') ?? 'null') as Partial<typeof defaultTarget> | null
    return value && typeof value.machine === 'string' && typeof value.project === 'string' && typeof value.machineName === 'string' && typeof value.projectName === 'string'
      ? value as typeof defaultTarget : null
  } catch { return null }
}

const machines = [
  {
    key: 'local', displayName: 'This computer', connection: 'local', cliVersion: '0.94.1-beta', issue: null,
    projects: [{ key: 'demo', id: 'demo-alice-project', displayName: 'Demo AliceProject', available: true, runtime: { class: 'running', state: 'ready', webEndpoint: 'http://127.0.0.1:47331' } }],
  },
  {
    key: 'studio', displayName: 'Studio Mac', connection: 'online', sshTarget: 'alice@studio-mac.local', cliVersion: '0.93.1', issue: null,
    projects: [
      { key: 'research', id: 'demo-research', displayName: 'Research desk', available: true, runtime: { class: 'running', state: 'ready', webEndpoint: 'http://127.0.0.1:47332' } },
      { key: 'drafts', id: 'demo-drafts', displayName: 'Drafts', available: true, runtime: { class: 'absent', state: 'stopped', webEndpoint: null } },
    ],
  },
]

export const relayHandlers = [
  http.get('/relay/v1/startup-target', () => HttpResponse.json({ target: { machine: target.machine, project: target.project }, error: null })),
  http.get('/relay/v1/status', () => HttpResponse.json({ schemaVersion: 1, generation, target, switching: false })),
  http.get('/relay/v1/fleet', async () => {
    await delay(900)
    return HttpResponse.json({ schemaVersion: 1, generatedAt: new Date().toISOString(), machines })
  }),
  http.post('/relay/v1/connect', async ({ request }) => {
    const input = await request.json() as { machine?: string; project?: string }
    const selected = machines.find((machine) => machine.key === input.machine)?.projects.find((project) => project.key === input.project)
    if (!selected?.runtime.webEndpoint) return HttpResponse.json({ error: 'Start this AliceProject first.' }, { status: 409 })
    target = { machine: input.machine!, machineName: machines.find((machine) => machine.key === input.machine)!.displayName, project: input.project!, projectName: selected.displayName }
    try { window.sessionStorage.setItem('openalice.demo.relay-target', JSON.stringify(target)) } catch { /* Demo can run without storage. */ }
    generation += 1
    return HttpResponse.json({ schemaVersion: 1, generation, target, switching: false })
  }),
  http.post('/relay/v1/machines/plan', async ({ request }) => {
    const input = await request.json() as MachinePlanInput
    await delay(700)
    if (input.mode === 'add' && machineScenario === 'probe-error' && probeFailures++ === 0) return HttpResponse.json({ error: 'Demo: Could not connect to the SSH target. Retry to simulate recovery.' }, { status: 502 })
    const machine = machines.find((entry) => entry.key === input.machineKey)
    const project = machine?.projects.find((entry) => entry.key === input.projectKey)
    const plan: MachinePlan = {
      id: crypto.randomUUID(), mode: input.mode,
      machine: { key: machine?.key ?? null, label: machine?.displayName ?? input.label ?? 'Cloud Linux', sshTarget: machine?.sshTarget ?? input.sshTarget ?? 'alice@cloud.example.com' },
      project: project ? { key: project.key, displayName: project.displayName } : null,
      platform: input.mode === 'add' ? 'Linux x64' : 'macOS arm64',
      activeVersion: input.mode === 'add' ? '0.94.1' : project?.runtime.class === 'absent' ? null : '0.93.1',
      installedVersion: input.mode === 'add' ? '0.94.1' : '0.93.1', targetVersion: '0.94.1',
      runtime: project?.runtime.class === 'absent' ? 'absent · none' : 'running · cli-server',
      actions: input.mode === 'add' ? [] : ['update remote OpenAlice CLI', project?.runtime.class === 'absent' ? 'start remote OpenAlice Server' : 'restart remote OpenAlice Server'],
      blocker: input.mode === 'add' && machineScenario === 'blocked' ? 'Demo: The remote Runtime is not compatible.' : null, deferredUpdate: false,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }
    plans.set(plan.id, plan)
    return HttpResponse.json(plan)
  }),
  http.get('/relay/v1/machines/operation', () => HttpResponse.json(demoOperation)),
  http.post('/relay/v1/machines/apply', async ({ request }) => {
    const { id } = await request.json() as { id: string }
    const plan = plans.get(id)
    if (!plan || plan.blocker || Date.parse(plan.expiresAt) < Date.now()) return HttpResponse.json({ error: 'Probe and review a fresh plan.' }, { status: 409 })
    if (demoOperation?.phase === 'running') return HttpResponse.json({ error: 'Another operation is running.' }, { status: 409 })
    plans.delete(id)
    demoOperation = { id: crypto.randomUUID(), planId: id, mode: plan.mode, phase: 'running', stage: 'checking', startedAt: new Date().toISOString(), error: null }
    const stages = plan.mode === 'add' ? ['verifying'] as const : ['installing', 'restarting', 'verifying'] as const
    for (const stage of stages) {
      await delay(900)
      demoOperation = { ...demoOperation, stage }
    }
    await delay(900)
    if (plan.mode === 'add' && machineScenario === 'apply-error' && applyFailures++ === 0) {
      demoOperation = { ...demoOperation, phase: 'failed', error: 'Demo: Verification failed. Review again to simulate recovery.' }
      return HttpResponse.json({ error: demoOperation.error }, { status: 502 })
    }
    const machineKey = plan.machine.key ?? `demo-${crypto.randomUUID()}`
    if (plan.mode === 'add') machines.push({
      key: machineKey, displayName: plan.machine.label, sshTarget: plan.machine.sshTarget,
      connection: 'online', cliVersion: plan.targetVersion, issue: null, projects: [],
    })
    demoOperation = { ...demoOperation, phase: 'succeeded' }
    return HttpResponse.json({ machineKey })
  }),
]

export function currentDemoRelayProject() {
  const selected = machines.find((machine) => machine.key === target.machine)?.projects.find((project) => project.key === target.project)
  return selected ? { id: selected.id, key: selected.key, displayName: selected.displayName } : { id: 'demo-alice-project', key: 'demo', displayName: 'Demo AliceProject' }
}
