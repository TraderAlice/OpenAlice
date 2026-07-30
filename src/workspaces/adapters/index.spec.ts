import { describe, expect, it } from 'vitest';

import { BUILTIN_ADAPTERS, createBuiltinAdapterRegistry } from './index.js';

describe('built-in adapter provider capabilities', () => {
  it('keeps provider semantics on each native runtime adapter', () => {
    const registry = createBuiltinAdapterRegistry();

    expect(registry.resolve(null).id).toBe('claude');
    expect(registry.list()).toEqual(BUILTIN_ADAPTERS);
    expect(registry.get('claude')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['anthropic'],
    });
    expect(registry.get('codex')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['openai-responses'],
    });
    expect(registry.get('opencode')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'workspace-required',
      defaultWire: 'openai-chat',
      modelRegistration: {
        contextWindow: true,
        reasoning: true,
        effortVariants: true,
      },
    });
    expect(registry.get('pi')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'workspace-required',
      defaultWire: 'openai-chat',
      modelRegistration: {
        contextWindow: true,
        reasoning: true,
      },
    });
    expect(registry.get('shell')?.capabilities.aiProvider).toBeUndefined();
  });
});
