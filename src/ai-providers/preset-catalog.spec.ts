import { describe, expect, it } from 'vitest';

import {
  CLAUDE_API,
  CLAUDE_OAUTH,
  CODEX_API,
  CODEX_OAUTH,
  DEEPSEEK,
  DEFAULT_MODEL_BY_VENDOR,
  GEMINI,
  GLM,
  KIMI,
  LONGCAT,
  MINIMAX,
} from './preset-catalog.js';
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
  it('uses native Claude Code aliases for subscription profiles', () => {
    expect(CLAUDE_OAUTH.models?.map((model) => model.id)).toEqual([
      'default',
      'best',
      'opus',
      'sonnet',
      'haiku',
      'opusplan',
    ]);
    expect(CLAUDE_OAUTH.zodSchema.parse({
      backend: 'agent-sdk',
      loginMethod: 'claudeai',
    })).toMatchObject({ model: 'default' });
  });

  it('offers current Anthropic API tiers while keeping the latest Opus as the complex-agent default', () => {
    expect(CLAUDE_API.models?.map((model) => model.id)).toEqual([
      'claude-fable-5',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ]);
    expect(DEFAULT_MODEL_BY_VENDOR['anthropic']).toBe('claude-opus-5');
    expect(CLAUDE_API.models?.find((model) => model.id === 'claude-opus-5')?.semantics)
      .toMatchObject({
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        reasoning: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
      });
  });

  it('offers the GPT 5.6 family to Codex subscriptions and OpenAI API keys', () => {
    const expected = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4'];
    expect(CODEX_OAUTH.models?.map((model) => model.id)).toEqual(expected);
    expect(CODEX_API.models?.map((model) => model.id)).toEqual(expected);
    expect(DEFAULT_MODEL_BY_VENDOR['openai']).toBe('gpt-5.6-sol');
    expect(CODEX_OAUTH.models?.find((model) => model.id === 'gpt-5.6-sol')?.semantics)
      .toMatchObject({
        contextWindow: 272_000,
        reasoning: {
          efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
          defaultEffort: 'low',
        },
      });
    expect(CODEX_OAUTH.models?.find((model) => model.id === 'gpt-5.6-luna')?.semantics)
      .toMatchObject({
        reasoning: {
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultEffort: 'medium',
        },
      });
  });

  it('offers current general-purpose Gemini tiers without mixing in media-only models', () => {
    expect(GEMINI.models?.map((model) => model.id)).toEqual([
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]);
    expect(DEFAULT_MODEL_BY_VENDOR['google']).toBe('gemini-3.6-flash');
    expect(GEMINI.models?.find((model) => model.id === 'gemini-3.6-flash')?.semantics)
      .toMatchObject({
        contextWindow: 1_048_576,
        maxOutputTokens: 65_536,
        reasoning: { efforts: ['medium', 'high'], defaultEffort: 'medium' },
      });
  });

  it('offers the stable DeepSeek V4 API ids with registered semantics', () => {
    expect(DEEPSEEK.models?.map((model) => model.id)).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ]);
    expect(DEEPSEEK.models?.find((model) => model.id === 'deepseek-v4-flash')?.semantics)
      .toMatchObject({
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        reasoning: { efforts: ['low', 'high', 'max'], defaultEffort: 'high' },
      });
  });

  it('uses Kimi K3 as the Open Platform default while retaining current fallback tiers', () => {
    expect(KIMI.models?.map((model) => model.id)).toEqual([
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
      'kimi-k2.6',
    ]);
    expect(DEFAULT_MODEL_BY_VENDOR['kimi']).toBe('kimi-k3');
    expect(KIMI.models?.find((model) => model.id === 'kimi-k3')?.semantics).toEqual({
      contextWindow: 1_048_576,
      reasoning: {
        mode: 'required',
        efforts: ['low', 'high', 'max'],
        defaultEffort: 'max',
        interleaved: true,
      },
    });
  });

  it('pins the audited flagship default for every built-in API-key provider', () => {
    expect(DEFAULT_MODEL_BY_VENDOR).toEqual({
      anthropic: 'claude-opus-5',
      openai: 'gpt-5.6-sol',
      google: 'gemini-3.6-flash',
      minimax: 'MiniMax-M3',
      glm: 'glm-5.2',
      kimi: 'kimi-k3',
      deepseek: 'deepseek-v4-pro',
      longcat: 'LongCat-2.0',
    });
    expect(GLM.models?.map((model) => model.id)).toContain('glm-5.2');
  });

  it('offers MiniMax M3 as an adaptive 1M model without fabricated effort tiers', () => {
    expect(DEFAULT_MODEL_BY_VENDOR['minimax']).toBe('MiniMax-M3');
    expect(MINIMAX.models?.find((model) => model.id === 'MiniMax-M3')?.semantics).toEqual({
      contextWindow: 1_000_000,
      reasoning: { mode: 'adaptive', interleaved: true },
    });
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

  it('serializes rich semantics beside the backwards-compatible model oneOf', () => {
    const openai = BUILTIN_PRESETS.find((preset) => preset.id === 'codex-api')!;
    expect(openai.models?.find((model) => model.id === 'gpt-5.6-sol')?.semantics).toMatchObject({
      contextWindow: 1_050_000,
      reasoning: { mode: 'optional', defaultEffort: 'medium' },
    });
    const properties = openai.schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['model']?.['oneOf']).toEqual(expect.arrayContaining([
      expect.objectContaining({ const: 'gpt-5.6-sol' }),
    ]));
  });
});
