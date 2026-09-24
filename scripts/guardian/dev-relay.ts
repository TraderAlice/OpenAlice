import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import { WebRelay } from '../../packages/cli/src/web-relay.js'
import { inspectLocalMachine, inspectMachineFleet, type MachineInventory } from '../../packages/cli/src/machine-inventory.js'
import { readSupervisorAliceProjectRegistry } from '../../packages/cli/src/supervisor-config.js'
import { resolveSupervisorRootPath } from '../../packages/cli/src/launch-context.js'

interface DevRelayConfig {
  home: string
  projectId: string
  projectName: string
  backendPort: number
  uiPort: number
  vitePort: number
}

/** Keep an isolated `pnpm dev -- --home …` selectable without persisting it in the user's registry. */
export async function createDevRelay(config: DevRelayConfig): Promise<WebRelay> {
  const supervisorRoot = resolveSupervisorRootPath()
  const base = await readSupervisorAliceProjectRegistry({ supervisorRoot })
  const existing = base.projects.find((project) => resolve(project.home) === resolve(config.home) && project.id === config.projectId)
  const suffix = createHash('sha256').update(resolve(config.home)).digest('hex').slice(0, 8)
  const devKey = existing?.key ?? `dev_${suffix}`
  const loadRegistry = async () => {
    const registry = await readSupervisorAliceProjectRegistry({ supervisorRoot })
    const project = {
      key: devKey,
      id: config.projectId,
      displayName: config.projectName,
      home: resolve(config.home),
      port: config.backendPort,
      portAutomatic: false,
      isDefault: registry.defaultProject === devKey,
    }
    return {
      ...registry,
      projects: [...registry.projects.filter((entry) => entry.key !== devKey), project],
    }
  }
  const patchLocal = (machine: MachineInventory): MachineInventory => ({
    ...machine,
    projects: machine.projects.map((project) => project.key === devKey
      ? { ...project, runtime: { ...project.runtime, webEndpoint: `http://127.0.0.1:${config.backendPort}` } }
      : project),
  })
  const options = { loadRegistry }
  const relay = new WebRelay({
    port: config.uiPort,
    uiOrigin: `http://127.0.0.1:${config.vitePort}`,
    inspectLocal: async () => {
      const inventory = await inspectLocalMachine(options)
      return { ...inventory, machine: patchLocal(inventory.machine) }
    },
    inspectFleet: async () => {
      const inventory = await inspectMachineFleet(options)
      return { ...inventory, machines: inventory.machines.map((machine) => machine.key === 'local' ? patchLocal(machine) : machine) }
    },
  })
  try {
    await relay.listen()
    await relay.connect('local', devKey)
    return relay
  } catch (error) {
    await relay.close().catch(() => undefined)
    throw error
  }
}
