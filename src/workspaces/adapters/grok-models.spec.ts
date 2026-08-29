import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GROK_FIRST_PARTY_MODEL_IDS,
  GROK_FIRST_PARTY_MODELS,
} from './grok-models.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('Grok Build first-party model suggestions', () => {
  it('stays on the live grok.com CLI catalog, default first', () => {
    expect(GROK_FIRST_PARTY_MODEL_IDS).toEqual(['grok-4.6', 'grok-4.5']);
    expect(GROK_FIRST_PARTY_MODELS.some((model) => model.id === 'grok-build')).toBe(false);
  });

  it('keeps the Issue/launch copy on the same ids', () => {
    const ui = readFileSync(resolve(here, '../../../ui/src/lib/grok-models.ts'), 'utf8');
    const uiIds = [...ui.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
    expect(uiIds).toEqual([...GROK_FIRST_PARTY_MODEL_IDS]);
  });
});
