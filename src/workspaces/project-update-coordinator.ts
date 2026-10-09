import { applyBrokerPackUpdate, planBrokerPackUpdate, brokerPackUpdateJournal } from '../services/broker-packs/update-lifecycle.js'
import { isInstallableBrokerEngine } from '../core/broker-packs.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DiscoveryStore, createUpdatePlan, projectUpdateUnit, type UpdateProposal, type UpdateUnit, type UpdatePlan, type UpdateOperation, type UpdateOwner } from '@traderalice/update-lifecycle'
import { FileUpdateJournal } from '@traderalice/update-lifecycle/node'
import { dataPath } from '../core/paths.js'
import { getCurrentVersion } from '../core/version.js'
import { INSTALLABLE_BROKER_ENGINES } from '../core/broker-packs.js'
import { getBrokerPackLocalStatus } from '../services/broker-packs/installer.js'
import { aliceHarnessSourceVersion } from './alice-harness-assets.js'
import { readHarnessSource } from './harness-source.js'
import { exec as gitExec } from './git-execution.js'
import type { WorkspaceService } from './service.js'

/** Project authority. All child effects still enter their existing owner engine;
 * no renderer or relay acquires a second workspace scheduler. */
export class ProjectUpdateCoordinator {
  private readonly discovery = new DiscoveryStore<UpdateUnit[]>({ successTtlMs: 60_000, errorTtlMs: 10_000 })
  constructor(private readonly service: Pick<WorkspaceService, 'registry' | 'templates' | 'templateUpgrades' | 'aliceHarnessUpgrades' | 'sourceUpgrades'>,
    private readonly root = dataPath('update-operations')) {}
  async inventory(force = false): Promise<UpdateUnit[]> {
    const value = await this.discovery.check(() => this.collectInventory(), force)
    if (!value) throw new Error(this.discovery.getSnapshot().error ?? 'Inventory is unavailable')
    return value
  }
  async inventorySnapshot(force = false) {
    await this.discovery.check(() => this.collectInventory(), force)
    const { value, ...freshness } = this.discovery.getSnapshot()
    return { units: value ?? [], ...freshness }
  }
  private async collectInventory(selected?: ReadonlySet<string>): Promise<UpdateUnit[]> {
    const units: UpdateUnit[] = []
    const injection = !selected || [...selected].some(id => id.startsWith('alice-harness:')) ? await aliceHarnessSourceVersion() : null
    for (const workspace of this.service.registry.list()) {
      if (selected && ![...selected].some(id => id.slice(id.indexOf(':') + 1) === workspace.id)) continue
      const template = workspace.template ? this.service.templates.get(workspace.template) : undefined
      if (template?.upgradeStrategy === 'managed-context' && (!selected || selected.has(`template:${workspace.id}`))) {
        const installed = await this.service.templateUpgrades.currentVersion(workspace)
        units.push(projectUpdateUnit(`template:${workspace.id}`, 'template', workspace.dir, installed ? { version: installed } : null, template.version ? { version: template.version } : null))
      }
      if (template?.source && (!selected || selected.has(`source:${workspace.id}`))) {
        const receipt = await readHarnessSource(workspace.dir)
        const latest = receipt && await this.service.sourceUpgrades.latest(template.name, receipt.version, true)
        units.push(projectUpdateUnit(`source:${workspace.id}`, 'source', workspace.dir,
          receipt ? { version: receipt.version, commit: receipt.commit } : null,
          latest ? { version: latest.version, commit: latest.commit } : receipt ? { version: receipt.version, commit: receipt.commit } : { version: 'unknown' }))
      }
      if (!selected || selected.has(`alice-harness:${workspace.id}`)) {
        const injected = await this.service.aliceHarnessUpgrades.currentVersion(workspace)
        units.push(projectUpdateUnit(`alice-harness:${workspace.id}`, 'alice-harness', workspace.dir, injected ? { version: injected } : null, { version: injection! }))
      }
    }
    for (const engine of INSTALLABLE_BROKER_ENGINES) {
      if (selected && !selected.has(`pack:${engine}`)) continue
      const status = await getBrokerPackLocalStatus(engine)
      // Inventory missing optional engines without interpreting absence as update permission.
      units.push({ ...projectUpdateUnit(`pack:${engine}`, 'broker-pack', 'project-runtime', status.version ? { version: status.version } : null, { version: getCurrentVersion() }),
        active: null, operations: status.source === 'workspace' ? [] : status.installed ? ['update'] : ['install'], source: status.source })
    }
    return units
  }
  async plan(ids: string[]): Promise<UpdatePlan> {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('Select distinct project update units')
    const inventory = await this.collectInventory(new Set(ids))
    const proposals: UpdateProposal[] = []
    for (const id of ids) {
      const unit = inventory.find(u => u.id === id)
      if (!unit) throw new Error('Unknown project update unit')
      if (unit.owner === 'broker-pack') {
        const engine = id.slice(5)
        if (!isInstallableBrokerEngine(engine)) throw new Error('Unknown Pack')
        const pack = await planBrokerPackUpdate(engine)
        proposals.push({ ...pack.proposals[0]!, stages: ['apply', 'verify'], reference: { engine, plan: JSON.stringify(pack) }, after: ids.filter(other => !other.startsWith('pack:')) })
        continue
      }
      const workspaceId = id.slice(id.indexOf(':') + 1)
      const source = unit.owner === 'source'
      const plan = source ? await this.service.sourceUpgrades.plan(workspaceId, true, unit.desired!.version)
        : await (unit.owner === 'template' ? this.service.templateUpgrades : this.service.aliceHarnessUpgrades).plan(workspaceId)
      const conflicts = 'summary' in plan && plan.summary.conflicts > 0
      proposals.push({ unit: { ...unit, desired: { ...unit.desired!, revision: plan.planDigest } }, fingerprint: plan.planDigest,
        stages: ['apply', 'verify'], reference: { workspaceId, targetVersion: plan.toVersion },
        blockers: [...plan.blockers, ...('update' in plan && plan.update.status !== 'available' ? [plan.update.reason] : []), ...(conflicts ? ['Resolve managed-file conflicts in the Workspace review first'] : [])] })
    }
    return createUpdatePlan('project', proposals)
  }
  private journal(id: string): FileUpdateJournal {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid update operation identity')
    return new FileUpdateJournal(join(this.root, id), 'project')
  }
  async approve(plan: UpdatePlan, fingerprint: string, id = randomUUID()): Promise<UpdateOperation> {
    const refreshed = await this.plan(plan.proposals.map(p => p.unit.id))
    if (refreshed.fingerprint !== fingerprint || plan.fingerprint !== fingerprint) throw new Error('Project update review is stale')
    return this.journal(id).approve(refreshed, fingerprint, id)
  }
  status(id: string): Promise<UpdateOperation | null> { return this.journal(id).read() }
  resume(id: string): Promise<UpdateOperation> { return this.journal(id).run(this.owner()) }
  private owner(): UpdateOwner {
    const receipt = async (proposal: UpdateProposal) => {
      const workspace = this.service.registry.get(proposal.reference!.workspaceId!)
      if (!workspace) throw new Error('The approved Workspace is no longer available')
      const git = await gitExec(['rev-parse', '--absolute-git-dir'], workspace.dir)
      if (git.exitCode) throw new Error('Cannot locate Workspace transaction receipts')
      const journal = new FileUpdateJournal(join(String(git.stdout).trim(), 'openalice-updates'), proposal.unit.id)
      const child = await journal.read()
      if (child?.plan.proposals[0]?.fingerprint !== proposal.fingerprint) return null
      if (child.phase === 'succeeded') return child.completed[child.plan.steps[0]!.id]?.receipt ?? null
      // The engine may have committed, then lost the response/journal write.
      // Only its exact commit trailer proves this plan, not version equality.
      const message = await gitExec(['log', '-1', '--pretty=%B'], workspace.dir)
      if (String(message.stdout).includes(`OpenAlice-Template-Upgrade: ${proposal.fingerprint}`) || String(message.stdout).includes(`OpenAlice-Source-Upgrade: ${proposal.fingerprint}`)) {
        const head = await gitExec(['rev-parse', 'HEAD'], workspace.dir)
        return String(head.stdout).trim()
      }
      return null
    }
    return {
      reconcile: async (step, p, op) => {
        if (p.unit.owner === 'broker-pack') {
          const engine = p.reference!.engine!
          if (!isInstallableBrokerEngine(engine)) throw new Error('Unknown Pack')
          const child = await brokerPackUpdateJournal(engine).read()
          return child?.phase === 'succeeded' && child.plan.proposals[0]!.fingerprint === p.fingerprint ? { status: 'complete', receipt: child.id } : { status: 'ready' }
        }
        const completed = await receipt(p)
        if (completed) return { status: 'complete', receipt: completed }
        if (step.stage === 'verify') return { status: 'unknown', reason: 'The Workspace owner has not proved completion of the approved files' }
        const workspaceId = p.reference!.workspaceId!
        const current = p.unit.owner === 'source'
          ? await this.service.sourceUpgrades.plan(workspaceId, true, p.reference!.targetVersion!)
          : await (p.unit.owner === 'template' ? this.service.templateUpgrades : this.service.aliceHarnessUpgrades).plan(workspaceId)
        if (current.blocked) return { status: 'blocked', reason: current.blockers.join(', ') }
        if (current.planDigest !== p.fingerprint) return { status: 'unknown', reason: 'Workspace files or delivered source changed; review the owner transaction before continuing' }
        return { status: 'ready' }
      },
      execute: async (_step, p) => {
        if (p.unit.owner === 'broker-pack') {
          const engine = p.reference!.engine!
          if (!isInstallableBrokerEngine(engine)) throw new Error('Unknown Pack')
          const child = await applyBrokerPackUpdate(engine, JSON.parse(p.reference!.plan!))
          return child.phase === 'succeeded' ? { status: 'complete', receipt: child.id } : { status: child.phase === 'recovery' ? 'unknown' : 'waiting', reason: child.error ?? 'Pack activation pending' }
        }
        const workspaceId = p.reference!.workspaceId!
        const result = p.unit.owner === 'source'
          ? await this.service.sourceUpgrades.apply(workspaceId, true, { planDigest: p.fingerprint, targetVersion: p.reference!.targetVersion! })
          : await (p.unit.owner === 'template' ? this.service.templateUpgrades : this.service.aliceHarnessUpgrades).apply(workspaceId, { planDigest: p.fingerprint })
        return { status: 'complete', receipt: result.commit }
      },
    }
  }
}
