import type { Operation } from '../wallet/types.js';
import type { CryptoPosition, CryptoAccountInfo } from '../interfaces.js';

/** Read-only context assembled by the pipeline, consumed by guards */
export interface GuardContext {
  readonly operation: Operation;
  readonly positions: readonly CryptoPosition[];
  readonly account: Readonly<CryptoAccountInfo>;
}

/** A guard that can reject operations. Returns null to allow, or a rejection reason string. */
export interface OperationGuard {
  readonly name: string;
  check(ctx: GuardContext): Promise<string | null> | string | null;
}

/** Registry entry: type identifier + factory function */
export interface GuardRegistryEntry {
  type: string;
  create(options: Record<string, unknown>): OperationGuard;
}
