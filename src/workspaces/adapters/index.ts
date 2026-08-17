import { AdapterRegistry } from '../cli-adapter.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { agyAdapter } from './agy.js';
import { cursorAdapter } from './cursor.js';
import { grokAdapter } from './grok.js';
import { ompAdapter } from './omp.js';
import { opencodeAdapter } from './opencode.js';
import { piAdapter } from './pi.js';
import { shellAdapter } from './shell.js';

/**
 * One registration point for the native runtimes shipped with OpenAlice.
 * Adding an adapter here makes its declared capabilities available to the
 * launcher, config routes, and serialized `/agents` metadata.
 */
export const BUILTIN_ADAPTERS = [
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
  agyAdapter,
  grokAdapter,
  ompAdapter,
  opencodeAdapter,
  piAdapter,
  shellAdapter,
] as const;

export function createBuiltinAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  for (const adapter of BUILTIN_ADAPTERS) {
    registry.register(adapter, { default: adapter === claudeAdapter });
  }
  return registry;
}
