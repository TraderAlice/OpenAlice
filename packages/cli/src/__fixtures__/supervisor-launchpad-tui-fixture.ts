import { resolveLaunchContext } from '../launch-context.ts'
import type { MachineFleetEnvelope, MachineInventory } from '../machine-inventory.ts'
import { runSupervisorTui } from '../supervisor-tui.ts'

let starts = 0
let opens = 0
let loads = 0
let diagnoses = 0
const running = process.env['OPENALICE_TUI_FIXTURE_RUNTIME'] === 'running'
const fleetRows = Number(process.env['OPENALICE_TUI_FIXTURE_FLEET_ROWS'] ?? 0)
const fleet = fleetRows > 0 ? fixtureFleet(fleetRows) : undefined

const exitCode = await runSupervisorTui({}, {
  env: process.env,
  resolveContext: () => resolveLaunchContext({
    cwd: process.cwd(),
    homeDir: '/fixture',
    flags: { project: 'default', home: '/fixture/default' },
  }),
  inspect: async () => running
    ? {
        class: 'running',
        state: 'ready',
        owner: { surface: 'cli-server', pid: 4242 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      }
    : { class: 'absent', state: 'absent', owner: null, endpoints: {} },
  start: async () => { starts += 1 },
  open: async () => { opens += 1 },
  readLogs: async () => {
    loads += 1
    return { entries: [] }
  },
  diagnose: async () => {
    diagnoses += 1
    return {
      overall: 'unknown',
      summary: { passed: 0, warnings: 0, failures: 0 },
      checks: [],
    }
  },
  ...(fleet
    ? {
        seedFleet: async () => fleet,
        inspectFleet: async () => fleet,
      }
    : {}),
  discoverUpdate: async () => null,
  pollIntervalMs: 60_000,
})

process.stdout.write(`\nFIXTURE_RESULT starts=${starts} opens=${opens} loads=${loads} diagnoses=${diagnoses}\n`)
process.exitCode = exitCode

function fixtureFleet(projectCount: number): MachineFleetEnvelope {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-02T00:00:00.000Z',
    machines: [{
      key: 'local',
      displayName: 'This computer',
      registered: true,
      connection: 'local',
      sshTarget: null,
      platform: 'darwin',
      arch: 'arm64',
      hostname: 'fixture',
      cliVersion: 'dev',
      defaultProject: 'default',
      projects: Array.from({ length: projectCount }, (_, index) => fixtureProject(index)),
      capabilities: {
        inspect: true,
        lifecycle: true,
        openTunnel: false,
        transferReceive: true,
        credentialReseal: true,
      },
      issue: null,
    }],
  }
}

function fixtureProject(index: number): MachineInventory['projects'][number] {
  const key = index === 0 ? 'default' : `local-${index + 1}`
  return {
    key,
    id: `alice-project-${key}`,
    displayName: index === 0 ? 'Default AliceProject' : `Local Project ${index + 1}`,
    home: `/fixture/${key}`,
    port: 47_331 + index,
    portAutomatic: true,
    product: 'trader',
    isDefault: index === 0,
    available: true,
    runtime: {
      class: 'absent',
      state: 'absent',
      ownerSurface: null,
      uptimeSeconds: null,
      webEndpoint: null,
      components: {},
    },
  }
}
