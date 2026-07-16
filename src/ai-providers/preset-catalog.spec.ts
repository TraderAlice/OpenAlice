import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_BY_VENDOR, GEMINI, LONGCAT } from './preset-catalog.js';
import { BUILTIN_PRESETS } from './presets.js';

describe('LONGCAT preset', () => {
  it('uses the versioned OpenAI base URL required by the OpenAI SDK', () => {
    expect(LONGCAT.regions?.[0]?.wires['openai-chat']).toBe('https://api.longcat.chat/openai/v1');
    const parsed = LONGCAT.zodSchema.parse({
      backend: 'vercel-ai-sdk',
      provider: 'openai-compatible',
      apiKey: 'test-key',
    }) as { baseUrl?: string };
    expect(parsed.baseUrl).toBe('https://api.longcat.chat/openai/v1');
  });
});

describe('credential form catalog', () => {
  it('offers current general-purpose Gemini tiers without mixing in media-only models', () => {
    expect(GEMINI.models?.map((model) => model.id)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]);
  });

  it('serializes provider-aware setup guidance for every API-key preset', () => {
    const apiKeyPresets = BUILTIN_PRESETS.filter((preset) => {
      const properties = preset.schema['properties'] as Record<string, unknown> | undefined;
      return !!properties?.['apiKey'];
    });

    expect(apiKeyPresets.length).toBeGreaterThan(0);
    for (const preset of apiKeyPresets) {
      expect(preset.setup, preset.id).toMatchObject({
        apiKeyLabel: expect.any(String),
        apiKeyHelp: expect.any(String),
        modelHelp: expect.any(String),
      });
    }
  });

  it('keeps each declared model default inside its suggestion catalog', () => {
    for (const preset of BUILTIN_PRESETS) {
      const properties = preset.schema['properties'] as Record<string, Record<string, unknown>> | undefined;
      const model = properties?.['model'];
      const defaultModel = model?.['default'];
      const suggestions = model?.['oneOf'] as Array<{ const: string }> | undefined;
      if (typeof defaultModel === 'string' && suggestions?.length) {
        expect(suggestions.map((option) => option.const), preset.id).toContain(defaultModel);
      }
    }
  });

  it('keeps injection fallbacks aligned with the model shown by the form', () => {
    const vendorByPreset: Record<string, string> = {
      'claude-api': 'anthropic',
      'codex-api': 'openai',
      gemini: 'google',
      minimax: 'minimax',
      glm: 'glm',
      kimi: 'kimi',
      deepseek: 'deepseek',
      longcat: 'longcat',
    };

    for (const [presetId, vendor] of Object.entries(vendorByPreset)) {
      const preset = BUILTIN_PRESETS.find((item) => item.id === presetId)!;
      const properties = preset.schema['properties'] as Record<string, Record<string, unknown>>;
      expect(DEFAULT_MODEL_BY_VENDOR[vendor], presetId).toBe(properties['model']?.['default']);
    }
  });
});
