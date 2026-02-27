import type { OperationGuard, GuardRegistryEntry } from './types.js';
import { MaxPositionSizeGuard } from './max-position-size.js';
import { MaxLeverageGuard } from './max-leverage.js';
import { CooldownGuard } from './cooldown.js';
import { SymbolWhitelistGuard } from './symbol-whitelist.js';

const builtinGuards: GuardRegistryEntry[] = [
  { type: 'max-position-size', create: (opts) => new MaxPositionSizeGuard(opts) },
  { type: 'max-leverage',      create: (opts) => new MaxLeverageGuard(opts) },
  { type: 'cooldown',          create: (opts) => new CooldownGuard(opts) },
  { type: 'symbol-whitelist',  create: (opts) => new SymbolWhitelistGuard(opts) },
];

const registry = new Map<string, GuardRegistryEntry['create']>(
  builtinGuards.map(g => [g.type, g.create]),
);

/** Register a custom guard type (for third-party extensions) */
export function registerGuard(entry: GuardRegistryEntry): void {
  registry.set(entry.type, entry.create);
}

/** Resolve config entries into guard instances via the registry */
export function resolveGuards(
  configs: Array<{ type: string; options?: Record<string, unknown> }>,
): OperationGuard[] {
  const guards: OperationGuard[] = [];
  for (const cfg of configs) {
    const factory = registry.get(cfg.type);
    if (!factory) {
      console.warn(`guard: unknown type "${cfg.type}", skipped`);
      continue;
    }
    guards.push(factory(cfg.options ?? {}));
  }
  return guards;
}
