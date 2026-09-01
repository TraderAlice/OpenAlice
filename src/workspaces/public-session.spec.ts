import { describe, expect, it } from 'vitest';

import { projectPublicSession } from './public-session.js';
import type { SessionRecord } from './session-registry.js';

const record: SessionRecord = {
  id: 'session-1',
  resumeId: 'resume-1',
  wsId: 'workspace-1',
  agent: 'claude',
  name: 'c1',
  createdAt: '2026-08-11T00:00:00.000Z',
  lastActiveAt: '2026-08-11T00:01:00.000Z',
  state: 'running',
  fallbackTitle: 'Investigate the market',
};

describe('projectPublicSession', () => {
  it('projects one Vault binding without exposing credential material', () => {
    expect(projectPublicSession(record, {
      runtimeBinding: {
        version: 1,
        credential: {
          source: 'vault',
          credentialSlug: 'deepseek-1',
          wireShape: 'openai-chat',
        },
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
      },
    })).toMatchObject({
      state: 'paused',
      title: 'Investigate the market',
      runtime: {
        credentialSource: 'vault',
        credentialSlug: 'deepseek-1',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
      },
    });
  });

  it('keeps missing historical runtime metadata unknown', () => {
    const projected = projectPublicSession(record);

    expect(projected).not.toHaveProperty('runtime');
  });

  it('derives live state and WebPi surface from the same process snapshot', () => {
    expect(projectPublicSession(record, {
      webPi: { pid: 42, startedAt: 1_723_337_000_000 },
    })).toMatchObject({
      state: 'running',
      surface: 'webpi',
      pid: 42,
      startedAt: 1_723_337_000_000,
    });
  });

  it('projects an active headless execution as the live Session surface', () => {
    expect(projectPublicSession({ ...record, surface: 'headless' }, {
      headless: true,
    })).toMatchObject({
      state: 'running',
      surface: 'headless',
      pid: null,
      startedAt: null,
    });
  });

  it('projects roster presence with the first Workspace payload', () => {
    expect(projectPublicSession(record, { presence: 'archived' })).toMatchObject({
      presence: 'archived',
    });
  });

  it('projects a coworker nametag without folding it into title', () => {
    expect(projectPublicSession(record, { displayName: 'AAPL desk' })).toMatchObject({
      displayName: 'AAPL desk',
      title: 'Investigate the market',
    });
  });

  it('projects structured Issue identity without mutating the stored launch title', () => {
    const scheduledPrompt = 'Run every instruction in the scheduled Issue body.';
    expect(projectPublicSession({
      ...record,
      surface: 'headless',
      fallbackTitle: scheduledPrompt,
    }, {
      createdBy: {
        kind: 'issue',
        workspaceId: 'workspace-1',
        issueId: 'daily-close-review',
        policy: 'new-then-resume',
        fire: 'schedule',
      },
    })).toMatchObject({ title: 'Daily Close Review' });
    expect(scheduledPrompt).toBe('Run every instruction in the scheduled Issue body.');
  });
});
