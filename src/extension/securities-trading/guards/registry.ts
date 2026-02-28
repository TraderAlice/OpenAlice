import type { SecOperationGuard, SecGuardRegistryEntry } from './types.js';
import { SecCooldownGuard } from './cooldown.js';
import { SecMaxPositionSizeGuard } from './max-position-size.js';
import { SecSymbolWhitelistGuard } from './symbol-whitelist.js';

const builtinGuards: SecGuardRegistryEntry[] = [
  { type: 'max-position-size', create: (opts) => new SecMaxPositionSizeGuard(opts) },
  { type: 'cooldown',          create: (opts) => new SecCooldownGuard(opts) },
  { type: 'symbol-whitelist',  create: (opts) => new SecSymbolWhitelistGuard(opts) },
];

const registry = new Map<string, SecGuardRegistryEntry['create']>(
  builtinGuards.map(g => [g.type, g.create]),
);

/** Register a custom guard type (for third-party extensions) */
export function registerSecGuard(entry: SecGuardRegistryEntry): void {
  registry.set(entry.type, entry.create);
}

/** Resolve config entries into guard instances via the registry */
export function resolveSecGuards(
  configs: Array<{ type: string; options?: Record<string, unknown> }>,
): SecOperationGuard[] {
  const guards: SecOperationGuard[] = [];
  for (const cfg of configs) {
    const factory = registry.get(cfg.type);
    if (!factory) {
      console.warn(`sec guard: unknown type "${cfg.type}", skipped`);
      continue;
    }
    guards.push(factory(cfg.options ?? {}));
  }
  return guards;
}
