import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readClaudeInteractiveSetupStatus } from './claude.js';

describe('Claude interactive setup status', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir !== null) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  async function fixture(state?: unknown): Promise<{ home: string; cwd: string }> {
    tempDir = await mkdtemp(join(tmpdir(), 'claude-interactive-setup-'));
    const home = join(tempDir, 'home');
    const cwd = join(tempDir, 'workspace');
    await Promise.all([mkdir(home, { recursive: true }), mkdir(cwd, { recursive: true })]);
    if (state !== undefined) {
      await writeFile(join(home, '.claude.json'), JSON.stringify(state), 'utf8');
    }
    return { home, cwd };
  }

  it('reports native onboarding before Claude has created global state', async () => {
    const { home, cwd } = await fixture();

    await expect(readClaudeInteractiveSetupStatus(cwd, home))
      .resolves.toBe('runtime-onboarding-required');
  });

  it('reports native onboarding when Claude explicitly marks it incomplete', async () => {
    const { home, cwd } = await fixture({ hasCompletedOnboarding: false, projects: {} });

    await expect(readClaudeInteractiveSetupStatus(cwd, home))
      .resolves.toBe('runtime-onboarding-required');
  });

  it('reports per-project trust after global onboarding is complete', async () => {
    const { home, cwd } = await fixture({ hasCompletedOnboarding: true, projects: {} });

    await expect(readClaudeInteractiveSetupStatus(cwd, home))
      .resolves.toBe('workspace-trust-required');
  });

  it('reports ready only for the exact trusted workspace', async () => {
    const { home, cwd } = await fixture({
      hasCompletedOnboarding: true,
      projects: {
        [resolve('/somewhere-else')]: { hasTrustDialogAccepted: true },
      },
    });
    await expect(readClaudeInteractiveSetupStatus(cwd, home))
      .resolves.toBe('workspace-trust-required');

    await writeFile(join(home, '.claude.json'), JSON.stringify({
      hasCompletedOnboarding: true,
      projects: {
        [resolve(cwd)]: { hasTrustDialogAccepted: true },
      },
    }), 'utf8');

    await expect(readClaudeInteractiveSetupStatus(cwd, home)).resolves.toBe('ready');
  });

  it('fails open when Claude changes or corrupts its private state shape', async () => {
    const { home, cwd } = await fixture('{not-json');
    await writeFile(join(home, '.claude.json'), '{not-json', 'utf8');

    await expect(readClaudeInteractiveSetupStatus(cwd, home)).resolves.toBe('unknown');
  });

  it('does not guess when a known private-state field changes type', async () => {
    const { home, cwd } = await fixture({ hasCompletedOnboarding: 'yes', projects: {} });

    await expect(readClaudeInteractiveSetupStatus(cwd, home)).resolves.toBe('unknown');
  });
});
