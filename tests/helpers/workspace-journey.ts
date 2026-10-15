import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi, expect } from 'vitest'
import type { WorkspaceService } from '../../src/workspaces/service.js'

// Only the external model executable is replaced. Service, bootstrap, Git,
// execution admission, child process, output decoding and persisted stores run.
export async function workspaceJourney() {
  const root = await mkdtemp(join(tmpdir(), 'oa-product-journey-'))
  const saved = { ...process.env }
  for (const [key, value] of Object.entries({
    OPENALICE_HOME: root, AQ_LAUNCHER_ROOT: join(root, 'launcher'),
    OPENALICE_GLOBAL_DIR: join(root, 'global'), HOME: root, USERPROFILE: root,
  })) process.env[key] = value
  delete process.env.OPENALICE_CONNECTOR_URL
  vi.resetModules()
  const { createWorkspaceService } = await import('../../src/workspaces/service.js')
  let service: WorkspaceService
  const launch = async () => {
    vi.restoreAllMocks()
    service = await createWorkspaceService({ webPort: 0, mcpPort: 0,
      toolBaseUrl: 'http://127.0.0.1:0/cli', scheduleScannerIntervalMs: 600_000 })
    const adapter = service.adapters.get('codex')!
    // HOME is isolated as well; native model credentials are never inspected.
    if (adapter.lifecycle?.prepareWorkspace) vi.spyOn(adapter.lifecycle, 'prepareWorkspace').mockResolvedValue()
    return service
  }
  await launch()
  const fixture = (script?: string) => vi.spyOn(service.adapters.get('codex')!, 'composeHeadlessCommand').mockReturnValue([
    process.execPath, '-e', script ?? [
      'console.log(JSON.stringify({type:"thread.started",thread_id:"local-native-session"}))',
      'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"LOCAL_REPLY",phase:"final_answer"}}))',
      'console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}}))',
    ].join(';'),
  ])
  return {
    root, get service() { return service }, fixture,
    async restart() { await service.dispose('journey-restart'); return launch() },
    async settled(taskId: string, status = 'done') {
      await vi.waitFor(() => {
        const task = service.headlessTasks.get(taskId)!
        expect(task.status, task.error).toBe(status)
        expect(service.isResumeActive(task.resumeId)).toBe(false)
      }, { timeout: 15_000 })
      return service.headlessTasks.get(taskId)!
    },
    async close() {
      try { await service?.dispose('journey-cleanup') }
      finally {
        vi.restoreAllMocks(); vi.resetModules()
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
        Object.assign(process.env, saved)
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}
