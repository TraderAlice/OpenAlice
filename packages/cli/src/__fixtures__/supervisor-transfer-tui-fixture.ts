import { resolveLaunchContext } from '../launch-context.ts'
import type { MachineFleetEnvelope, MachineInventory } from '../machine-inventory.ts'
import type { ProjectTransferPlan } from '../project-transfer.ts'
import type { ProjectTransferReceipt } from '../project-transfer-stream.ts'
import { runSupervisorTui } from '../supervisor-tui.ts'

type Scenario =
  | 'default-no'
  | 'success'
  | 'auth-loss'
  | 'occupied'
  | 'checksum-retry'
  | 'cancel-retry'

const scenario = (process.env['OPENALICE_TUI_TRANSFER_SCENARIO'] ?? 'success') as Scenario
let sendCalls = 0
let aborted = false

const fleet: MachineFleetEnvelope = {
  schemaVersion: 1,
  generatedAt: '2026-08-23T00:00:00.000Z',
  machines: [
    machine('local', 'This computer', 'local', [project('source', 'Source Project', '/fixture/source')]),
    machine('cloud', 'Cloud fixture', 'online', [project('default', 'Remote Default', '/home/alice/.openalice')]),
  ],
}

const exitCode = await runSupervisorTui({}, {
  env: process.env,
  resolveContext: () => resolveLaunchContext({
    cwd: process.cwd(),
    homeDir: '/fixture',
    flags: { project: 'source', home: '/fixture/source' },
  }),
  inspect: async () => ({ class: 'absent', state: 'absent', owner: null, endpoints: {} }),
  inspectTransferSource: async () => ({ class: 'absent', state: 'absent', owner: null, endpoints: {} }),
  seedFleet: async () => fleet,
  inspectFleet: async () => fleet,
  loadMachineRegistry: async () => ({
    defaultMachine: 'local',
    machines: [{
      key: 'cloud',
      displayName: 'Cloud fixture',
      sshTarget: 'alice@example.test',
      isDefault: false,
    }],
  }),
  planProjectTransfer: async (input) => {
    if (scenario === 'auth-loss') throw new Error('SSH authentication required after destination selection.')
    if (scenario === 'occupied') throw new Error('Destination key or Home became occupied before planning.')
    return transferPlan(input.source.home, input.destinationHome, input.destinationProjectKey)
  },
  sendProjectTransfer: async (input) => {
    sendCalls += 1
    if (scenario === 'checksum-retry' && sendCalls === 1) {
      throw new Error('Synthetic checksum mismatch from remote receiver.')
    }
    if (scenario === 'cancel-retry' && sendCalls === 1) {
      await new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('Synthetic transfer cancellation acknowledged.'))
        }, { once: true })
      })
    }
    return receipt(input.plan)
  },
  discoverUpdate: async () => null,
  pollIntervalMs: 60_000,
})

process.stdout.write(`\nFIXTURE_RESULT scenario=${scenario} sends=${sendCalls} aborted=${aborted}\n`)
process.exitCode = exitCode

function project(key: string, displayName: string, home: string): MachineInventory['projects'][number] {
  return {
    key,
    id: `alice-project-${key}`,
    displayName,
    home,
    port: 47_331,
    portAutomatic: true,
    product: 'trader',
    isDefault: key === 'default',
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

function machine(
  key: string,
  displayName: string,
  connection: MachineInventory['connection'],
  projects: MachineInventory['projects'],
): MachineInventory {
  return {
    key,
    displayName,
    registered: key !== 'local',
    connection,
    sshTarget: key === 'local' ? null : 'alice@example.test',
    platform: key === 'local' ? process.platform : 'linux',
    arch: process.arch,
    hostname: key,
    cliVersion: 'fixture',
    defaultProject: projects[0]?.key ?? null,
    projects,
    capabilities: {
      inspect: true,
      lifecycle: true,
      openTunnel: true,
      transferReceive: key !== 'local',
      credentialReseal: key !== 'local',
    },
    issue: null,
  }
}

function transferPlan(sourceHome: string, destinationHome: string, destinationKey: string): ProjectTransferPlan {
  return {
    schemaVersion: 1,
    transferId: 'pty-transfer-fixture',
    generatedAt: '2026-08-23T00:00:00.000Z',
    source: {
      projectId: 'alice-project-source',
      key: 'source',
      displayName: 'Source Project',
      home: sourceHome,
      product: 'trader',
    },
    destination: {
      machineKey: 'cloud',
      projectId: 'alice-project-pty-destination',
      key: destinationKey,
      displayName: 'Source Project',
      home: destinationHome,
      requiredFreeBytes: 64 * 1024 * 1024,
    },
    policy: { credentials: 'omit', scheduledIssues: 'keep-blocked' },
    portable: { entries: [], files: 0, directories: 0, symlinks: 0, bytes: 0 },
    excluded: [{
      reason: 'session-plane',
      files: 3,
      bytes: 128,
      examples: ['workspaces/state/sessions'],
    }],
    credentials: {
      ai: { count: 0, vendors: [] },
      broker: { count: 0, presets: [] },
      connector: { count: 0, adapters: [] },
      providerKeys: { count: 0, vendors: [] },
    },
    scheduledIssues: [],
    blockers: [],
    readyToApply: true,
  }
}

function receipt(plan: ProjectTransferPlan): ProjectTransferReceipt {
  return {
    schemaVersion: 1,
    transferId: plan.transferId,
    sourceProjectId: plan.source.projectId,
    destinationProjectId: plan.destination.projectId,
    destinationHome: plan.destination.home,
    files: plan.portable.files,
    bytes: plan.portable.bytes,
    manifestSha256: 'a'.repeat(64),
    credentials: 'omitted',
    sessionsImported: 0,
    publishedAt: '2026-08-23T00:00:01.000Z',
  }
}
