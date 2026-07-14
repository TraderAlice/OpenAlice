import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exec as gitExec } from 'dugite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Logger } from './logger.js';
import { TemplateRegistry, type TemplateMeta } from './template-registry.js';
import {
  TemplateUpgradeError,
  TemplateUpgradeManager,
  initializeWorkspaceTemplateState,
  isManagedTemplatePath,
  type TemplateSnapshot,
} from './template-upgrade.js';
import { WorkspaceRegistry, type WorkspaceMeta } from './workspace-registry.js';

const logger = {
  debug() {}, info() {}, warn() {}, error() {}, event() {}, child() { return this; },
} as unknown as Logger;

let root: string;
let workspace: WorkspaceMeta;
let registry: WorkspaceRegistry;
let template: TemplateMeta;
let incoming: TemplateSnapshot;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'template-upgrade-'));
  const dir = join(root, 'workspaces', 'chat-old');
  await mkdir(join(dir, '.agents', 'skills', 'alice'), { recursive: true });
  await writeFile(join(dir, 'README.md'), 'template readme v1\n');
  await writeFile(join(dir, 'AGENTS.md'), 'template agents v1\n');
  await writeFile(join(dir, 'CLAUDE.md'), 'template claude v1\n');
  await writeFile(join(dir, '.agents', 'skills', 'alice', 'SKILL.md'), 'skill v1\n');
  await git(dir, ['init', '-q']);
  await git(dir, ['add', '.']);
  await git(dir, ['-c', 'user.email=test@local', '-c', 'user.name=test', 'commit', '-q', '-m', 'root']);
  workspace = {
    id: 'chat-old',
    tag: 'old',
    dir,
    createdAt: '2026-01-01T00:00:00.000Z',
    template: 'chat',
    spawnedFromVersion: '1.0.0',
    agents: ['pi'],
  };
  registry = await WorkspaceRegistry.load(join(root, 'workspaces.json'), logger);
  await registry.add(workspace);
  template = {
    name: 'chat',
    displayName: 'Chat',
    bootstrapScript: '/unused/bootstrap.mjs',
    filesDir: '/unused/files',
    templateDir: '/unused',
    version: '2.0.0',
    defaultAgents: ['pi'],
    injectTools: true,
    injectPersona: true,
    bundledSkills: [],
    upgradeStrategy: 'managed-context',
  };
  incoming = {
    'README.md': file('template readme v2\n'),
    'AGENTS.md': file('template agents v2\n'),
    'CLAUDE.md': file('template claude v1\n'),
    '.agents/skills/alice/SKILL.md': file('skill v2\n'),
    '.agents/skills/new/SKILL.md': file('new skill\n'),
  };
});

afterEach(async () => rm(root, { recursive: true, force: true }));

describe('TemplateUpgradeManager', () => {
  it('classifies incoming updates, local customizations, dual edits, and additions', async () => {
    await writeFile(join(workspace.dir, 'AGENTS.md'), 'workspace agents\n');
    await writeFile(join(workspace.dir, 'CLAUDE.md'), 'workspace claude\n');
    incoming = {
      ...incoming,
      'AGENTS.md': file('template agents v2\n'),
      'CLAUDE.md': file('template claude v1\n'),
    };
    const plan = await manager().plan(workspace.id);
    expect(plan).toMatchObject({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      source: 'legacy-root-commit',
      summary: { ready: 3, preserved: 1, conflicts: 1 },
    });
    expect(plan.files.find((entry) => entry.path === 'README.md')?.status).toBe('ready');
    expect(plan.files.find((entry) => entry.path === 'AGENTS.md')?.status).toBe('conflict');
    expect(plan.files.find((entry) => entry.path === 'CLAUDE.md')?.status).toBe('preserved');
    expect(plan.files.find((entry) => entry.path === '.agents/skills/new/SKILL.md')?.operation).toBe('add');
  });

  it('shows Workspace-only managed files as preserved customizations', async () => {
    const localOnly = join(workspace.dir, '.agents', 'skills', 'local-only', 'SKILL.md');
    await mkdir(join(localOnly, '..'), { recursive: true });
    await writeFile(localOnly, 'workspace-owned skill\n');

    const plan = await manager().plan(workspace.id);

    expect(plan.files.find((entry) => entry.path === '.agents/skills/local-only/SKILL.md'))
      .toMatchObject({ status: 'preserved', operation: 'keep' });
  });

  it('refuses to replace managed files through a symlinked parent', async ({ skip }) => {
    const external = join(root, 'external-skills');
    await mkdir(external, { recursive: true });
    await rm(join(workspace.dir, '.agents'), { recursive: true, force: true });
    try {
      await symlink(external, join(workspace.dir, '.agents'), 'dir');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') skip('symlinks unavailable on this runner');
      throw err;
    }

    const plan = await manager().plan(workspace.id);
    const skill = plan.files.find((entry) => entry.path === '.agents/skills/alice/SKILL.md');
    expect(skill).toMatchObject({ status: 'conflict', canUseTemplate: false });
    await expect(manager().apply(workspace.id, {
      planDigest: plan.planDigest,
      resolutions: { '.agents/skills/alice/SKILL.md': 'template' },
    })).rejects.toMatchObject({ code: 'invalid_resolution' } satisfies Partial<TemplateUpgradeError>);
  });

  it('applies only selected template paths, preserves local work, and records an isolated commit', async () => {
    await writeFile(join(workspace.dir, 'AGENTS.md'), 'workspace agents\n');
    await writeFile(join(workspace.dir, 'notes.md'), 'unrelated local work\n');
    const upgrade = manager();
    const plan = await upgrade.plan(workspace.id);
    const result = await upgrade.apply(workspace.id, {
      planDigest: plan.planDigest,
      resolutions: { 'AGENTS.md': 'workspace' },
    });
    expect(result.changedPaths).toContain('README.md');
    expect(result.keptPaths).toContain('AGENTS.md');
    expect(await readFile(join(workspace.dir, 'README.md'), 'utf8')).toBe('template readme v2\n');
    expect(await readFile(join(workspace.dir, 'AGENTS.md'), 'utf8')).toBe('workspace agents\n');
    expect(await readFile(join(workspace.dir, 'notes.md'), 'utf8')).toBe('unrelated local work\n');
    expect(await git(workspace.dir, ['show', '--pretty=', '--name-only', 'HEAD'])).not.toContain('notes.md');
    expect(await git(workspace.dir, ['log', '-1', '--pretty=%s'])).toContain('upgrade 1.0.0 -> 2.0.0');
    expect(await upgrade.currentVersion(workspace)).toBe('2.0.0');
    const refreshed = await upgrade.plan(workspace.id);
    expect(refreshed.source).toBe('recorded-baseline');
    expect(refreshed.files.find((entry) => entry.path === 'AGENTS.md')?.status).toBe('preserved');
  });

  it('rejects stale previews and staged user changes without mutating files', async () => {
    const upgrade = manager();
    const plan = await upgrade.plan(workspace.id);
    await writeFile(join(workspace.dir, 'README.md'), 'changed after preview\n');
    await expect(upgrade.apply(workspace.id, { planDigest: plan.planDigest }))
      .rejects.toMatchObject({ code: 'stale_plan' } satisfies Partial<TemplateUpgradeError>);
    await writeFile(join(workspace.dir, 'staged.md'), 'staged\n');
    await git(workspace.dir, ['add', 'staged.md']);
    const blocked = await upgrade.plan(workspace.id);
    expect(blocked.blockers).toContain('staged_changes');
  });

  it('blocks live Workspaces before preparing a transaction', async () => {
    const upgrade = manager(true);
    const plan = await upgrade.plan(workspace.id);
    expect(plan.blockers).toEqual(['active_sessions']);
    await expect(upgrade.apply(workspace.id, { planDigest: plan.planDigest }))
      .rejects.toMatchObject({ code: 'busy' } satisfies Partial<TemplateUpgradeError>);
  });

  it('allows only one apply transaction per Workspace', async () => {
    const upgrade = manager();
    const plan = await upgrade.plan(workspace.id);
    const first = upgrade.apply(workspace.id, { planDigest: plan.planDigest });
    await expect(upgrade.apply(workspace.id, { planDigest: plan.planDigest }))
      .rejects.toMatchObject({ code: 'busy' } satisfies Partial<TemplateUpgradeError>);
    await expect(first).resolves.toMatchObject({ toVersion: '2.0.0' });
  });

  it('records a creation baseline outside Git and uses it for future plans', async () => {
    template = { ...template, version: '1.0.0' };
    await initializeWorkspaceTemplateState(workspace, template);

    expect(JSON.parse(await readFile(
      join(workspace.dir, '.alice', 'template-upgrade', 'state.json'),
      'utf8',
    ))).toMatchObject({
      template: 'chat',
      appliedVersion: '1.0.0',
      source: 'creation',
    });
    expect(await readFile(
      join(workspace.dir, '.alice', 'template-upgrade', 'baseline.json.gz'),
    )).not.toHaveLength(0);
    expect(await git(workspace.dir, ['status', '--short', '--untracked-files=all'])).toBe('');

    template = { ...template, version: '2.0.0' };
    const plan = await manager().plan(workspace.id);
    expect(plan.source).toBe('recorded-baseline');
    expect(plan.fromVersion).toBe('1.0.0');
  });

  it('rolls files and the index back when the isolated upgrade commit fails', async () => {
    const headBefore = (await git(workspace.dir, ['rev-parse', 'HEAD'])).trim();
    const hook = join(workspace.dir, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    const upgrade = manager();
    const plan = await upgrade.plan(workspace.id);

    await expect(upgrade.apply(workspace.id, { planDigest: plan.planDigest }))
      .rejects.toThrow(/git commit exited/);

    expect(await readFile(join(workspace.dir, 'README.md'), 'utf8')).toBe('template readme v1\n');
    expect(await readFile(join(workspace.dir, 'AGENTS.md'), 'utf8')).toBe('template agents v1\n');
    expect(await git(workspace.dir, ['status', '--short', '--untracked-files=all'])).toBe('');
    expect((await git(workspace.dir, ['rev-parse', 'HEAD'])).trim()).toBe(headBefore);
    await expect(readFile(join(workspace.dir, '.alice', 'template-upgrade', 'transaction', 'journal.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('materializes the real Chat template deterministically before cleaning its temp tree', async () => {
    const templates = await TemplateRegistry.load(
      join(process.cwd(), 'src', 'workspaces', 'templates'),
      logger,
    );
    const upgrade = new TemplateUpgradeManager({ registry, templates, logger });
    const plans = await Promise.all(Array.from({ length: 4 }, () => upgrade.plan(workspace.id)));
    expect(new Set(plans.map((plan) => plan.planDigest)).size).toBe(1);
    for (const plan of plans) {
      expect(plan.files.find((entry) => entry.path === 'README.md')?.templatePreview)
        .toContain('# Chat');
      expect(plan.files.some((entry) => entry.path.startsWith('.agents/skills/'))).toBe(true);
    }
  });
});

describe('isManagedTemplatePath', () => {
  it('accepts only canonical managed paths', () => {
    expect(isManagedTemplatePath('README.md')).toBe(true);
    expect(isManagedTemplatePath('.agents/skills/alice/SKILL.md')).toBe(true);
    expect(isManagedTemplatePath('.agents/skills/../../AGENTS.md')).toBe(false);
    expect(isManagedTemplatePath('.agents//skills/alice/SKILL.md')).toBe(false);
    expect(isManagedTemplatePath('/tmp/AGENTS.md')).toBe(false);
  });
});

function manager(busy = false): TemplateUpgradeManager {
  const templates = {
    get: (name: string) => name === template.name ? template : undefined,
  } as unknown as TemplateRegistry;
  return new TemplateUpgradeManager({
    registry,
    templates,
    workspaceRuntimeActivity: () => busy
      ? {
          busy: true,
          sessions: [{
            sessionId: 'pi-live',
            resumeId: 'resume-live',
            name: 'p1',
            agent: 'pi',
            surface: 'webpi',
            startedAt: Date.now(),
          }],
          headless: [],
        }
      : { busy: false, sessions: [], headless: [] },
    logger,
    materializeTemplate: async () => incoming,
  });
}

function file(content: string) {
  return {
    kind: 'file' as const,
    content,
    fingerprint: `file:${createHash('sha256').update(content).digest('hex')}`,
  };
}

async function git(dir: string, args: readonly string[]): Promise<string> {
  const result = await gitExec([...args], dir);
  if (result.exitCode !== 0) throw new Error(String(result.stderr));
  return String(result.stdout);
}
