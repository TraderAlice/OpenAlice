import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { NewsModuleRegistry } from './registry.js'
import { NewsWorkerHost, NewsModuleRequestError } from './host.js'
import { NewsModuleState, checkpointIdentity } from './state.js'
import { createNewsWorkerLaunch } from './launch.js'
import {
  moduleSelectionSchema, subscriptionSchema,
  type ModuleSelection, type NewsSubscription, type NewsModuleArtifact,
  type InstalledModule, type ModuleStatus, type NewsCheckpoint,
} from './contract.js'

type Identity = { moduleId: string; version: string; contentHash: string; abiVersion: 1 | 2; credentialKeys: string[] }
export class NewsModuleValidationError extends Error {
  constructor() { super('Invalid module configuration; approve the exact artifact before enabling'); this.name = 'NewsModuleValidationError' }
}
export class NewsModuleActivationError extends Error {
  constructor() { super('Module failed its startup contract'); this.name = 'NewsModuleActivationError' }
}
export class NewsModuleManager {
  private readonly registry: NewsModuleRegistry
  private readonly launch: { command: string; args: string[] }
  private selections: ModuleSelection[] = []
  private subscriptions: NewsSubscription[] = []
  private workers = new Map<string, NewsWorkerHost>()
  private identities = new Map<string, Identity>()
  private readonly state: NewsModuleState

  constructor(opts: { directory: string; launch?: { command: string; args: string[] } }) {
    this.registry = new NewsModuleRegistry(opts.directory)
    this.state = new NewsModuleState(opts.directory)
    this.launch = opts.launch ?? createNewsWorkerLaunch()
  }

  private failurePath(hash: string): string {
    return join(this.registry.directory, '.failed-' + hash + '.json')
  }

  private async failed(hash: string): Promise<boolean> {
    try { await readFile(this.failurePath(hash)); return true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw new Error('Module failure state unavailable')
    }
  }

  private async quarantine(hash: string): Promise<void> {
    await mkdir(this.registry.directory, { recursive: true })
    await writeFile(this.failurePath(hash), JSON.stringify({ failed: true }), { mode: 0o600 })
  }

  private host(hash: string): NewsWorkerHost {
    return new NewsWorkerHost(this.registry.directory, hash, this.launch, () => this.quarantine(hash))
  }

  async importArtifact(value: unknown): Promise<InstalledModule> { return this.registry.importArtifact(value) }
  async approve(hash: string): Promise<InstalledModule> { return this.registry.approve(hash) }

  private async credentialDefinitions(hash: string) {
    const artifact = await this.registry.read(hash)
    if (!await this.registry.approved(hash) || artifact.manifest.abiVersion !== 2) throw new Error('Approve the exact v2 artifact before binding credentials')
    return artifact.manifest.credentials
  }
  async credentialStatus(hash: string) {
    const definitions = await this.credentialDefinitions(hash)
    return Promise.all(definitions.map(async definition => {
      try { return { ...definition, configured: !!await this.state.credential(hash, definition.key), available: true } }
      catch { return { ...definition, configured: true, available: false } }
    }))
  }
  async setCredential(hash: string, key: string, value: string): Promise<void> {
    if (!(await this.credentialDefinitions(hash)).some(definition => definition.key === key)) throw new Error('Unknown module credential')
    await this.state.setCredential(hash, key, value)
  }
  async clearCredential(hash: string, key: string): Promise<void> {
    if (!(await this.credentialDefinitions(hash)).some(definition => definition.key === key)) throw new Error('Unknown module credential')
    await this.state.clearCredential(hash, key)
  }
  async commitCheckpoint(row: NewsSubscription, checkpoint: NewsCheckpoint): Promise<void> {
    const identity = await this.identity(row.moduleId)
    if (identity.abiVersion !== 2) throw new Error('Checkpoint requires a v2 module')
    await this.state.commitCheckpoint(checkpointIdentity(identity.contentHash, row), checkpoint)
  }
  private loadedIdentity(hash: string, artifact: NewsModuleArtifact): Identity {
    const manifest = artifact.manifest
    return { moduleId: manifest.moduleId, version: manifest.version, contentHash: hash, abiVersion: manifest.abiVersion, credentialKeys: manifest.abiVersion === 2 ? manifest.credentials.map(value => value.key) : [] }
  }

  async list(selections: ModuleSelection[] = this.selections, enabled = true): Promise<ModuleStatus[]> {
    const entries = await this.registry.list()
    const statuses: ModuleStatus[] = []
    for (const entry of entries) {
      const selection = selections.find(selected => selected.contentHash === entry.contentHash)
      const loaded = this.workers.get(entry.contentHash)?.isLoaded() ?? false
      let failed = !entry.manifest || (!!this.workers.get(entry.contentHash) && !loaded) || (enabled && selection?.enabled === true && entry.approved && !loaded)
      try { failed ||= await this.failed(entry.contentHash) } catch { failed = true }
      const state = !entry.manifest ? 'invalid' : loaded ? 'running' : failed ? 'failed' : !entry.approved ? 'unapproved' : 'disabled'
      statuses.push({
        ...entry, moduleId: entry.manifest?.moduleId ?? selection?.moduleId ?? null,
        installed: true, desiredEnabled: selection?.enabled ?? false,
        loaded, loadedHash: loaded ? entry.contentHash : null, state,
        lastError: state === 'invalid' ? 'Module manifest unavailable' : failed ? 'Module unavailable; explicit retry required' : null,
      })
    }
    for (const selection of selections) {
      if (entries.some(entry => entry.contentHash === selection.contentHash)) continue
      statuses.push({
        moduleId: selection.moduleId, manifest: null, contentHash: selection.contentHash,
        installed: false, approved: false, desiredEnabled: selection.enabled,
        loaded: false, loadedHash: null, state: 'missing', lastError: 'Selected module artifact is not installed on this backend',
      })
    }
    return statuses
  }

  private async validateCandidate(selections: ModuleSelection[], subscriptions: NewsSubscription[]): Promise<Map<string, NewsModuleArtifact>> {
    const selected = selections.map(selection => moduleSelectionSchema.parse(selection))
    const rows = subscriptions.map(row => subscriptionSchema.parse(row))
    if (new Set(selected.map(selection => selection.moduleId)).size !== selected.length || new Set(rows.map(row => row.id)).size !== rows.length) {
      throw new Error('Duplicate module or subscription identity')
    }
    const artifacts = new Map<string, NewsModuleArtifact>()
    for (const selection of selected) {
      let artifact: NewsModuleArtifact
      try { artifact = await this.registry.read(selection.contentHash) }
      catch {
        const retained = this.selections.some(old => old.moduleId === selection.moduleId && old.contentHash === selection.contentHash && old.enabled === selection.enabled)
        // Missing or corrupt retained state is editable, but never eligible for execution.
        if (!selection.enabled || retained) continue
        throw new Error('Selected module artifact is unavailable')
      }
      if (artifact.manifest.moduleId !== selection.moduleId) throw new Error('Module identity mismatch')
      if (selection.enabled && !await this.registry.approved(selection.contentHash)) throw new Error('Approve the exact module artifact before enabling')
      artifacts.set(selection.contentHash, artifact)
    }
    for (const row of rows) {
      const selection = selected.find(selected => selected.moduleId === row.moduleId)
      const artifact = selection && artifacts.get(selection.contentHash)
      if (!artifact) continue
      const source = artifact.manifest.sources.find(source => source.key === row.sourceKey)
      if (!source) throw new Error('Unknown module source')
      for (const key of Object.keys(row.params)) {
        if (!source.parameters.some(parameter => parameter.key === key)) throw new Error('Unknown module parameter')
      }
      for (const parameter of source.parameters) {
        const value = row.params[parameter.key]
        if (value === undefined) {
          if (parameter.required) throw new Error('Required module parameter missing')
        } else if (typeof value !== parameter.type || (parameter.required && value === '')) {
          throw new Error('Invalid module parameter')
        }
      }
    }
    return artifacts
  }

  async validate(selections: ModuleSelection[], subscriptions: NewsSubscription[]): Promise<Map<string, NewsModuleArtifact>> {
    try { return await this.validateCandidate(selections, subscriptions) }
    catch { throw new NewsModuleValidationError() }
  }

  async configure(selections: ModuleSelection[], subscriptions: NewsSubscription[], tolerateStartupFailure = false): Promise<void> {
    const artifacts = tolerateStartupFailure ? null : await this.validate(selections, subscriptions)
    const wanted = new Set(selections.filter(selection => selection.enabled).map(selection => selection.contentHash))
    // Stop before importing replacements: even module top-level code must not overlap.
    for (const [hash, worker] of this.workers) {
      if (wanted.has(hash)) continue
      try { await worker.stop() }
      catch { await this.quarantine(hash); throw new Error('Module stop failed; replacement blocked') }
      this.workers.delete(hash)
      this.identities.delete(hash)
    }
    this.selections = selections.map(selection => moduleSelectionSchema.parse(selection))
    this.subscriptions = subscriptions.map(row => subscriptionSchema.parse(row))
    for (const selection of this.selections.filter(selection => selection.enabled)) {
      let worker: NewsWorkerHost | undefined
      try {
        if (this.workers.has(selection.contentHash) || await this.failed(selection.contentHash)) continue
        if (tolerateStartupFailure && await this.registry.isAbsent(selection.contentHash)) continue
        const validated = artifacts ?? await this.validate([selection], this.subscriptions.filter(row => row.moduleId === selection.moduleId))
        const artifact = validated.get(selection.contentHash)
        if (!artifact) continue
        worker = this.host(selection.contentHash)
        this.workers.set(selection.contentHash, worker)
        await worker.start(this.registry.entry(selection.contentHash, artifact), artifact.manifest.moduleId, artifact.manifest.version, artifact.manifest.abiVersion)
        if (!worker.isLoaded()) throw new Error('Module startup failed')
        this.identities.set(selection.contentHash, this.loadedIdentity(selection.contentHash, artifact))
      } catch {
        await this.quarantine(selection.contentHash)
        // A stop failure cannot be treated as an isolated, safely-ended startup failure.
        if (worker) await worker.stop()
        this.workers.delete(selection.contentHash)
        this.identities.delete(selection.contentHash)
        if (!tolerateStartupFailure) throw new NewsModuleActivationError()
      }
    }
  }

  async collect(row: NewsSubscription) {
    const selection = this.selections.find(selection => selection.moduleId === row.moduleId && selection.enabled)
    if (!selection) throw new Error('Module disabled or not installed')
    const worker = this.workers.get(selection.contentHash)
    if (!worker?.isLoaded()) throw new Error('Module unavailable; explicit retry required')
    const identity = await this.identity(row.moduleId)
    let context: { checkpoint: NewsCheckpoint; credentials: Record<string, string> } | undefined
    if (identity.abiVersion === 2) {
      const credentials: Record<string, string> = {}
      for (const key of identity.credentialKeys) {
        const value = await this.state.credential(selection.contentHash, key)
        if (!value) throw new Error('Configure the approved news module credential before collection')
        credentials[key] = value
      }
      context = { credentials, checkpoint: await this.state.checkpoint(checkpointIdentity(selection.contentHash, row)) }
    }
    try { return await worker.collect(row, context) }
    catch (error) {
      if (error instanceof NewsModuleRequestError) throw error
      await this.quarantine(selection.contentHash)
      await worker.stop()
      this.workers.delete(selection.contentHash)
      this.identities.delete(selection.contentHash)
      throw new Error('Module collection failed; explicit retry required')
    }
  }

  async identity(moduleId: string): Promise<Identity> {
    const selected = this.selections.find(selection => selection.moduleId === moduleId)
    const identity = selected && this.identities.get(selected.contentHash)
    if (!identity || !this.workers.get(identity.contentHash)?.isLoaded()) throw new Error('Module identity unavailable')
    return identity
  }

  async retry(hash: string): Promise<void> {
    const selection = this.selections.find(selection => selection.contentHash === hash && selection.enabled)
    if (!selection) throw new Error('Enable the module before retrying')
    const artifacts = await this.validate([selection], this.subscriptions.filter(row => row.moduleId === selection.moduleId))
    const artifact = artifacts.get(hash)
    if (!artifact) throw new Error('Selected module artifact is unavailable')
    const existing = this.workers.get(hash)
    if (existing) await existing.stop()
    else await this.host(hash).recover()
    this.workers.delete(hash)
    this.identities.delete(hash)
    await rm(this.failurePath(hash), { force: true })
    const worker = this.host(hash)
    this.workers.set(hash, worker)
    try {
      await worker.start(this.registry.entry(hash, artifact), artifact.manifest.moduleId, artifact.manifest.version, artifact.manifest.abiVersion)
      this.identities.set(hash, this.loadedIdentity(hash, artifact))
    } catch {
      await this.quarantine(hash)
      await worker.stop()
      this.workers.delete(hash)
      throw new Error('Module retry failed')
    }
  }

  async uninstall(hash: string): Promise<void> {
    if (this.selections.some(selection => selection.contentHash === hash)) throw new Error('Remove the selected module version before uninstalling')
    const worker = this.workers.get(hash)
    if (worker) await worker.stop()
    await this.host(hash).recover()
    this.workers.delete(hash)
    this.identities.delete(hash)
    await this.state.clearArtifactCredentials(hash)
    await this.registry.uninstall(hash)
    await rm(this.failurePath(hash), { force: true })
  }

  async close(): Promise<void> {
    let failed = false
    for (const [hash, worker] of this.workers) {
      try { await worker.stop(); this.workers.delete(hash); this.identities.delete(hash) }
      catch { failed = true; await this.quarantine(hash) }
    }
    if (failed) throw new Error('Module shutdown failed')
  }
}
