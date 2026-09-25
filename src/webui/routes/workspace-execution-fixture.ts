/** Route-test service double. Process lifecycle assertions belong to manager/service specs. */
import { vi } from 'vitest'

export function installExecutionFixture(service: any): any {
  const terminal = vi.fn(async (wsId: string, context: any) => {
    const child = service.pool.spawn(wsId, context)
    const exit = await child.waitForFirstExit?.(0)
    if (exit) throw new Error(`agent exited during startup (code=${exit.code})`)
    await service.sessionRegistry?.update?.(wsId, context.recordId, { state: 'running', surface: 'terminal' })
    return child
  })
  service.web ??= { has: vi.fn(() => false), get: vi.fn(() => null) }
  service.executions = {
    takeovers: { list: vi.fn(() => []), idleSeconds: 60, configure: vi.fn(), decide: vi.fn(), activity: vi.fn(), isHandingOff: vi.fn(() => false) },
    terminal,
    web: service.executeWeb ?? vi.fn(),
    wait: service.executeWait ?? vi.fn(),
    dispatch: service.executeDispatch ?? vi.fn(),
    list: vi.fn(() => []),
    stop: vi.fn(async (resumeId: string, reason: string) => {
      const record = service.sessionRegistry?.listAll?.().find((row: any) => row.resumeId === resumeId) ?? service.sessionRegistry?.get?.('', '')
      if (!record) return false
      await service.pool?.get?.(record.id)?.disposeAndWait?.(reason)
      await service.web?.stop?.(record.id, reason)
      await service.sessionRegistry.update(record.wsId, record.id, { state: 'paused' })
      return true
    }),
  }
  return service
}
