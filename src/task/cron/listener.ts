/**
 * Cron Listener — dispatches a cron fire into a headless Workspace run.
 *
 * A cron job is "run this prompt in that workspace, headless". On `cron.fire`
 * the listener resolves the job's target workspace + agent and calls
 * `WorkspaceService.dispatchHeadlessTask` (fire-and-forget; the agent reports
 * back via `inbox_push`, the launcher only tracks the run in the headless task
 * registry → Runs panel). It emits nothing onto the event tape.
 *
 * Concurrency is bounded by the headless task registry's own cap (it throws
 * HeadlessCapacityError when full), so there's no serial lock here — multiple
 * due jobs can dispatch in the same tick.
 *
 * Failures are LOUD, never silent: a job with no target workspace, a missing
 * workspace, a disabled agent, or a capacity rejection logs an error (and the
 * job simply doesn't run this fire). Migration 0008 disables pre-headless jobs
 * that have no workspaceId so they don't error on every interval.
 *
 * The WorkspaceService is reached through a ref-box because it's constructed
 * later than the cron wiring (inside the web plugin). `ref.current` is null
 * until the plugin has started; an early fire is a loud skip.
 */

import type { Listener } from '../../core/listener.js'
import type { ListenerRegistry } from '../../core/listener-registry.js'
import type { WorkspaceService } from '../../workspaces/service.js'

/** Headless run timeout per fire (matches the HTTP headless route's ceiling). */
const DEFAULT_HEADLESS_TIMEOUT_MS = 30 * 60_000

/** Structural ref-box; satisfied by the web plugin's WorkspaceServiceRef. */
export interface WorkspaceServiceBox {
  current: WorkspaceService | null
}

export interface CronDispatchLogger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface CronListenerOpts {
  /** Registry to auto-register this listener with. */
  registry: ListenerRegistry
  /** Box holding the WorkspaceService once the web plugin has constructed it. */
  workspaceServiceRef: WorkspaceServiceBox
  /** Headless run timeout per fire. */
  timeoutMs?: number
  /** Loud-failure sink; defaults to console. */
  logger?: CronDispatchLogger
}

export interface CronListener {
  start(): Promise<void>
  stop(): void
  readonly listener: Listener<'cron.fire'>
}

export function createCronListener(opts: CronListenerOpts): CronListener {
  const { registry, workspaceServiceRef } = opts
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HEADLESS_TIMEOUT_MS
  const log: CronDispatchLogger = opts.logger ?? {
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  }

  let registered = false

  const listener: Listener<'cron.fire'> = {
    name: 'cron-router',
    subscribes: 'cron.fire',
    async handle(entry): Promise<void> {
      const { jobId, jobName, payload, workspaceId, agent } = entry.payload
      const tag = `job ${jobId} (${jobName})`

      // Internal namespace reserved for Pump-owned services (heartbeat /
      // snapshot). Migration 0004 prunes these; this guard catches orphans.
      if (jobName.startsWith('__') && jobName.endsWith('__')) return

      if (!workspaceId) {
        log.error(`cron-dispatch: ${tag} has no target workspace — skipping. Assign a workspace + agent to this job.`)
        return
      }
      const svc = workspaceServiceRef.current
      if (!svc) {
        log.error(`cron-dispatch: workspace service not ready — ${tag} skipped this fire.`)
        return
      }
      const meta = svc.registry.get(workspaceId)
      if (!meta) {
        log.error(`cron-dispatch: ${tag} targets unknown workspace "${workspaceId}" — skipping.`)
        return
      }
      if (agent && !meta.agents.includes(agent)) {
        log.error(`cron-dispatch: ${tag} agent "${agent}" is not enabled on workspace "${workspaceId}" — skipping.`)
        return
      }
      const adapter = svc.resolveAdapter(meta, agent)
      if (!adapter.capabilities.headless) {
        log.error(`cron-dispatch: agent "${adapter.id}" has no headless mode — ${tag} skipped.`)
        return
      }

      try {
        const { taskId } = await svc.dispatchHeadlessTask(meta, adapter, payload, timeoutMs)
        log.info(`cron-dispatch: ${tag} → workspace "${meta.tag}" (${adapter.id}), headless task ${taskId}`)
      } catch (err) {
        log.error(`cron-dispatch: ${tag} dispatch failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }

  return {
    listener,
    async start() {
      if (registered) return
      registry.register(listener)
      registered = true
    },
    stop() {
      if (registered) {
        registry.unregister(listener.name)
        registered = false
      }
    },
  }
}
