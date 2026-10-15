import { defaultProcessController, listDescendantPids, terminateProcessTree } from '@traderalice/guardian-runtime'

/** Retain descendants across attempts, even if the wrapper exits first. */
export function sessionProcessStop(pid: number, gracefulMs = 5000): () => Promise<void> {
  const targets = new Set([pid])
  let stopping: Promise<void> | undefined
  return () => {
    if (stopping) return stopping
    stopping = (async () => {
      const root = [...targets].find(target => defaultProcessController.isAlive(target))
      if (root === undefined) return
      await terminateProcessTree(root, { gracefulMs, controller: {
        ...defaultProcessController,
        signalTree: async (target, signal, known) => {
          for (const child of await listDescendantPids(target)) targets.add(child)
          const found = await defaultProcessController.signalTree(target, signal, [...targets, ...(known ?? [])])
          for (const child of found ?? []) targets.add(child)
          return [...targets]
        },
      } })
    })().finally(() => { stopping = undefined })
    return stopping
  }
}

export class SessionTerminationError extends Error {
  constructor(message: string, readonly retry: () => Promise<void>) { super(message) }
}
