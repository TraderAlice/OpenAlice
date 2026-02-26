import type { Operation } from '../wallet/types.js';
import type { SecHolding, SecAccountInfo } from '../interfaces.js';

/** Read-only context assembled by the pipeline, consumed by guards */
export interface SecGuardContext {
  readonly operation: Operation;
  readonly holdings: readonly SecHolding[];
  readonly account: Readonly<SecAccountInfo>;
}

/** A guard that can reject operations. Returns null to allow, or a rejection reason string. */
export interface SecOperationGuard {
  readonly name: string;
  check(ctx: SecGuardContext): Promise<string | null> | string | null;
}

/** Registry entry: type identifier + factory function */
export interface SecGuardRegistryEntry {
  type: string;
  create(options: Record<string, unknown>): SecOperationGuard;
}
