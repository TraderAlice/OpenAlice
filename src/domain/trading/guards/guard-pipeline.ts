/**
 * Guard Pipeline
 *
 * The only place that touches the account: assembles a GuardContext,
 * then passes it through the guard chain. Guards themselves never
 * see the account.
 */

import type { Operation } from '../git/types.js'
import type { IBroker } from '../brokers/types.js'
import type { OperationGuard, GuardContext } from './types.js'

export function createGuardPipeline(
  dispatcher: (op: Operation) => Promise<unknown>,
  account: IBroker,
  guards: OperationGuard[],
): (op: Operation) => Promise<unknown> {
  if (guards.length === 0) return dispatcher

  return async (op: Operation): Promise<unknown> => {
    const [positions, accountInfo] = await Promise.all([
      account.getPositions(),
      account.getAccount(),
    ])

    const ctx: GuardContext = { operation: op, positions, account: accountInfo }

    for (const guard of guards) {
      const rejection = await guard.check(ctx)
      if (rejection != null) {
        return { success: false, error: `[guard:${guard.name}] ${rejection}` }
      }
    }

    const result = await dispatcher(op)

    // Notify all guards of success so they can update state (e.g. cooldown)
    if (result && typeof result === 'object' && (result as any).success !== false) {
      for (const guard of guards) {
        if (guard.onSuccess) {
          try {
            await guard.onSuccess(ctx)
          } catch (err) {
            console.error(`[guard:${guard.name}] onSuccess failed:`, err)
          }
        }
      }
    }

    return result
  }
}
