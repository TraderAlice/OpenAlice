import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
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
  await mkdir(join(dir, '.agents', 'skills', 'template-skill'), { recursive: true });
  await writeFile(join(dir, 'README.md'), 'template readme v1\n');
  await writeFile(join(dir, 'AGENTS.md'), 'template agents v1\n');
  await writeFile(join(dir, 'CLAUDE.md'), 'template claude v1\n');
  await writeFile(join(dir, '.agents', 'skills', 'template-skill', 'SKILL.md'), 'skill v1\n');
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
    injectInstructions: true,
    bundledSkills: [],
    upgradeStrategy: 'managed-context',
  };
  incoming = {
    'README.md': file('template readme v2\n'),
    'AGENTS.md': file('template agents v2\n'),
    'CLAUDE.md': file('template claude v1\n'),
    '.agents/skills/template-skill/SKILL.md': file('skill v2\n'),
    '.agents/skills/new/SKILL.md': file('new skill\n'),
  };
});

afterEach(async () => rm(root, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
}));

describe('TemplateUpgradeManager', () => {
  it('merges separate lines and keeps the upstream baseline independent from local edits', async () => {
    const base = 'heading\n\nold command\n\nclosing\n';
    await writeFile(join(workspace.dir, 'AGENTS.md'), base);
    await initializeWorkspaceTemplateState(workspace, { ...template, version: '1.0.0' });
    await writeFile(join(workspace.dir, 'AGENTS.md'), base.replace('heading', 'my preference'));
    incoming = { ...incoming, 'AGENTS.md': file(base.replace('old command', 'new command')) };
    const upgrade = manager();
    const plan = await upgrade.plan(workspace.id);
    expect(plan.files.find(f => f.path === 'AGENTS.md')).toMatchObject({ status: 'ready', mergedPreview: 'my preference\n\nnew command\n\nclosing\n' });
    await upgrade.apply(workspace.id, { planDigest: plan.planDigest });
    expect(await readFile(join(workspace.dir, 'AGENTS.md'), 'utf8')).toBe('my preference\n\nnew command\n\nclosing\n');
    const again = await upgrade.plan(workspace.id);
    expect(again.files.find(f => f.path === 'AGENTS.md')?.status).toBe('preserved');
  });

  it('returns the base for overlapping edits without writing conflict markers', async () => {
    const original = 'template agents v1\n';
    await writeFile(join(workspace.dir, 'AGENTS.md'), 'my competing edit\n');
    const plan = await manager().plan(workspace.id);
    expect(plan.files.find(f => f.path === 'AGENTS.md')).toMatchObject({ status: 'conflict', basePreview: original });
    await expect(manager().apply(workspace.id, { planDigest: plan.planDigest })).rejects.toMatchObject({ code: 'unresolved_conflict' });
    expect(await readFile(join(workspace.dir, 'AGENTS.md'), 'utf8')).toBe('my competing edit\n');
  });

  it('warns for an old receipt and becomes quiet after accepting current injection', async () => {
    const upgrade = manager(false, true);
    expect(await upgrade.upgradeNotice(workspace.id)).toContain('alice harness upgrade --apply');
    await initializeWorkspaceTemplateState(workspace, template);
    expect(await upgrade.upgradeNotice(workspace.id)).toBeUndefined();
    expect(await upgrade.upgradeNotice('unknown')).toBeUndefined();
  });

  it('exposes the injection-owned Skill inventory including legacy names', async () => {
    const status = await manager(false, true).harnessStatus(workspace.id);
    expect(status.managedSkillNames).toEqual(expect.arrayContaining(['alice', 'traderhub', 'alice-workspace']));
    expect(status.managedSkillNames).not.toContain('template-skill');
  });

  it('keeps the Project source catalog and healthy Workspace visible when another checkout is missing', async () => {
    await registry.add({ ...workspace, id: 'missing', tag: 'missing', dir: join(root, 'missing-checkout') });
    const catalog = await manager(false, true).projectHarnessCatalog();
    expect(catalog.skills.find((skill) => skill.name === 'alice')?.files.some((entry) => entry.path === 'SKILL.md')).toBe(true);
    expect(catalog.workspaces.find((entry) => entry.id === workspace.id)?.plan).toBeDefined();
    expect(catalog.workspaces.find((entry) => entry.id === 'missing')?.error).toBeTruthy();
  });

  it('requires review before removing locally added files from an excluded Skill', async () => {
    await mkdir(join(workspace.dir, '.agents/skills/alice'), { recursive: true });
    await writeFile(join(workspace.dir, '.agents/skills/alice/local.md'), 'local research');
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    await upgrade.configureHarness(workspace.id, { schemaVersion: 1, cli: {}, skills: { alice: false } });
    const preview = await upgrade.plan(workspace.id);
    expect(preview.files.find((entry) => entry.path === '.agents/skills/alice/local.md')).toMatchObject({ status: 'conflict', operation: 'remove' });
    await expect(upgrade.apply(workspace.id, { planDigest: preview.planDigest })).rejects.toThrow();
    expect(await readFile(join(workspace.dir, '.agents/skills/alice/local.md'), 'utf8')).toBe('local research');
  });

  it('projects one Skill with its preference atomically without adopting unrelated Skills', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    await upgrade.configureHarness(workspace.id, { schemaVersion: 1, cli: { alice: { enabled: false } }, skills: { alice: false } });
    const install = { skill: 'alice', action: 'install' } as const;
    const preview = await upgrade.plan(workspace.id, install);
    expect(preview.files.every((entry) => entry.path.includes('/alice/') || entry.path === '.alice/alice-harness-config.json')).toBe(true);
    expect(JSON.parse(await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8')).skills.alice).toBe(false);
    await upgrade.apply(workspace.id, { planDigest: preview.planDigest, projection: install });
    expect(await readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'utf8')).toBeTruthy();
    expect(await upgrade.currentVersion(workspace)).toBe('unversioned');
    const versions = () => readFile(join(workspace.dir, '.alice/alice-harness-version.json'), 'utf8').then(JSON.parse);
    expect((await versions()).skillVersions.alice.version).toBe(preview.toVersion);
    await expect(readFile(join(workspace.dir, '.agents/skills/traderhub/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8'))).toMatchObject({ cli: { alice: { enabled: false } }, skills: { alice: true } });
    const remove = { skill: 'alice', action: 'remove' } as const;
    const removal = await upgrade.plan(workspace.id, remove);
    await upgrade.apply(workspace.id, { planDigest: removal.planDigest, projection: remove });
    await expect(readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8')).skills.alice).toBe(false);
    expect((await versions()).skillVersions.alice).toBeUndefined();
    const restored = await upgrade.plan(workspace.id, install);
    await upgrade.apply(workspace.id, { planDigest: restored.planDigest, projection: install });
    expect(await readFile(join(workspace.dir, '.claude/skills/alice/SKILL.md'), 'utf8')).toBe(await readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'utf8'));
    const catalog = await upgrade.projectHarnessCatalog();
    expect(catalog.workspaces[0]?.projections?.find((skill) => skill.name === 'alice')).toMatchObject({ installed: true, enabled: true, customized: false, mirrorDiverged: false, injectedVersion: restored.toVersion, injectedAt: expect.any(String) });
  });

  it('does not infer a per-Skill version from an older bundle-only record', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    const plan = await upgrade.plan(workspace.id);
    await upgrade.apply(workspace.id, { planDigest: plan.planDigest });
    const path = join(workspace.dir, '.alice/alice-harness-version.json');
    const state = JSON.parse(await readFile(path, 'utf8'));
    delete state.skillVersions;
    await writeFile(path, JSON.stringify(state));
    expect(await upgrade.skillProjection(workspace.id, 'alice')).toMatchObject({ installed: true, injectedVersion: null, injectedAt: null });
    expect(await upgrade.currentVersion(workspace)).toBe(plan.toVersion);
  });

  it('recovers a committed scoped revision without advancing other Skill records', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    const all = await upgrade.plan(workspace.id);
    await upgrade.apply(workspace.id, { planDigest: all.planDigest });
    const statePath = join(workspace.dir, '.alice/alice-harness-version.json');
    const oldState = JSON.parse(await readFile(statePath, 'utf8'));
    oldState.skillVersions.alice.version = '0.9.0+old';
    await writeFile(statePath, JSON.stringify(oldState));
    const projection = { skill: 'alice', action: 'restore' } as const;
    const plan = await upgrade.plan(workspace.id, projection);
    await upgrade.apply(workspace.id, { planDigest: plan.planDigest, projection });
    // Recreate the crash window after the file commit but before bookkeeping.
    await writeFile(statePath, JSON.stringify(oldState));
    const transaction = join(workspace.dir, '.alice/alice-harness-upgrade/transaction');
    await mkdir(transaction, { recursive: true });
    await writeFile(join(transaction, 'incoming.json.gz'), await readFile(join(workspace.dir, '.alice/alice-harness-upgrade/baseline.json.gz')));
    await writeFile(join(transaction, 'journal.json'), JSON.stringify({ schemaVersion: 1, workspaceId: workspace.id, template: 'alice-harness', fromVersion: all.toVersion, toVersion: all.toVersion, planDigest: plan.planDigest, touchedPaths: [], preparedAt: new Date().toISOString(), projection: { ...projection, version: plan.toVersion } }));
    await upgrade.recover();
    const recovered = JSON.parse(await readFile(statePath, 'utf8'));
    expect(recovered.skillVersions.alice.version).toBe(plan.toVersion);
    expect(recovered.skillVersions.traderhub).toEqual(oldState.skillVersions.traderhub);
    expect(recovered.appliedVersion).toBe(oldState.appliedVersion);
    await expect(readFile(join(transaction, 'journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reviews restore and rejects a stale Skill action without changing configuration', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    await mkdir(join(workspace.dir, '.agents/skills/alice'), { recursive: true });
    await writeFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'customized');
    const restore = { skill: 'alice', action: 'restore' } as const;
    const preview = await upgrade.plan(workspace.id, restore);
    expect(preview.files.find((entry) => entry.path === '.agents/skills/alice/SKILL.md')).toMatchObject({ status: 'ready', currentPreview: 'customized' });
    await writeFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'changed after preview');
    await expect(upgrade.apply(workspace.id, { planDigest: preview.planDigest, projection: restore })).rejects.toMatchObject({ code: 'stale_plan' });
    await expect(readFile(join(workspace.dir, '.alice/alice-harness-config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const fresh = await upgrade.plan(workspace.id, restore);
    await upgrade.apply(workspace.id, { planDigest: fresh.planDigest, projection: restore });
    expect(await readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'utf8')).not.toBe('changed after preview');
    await expect(readFile(join(workspace.dir, '.agents/skills/traderhub/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('updates only the selected Skill baseline and preserves unrelated customization', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    const all = await upgrade.plan(workspace.id);
    await upgrade.apply(workspace.id, { planDigest: all.planDigest });
    const statePath = join(workspace.dir, '.alice/alice-harness-version.json');
    const originalState = JSON.parse(await readFile(statePath, 'utf8'));
    expect(originalState.skillVersions.traderhub.version).toBe(all.toVersion);
    originalState.skillVersions.alice.version = '0.9.0+old';
    await writeFile(statePath, JSON.stringify(originalState));
    const baselinePath = join(workspace.dir, '.alice/alice-harness-upgrade/baseline.json.gz');
    const baseline = JSON.parse(gunzipSync(await readFile(baselinePath)).toString());
    for (const root of ['.agents', '.claude']) {
      const path = `${root}/skills/alice/SKILL.md`;
      baseline.files[path] = file('older Project skill');
      await writeFile(join(workspace.dir, path), 'older Project skill');
    }
    await writeFile(baselinePath, gzipSync(JSON.stringify(baseline)));
    await writeFile(join(workspace.dir, '.agents/skills/traderhub/SKILL.md'), 'keep my unrelated changes');
    const projection = { skill: 'alice', action: 'update' } as const;
    const preview = await upgrade.plan(workspace.id, projection);
    expect(preview.files.find((entry) => entry.path === '.agents/skills/alice/SKILL.md')?.status).toBe('ready');
    await upgrade.apply(workspace.id, { projection, planDigest: preview.planDigest });
    expect(await readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'utf8')).not.toBe('older Project skill');
    expect(await readFile(join(workspace.dir, '.agents/skills/traderhub/SKILL.md'), 'utf8')).toBe('keep my unrelated changes');
    const after = JSON.parse(gunzipSync(await readFile(baselinePath)).toString());
    expect(after.files['.agents/skills/traderhub/SKILL.md']).toEqual(baseline.files['.agents/skills/traderhub/SKILL.md']);
    const updatedState = JSON.parse(await readFile(statePath, 'utf8'));
    expect(updatedState.skillVersions.alice.version).toBe(preview.toVersion);
    expect(updatedState.skillVersions.traderhub).toEqual(originalState.skillVersions.traderhub);
  });

  it('requires manual repair of a linked Skill file before removal or restore', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    await mkdir(join(workspace.dir, '.agents/skills/alice'), { recursive: true });
    await writeFile(join(root, 'external.md'), 'outside managed projection');
    await symlink(join(root, 'external.md'), join(workspace.dir, '.agents/skills/alice/SKILL.md'));
    for (const action of ['remove', 'restore'] as const) {
      const projection = { skill: 'alice', action } as const;
      const plan = await upgrade.plan(workspace.id, projection);
      const path = '.agents/skills/alice/SKILL.md';
      expect(plan.files.find((entry) => entry.path === path)).toMatchObject({ status: 'conflict', canUseTemplate: false });
      await expect(upgrade.apply(workspace.id, { projection, planDigest: plan.planDigest, resolutions: { [path]: 'template' } })).rejects.toMatchObject({ code: 'invalid_resolution' });
    }
    expect(await readFile(join(root, 'external.md'), 'utf8')).toBe('outside managed projection');
  });

  it('reports unsafe parent directories as unverified instead of absent copies', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    await mkdir(join(root, 'outside-skill'), { recursive: true });
    await writeFile(join(root, 'outside-skill/SKILL.md'), 'outside');
    await symlink(join(root, 'outside-skill'), join(workspace.dir, '.agents/skills/alice'));
    const detail = await upgrade.skillProjection(workspace.id, 'alice');
    expect(detail.files.find((file) => file.path === '.agents/skills/alice/SKILL.md')?.unverified).toBe(true);
  });

  it('rolls back Skill files and the retention preference together if the commit fails', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    await upgrade.configureHarness(workspace.id, { schemaVersion: 1, cli: { alice: { enabled: false } }, skills: { alice: false } });
    const previous = await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8');
    const hook = join(workspace.dir, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    const projection = { skill: 'alice', action: 'install' } as const;
    const plan = await upgrade.plan(workspace.id, projection);
    await expect(upgrade.apply(workspace.id, { projection, planDigest: plan.planDigest })).rejects.toThrow();
    expect(await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8')).toBe(previous);
    await expect(readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await upgrade.currentVersion(workspace)).toBeUndefined();
  });

  it('adopts policy and removes or restores a Skill independently of CLI switches at the same revision', async () => {
    const upgrade = new TemplateUpgradeManager({ registry, templates: { get: () => template } as unknown as TemplateRegistry, logger, aliceHarness: true });
    const preview = await upgrade.plan(workspace.id);
    expect(preview.files.find((entry) => entry.path === '.alice/alice-harness-config.json')?.operation).toBe('add');
    await expect(readFile(join(workspace.dir, '.alice/alice-harness-config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await upgrade.apply(workspace.id, { planDigest: preview.planDigest });
    expect(JSON.parse(await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8'))).toEqual({ schemaVersion: 1, cli: {} });
    await upgrade.configureHarness(workspace.id, { schemaVersion: 1, cli: { alice: { enabled: false } } });
    const cliOnly = await upgrade.plan(workspace.id);
    expect(cliOnly.files.find((entry) => entry.path === '.agents/skills/alice/SKILL.md')?.status).toBe('unchanged');
    await upgrade.configureHarness(workspace.id, { schemaVersion: 1, cli: { alice: { enabled: false } }, skills: { alice: false } });
    const disabled = await upgrade.plan(workspace.id);
    expect(disabled.fromVersion).toBe(disabled.toVersion);
    expect(disabled.files.find((entry) => entry.path === '.agents/skills/alice/SKILL.md')?.operation).toBe('remove');
    await upgrade.apply(workspace.id, { planDigest: disabled.planDigest });
    await expect(readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8')).cli.alice.enabled).toBe(false);
    expect(await upgrade.currentVersion(workspace)).toBe(preview.toVersion);
    const next = await upgrade.plan(workspace.id);
    expect(next.files.some((entry) => entry.path === '.agents/skills/alice/SKILL.md' && entry.operation === 'add')).toBe(false);
    expect(await readFile(join(workspace.dir, '.agents/skills/alice-analysis/SKILL.md'), 'utf8')).toBeTruthy();
    await upgrade.configureHarness(workspace.id, { schemaVersion: 1, cli: { alice: { enabled: false } }, skills: { alice: true } });
    const restored = await upgrade.plan(workspace.id);
    expect(restored.fromVersion).toBe(restored.toVersion);
    for (const directory of ['.agents', '.claude']) {
      expect(restored.files.find((entry) => entry.path === `${directory}/skills/alice/SKILL.md`)).toMatchObject({ status: 'ready', operation: 'add' });
    }
    await upgrade.apply(workspace.id, { planDigest: restored.planDigest });
    const canonical = await readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'utf8');
    expect(canonical).toBeTruthy();
    expect(await readFile(join(workspace.dir, '.claude/skills/alice/SKILL.md'), 'utf8')).toBe(canonical);
    expect(JSON.parse(await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8')).cli.alice.enabled).toBe(false);
  });

  it('upgrades Alice skills without changing a source-owned Harness or local config', async () => {
    template = { ...template, upgradeStrategy: undefined };
    await mkdir(join(workspace.dir, '.agents/skills/alice'), { recursive: true });
    await writeFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'alice v1');
    await initializeWorkspaceTemplateState(workspace, template);
    await manager(false, true).configureHarness(workspace.id, { schemaVersion: 1, cli: { alice: { groups: { rss: false } } } });
    incoming = { '.agents/skills/alice/SKILL.md': file('alice v2'), 'AGENTS.md': file('must not replace') };
    const plan = await manager(false, true).plan(workspace.id);
    expect(plan.template).toBe('alice-harness');
    expect(plan.files.map((file) => file.path)).toEqual(['.agents/skills/alice/SKILL.md']);
    const result = await manager(false, true).apply(workspace.id, { planDigest: plan.planDigest });
    expect(result.changedPaths).toEqual(['.agents/skills/alice/SKILL.md']);
    expect(await readFile(join(workspace.dir, 'AGENTS.md'), 'utf8')).toBe('template agents v1\n');
    expect(JSON.parse(await readFile(join(workspace.dir, '.alice/alice-harness-config.json'), 'utf8')).cli.alice.groups.rss).toBe(false);
    expect(JSON.parse(await readFile(join(workspace.dir, '.alice/alice-harness-version.json'), 'utf8')).template).toBe('alice-harness');
    expect(await manager().currentVersion(workspace)).toBe('1.0.0');
  });

  it('applies Alice Skill updates during an active Session', async () => {
    incoming = { '.agents/skills/alice/SKILL.md': file('updated live skill') };
    const upgrade = manager(true, true);
    const plan = await upgrade.plan(workspace.id);
    expect(plan.activity.busy).toBe(true);
    expect(plan.blockers).toEqual([]);
    await upgrade.apply(workspace.id, { planDigest: plan.planDigest });
    expect(await readFile(join(workspace.dir, '.agents/skills/alice/SKILL.md'), 'utf8')).toBe('updated live skill');
    expect(await upgrade.currentVersion(workspace)).toBe(plan.toVersion);

    await writeFile(join(workspace.dir, 'staged.md'), 'user work');
    await git(workspace.dir, ['add', 'staged.md']);
    const blocked = await upgrade.plan(workspace.id);
    expect(blocked.blockers).toEqual(['staged_changes']);
    await expect(upgrade.apply(workspace.id, { planDigest: blocked.planDigest }))
      .rejects.toMatchObject({ code: 'staged_changes' });
  });

  it('keeps Alice skills outside template upgrade and blocks busy config writes', async () => {
    incoming = { ...incoming, '.agents/skills/alice/SKILL.md': file('not template-owned') };
    expect((await manager().plan(workspace.id)).files.some((file) => file.path.includes('/alice/'))).toBe(false);
    await expect(manager(true, true).configureHarness(workspace.id, { schemaVersion: 1, cli: {} })).rejects.toMatchObject({ code: 'busy' });
  });

  it('invalidates an injection preview when config changes', async () => {
    incoming = { '.agents/skills/alice/SKILL.md': file('alice v2') };
    const plan = await manager(false, true).plan(workspace.id);
    await manager(false, true).configureHarness(workspace.id, { schemaVersion: 1, cli: { alice: { groups: { rss: false } } } });
    await expect(manager(false, true).apply(workspace.id, { planDigest: plan.planDigest })).rejects.toMatchObject({ code: 'stale_plan' });
  });

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
    const skill = plan.files.find((entry) => entry.path === '.agents/skills/template-skill/SKILL.md');
    expect(skill).toMatchObject({ status: 'conflict', canUseTemplate: false });
    await expect(manager().apply(workspace.id, {
      planDigest: plan.planDigest,
      resolutions: Object.fromEntries(plan.files.filter((file) => file.status === 'conflict').map((file) => [file.path, 'template' as const])),
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
  }, 15_000);
});

describe('isManagedTemplatePath', () => {
  it('accepts only canonical managed paths', () => {
    expect(isManagedTemplatePath('README.md')).toBe(true);
    expect(isManagedTemplatePath('.agents/skills/template-skill/SKILL.md')).toBe(true);
    expect(isManagedTemplatePath('.agents/skills/../../AGENTS.md')).toBe(false);
    expect(isManagedTemplatePath('.agents//skills/template-skill/SKILL.md')).toBe(false);
    expect(isManagedTemplatePath('/tmp/AGENTS.md')).toBe(false);
  });
});

function manager(busy = false, aliceHarness = false): TemplateUpgradeManager {
  const templates = {
    get: (name: string) => name === template.name ? template : undefined,
  } as unknown as TemplateRegistry;
  return new TemplateUpgradeManager({
    registry,
    templates,
    aliceHarness,
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
