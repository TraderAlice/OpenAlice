/**
 * Securities Guard Pipeline
 *
 * Assembles a SecGuardContext from the engine, then passes it through the
 * guard chain. Guards themselves never see the engine.
 */

import type { Operation } from '../wallet/types.js';
import type { ISecuritiesTradingEngine } from '../interfaces.js';
import type { SecOperationGuard, SecGuardContext } from './types.js';

export function createSecGuardPipeline(
  dispatcher: (op: Operation) => Promise<unknown>,
  engine: ISecuritiesTradingEngine,
  guards: SecOperationGuard[],
): (op: Operation) => Promise<unknown> {
  if (guards.length === 0) return dispatcher;

  return async (op: Operation): Promise<unknown> => {
    const [holdings, account] = await Promise.all([
      engine.getPortfolio(),
      engine.getAccount(),
    ]);

    const ctx: SecGuardContext = { operation: op, holdings, account };

    for (const guard of guards) {
      const rejection = await guard.check(ctx);
      if (rejection != null) {
        return { success: false, error: `[guard:${guard.name}] ${rejection}` };
      }
    }

    return dispatcher(op);
  };
}
