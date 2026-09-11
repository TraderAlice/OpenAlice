import { describe, expect, it } from 'vitest';

import {
  GROK_FIRST_PARTY_MODEL_IDS,
  GROK_FIRST_PARTY_MODELS,
} from './grok-models.js';

import { GROK_FIRST_PARTY_MODELS as UI_MODELS } from '../../../ui/src/lib/grok-models.js';

describe('Grok Build first-party model suggestions', () => {
  it('stays on the live grok.com CLI catalog, default first', () => {
    expect(GROK_FIRST_PARTY_MODEL_IDS).toEqual(['grok-4.6', 'grok-4.5']);
    expect(GROK_FIRST_PARTY_MODELS.some((model) => model.id === 'grok-build')).toBe(false);
  });

  it('shares the same models and effort semantics with the Issue/launch picker', () => {
    expect(UI_MODELS).toBe(GROK_FIRST_PARTY_MODELS);
    expect(UI_MODELS[0].semantics?.reasoning?.efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
  });
});
