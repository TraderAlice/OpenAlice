/**
 * Guard Pipeline
 *
 * The only place that touches the engine: assembles a GuardContext,
 * then passes it through the guard chain. Guards themselves never
 * see the engine.
 */

import type { Operation } from '../wallet/types.js';
import type { ICryptoTradingEngine } from '../interfaces.js';
import type { OperationGuard, GuardContext } from './types.js';

export function createGuardPipeline(
  dispatcher: (op: Operation) => Promise<unknown>,
  engine: ICryptoTradingEngine,
  guards: OperationGuard[],
): (op: Operation) => Promise<unknown> {
  if (guards.length === 0) return dispatcher;

  return async (op: Operation): Promise<unknown> => {
    const [positions, account] = await Promise.all([
      engine.getPositions(),
      engine.getAccount(),
    ]);

    const ctx: GuardContext = { operation: op, positions, account };

    for (const guard of guards) {
      const rejection = await guard.check(ctx);
      if (rejection != null) {
        return { success: false, error: `[guard:${guard.name}] ${rejection}` };
      }
    }

    return dispatcher(op);
  };
}
