import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';

import { exec as gitExec, type IGitStringExecutionOptions } from './git-execution.js';

import { CLI_EXPORTS } from '../server/cli-commands.js';
import { aliceHarnessSourceVersion, aliceHarnessSkillCatalog, injectAliceHarnessSkills } from './alice-harness-assets.js';
import { ALICE_HARNESS_VERSION_PATH, ALICE_HARNESS_CONFIG_PATH, LEGACY_ALICE_HARNESS_SKILLS, ALICE_HARNESS_SKILLS, parseAliceHarnessConfig, isAliceHarnessSkillPath, readAliceHarnessConfig } from './alice-harness-policy.js';
import { injectWorkspaceContext } from './context-injector.js';
import type { Logger } from './logger.js';
import type { TemplateMeta, TemplateRegistry } from './template-registry.js';
import { WorkspaceOperationGuard } from './workspace-operation-guard.js';
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js';
import type { WorkspaceRuntimeActivity } from './workspace-runtime-activity.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const STATE_SCHEMA_VERSION = 1 as const;
function upgradePaths(aliceHarness = false) {
  const root = aliceHarness ? '.alice/alice-harness-upgrade' : '.alice/template-upgrade';
  const transaction = `${root}/transaction`;
  return {
    state: aliceHarness ? ALICE_HARNESS_VERSION_PATH : `${root}/state.json`,
    baseline: `${root}/baseline.json.gz`, transaction,
    journal: `${transaction}/journal.json`, before: `${transaction}/before.json.gz`, incoming: `${transaction}/incoming.json.gz`,
    exclude: `/${root}/`,
  };
}
type UpgradePaths = ReturnType<typeof upgradePaths>;
const TEMPLATE_PATHS = upgradePaths();
const MAX_PREVIEW_CHARS = 24_000;
const GIT_TIMEOUT_MS = 15_000;
const MAX_GIT_BUFFER = 16 * 1024 * 1024;
const MANAGED_ROOT_FILES = ['README.md', 'AGENTS.md', 'CLAUDE.md'] as const;
const MANAGED_TREE_ROOTS = ['.agents/skills', '.claude/skills', '.pi/skills'] as const;

export type TemplateUpgradeFileStatus = 'ready' | 'preserved' | 'conflict' | 'unchanged';
export type TemplateUpgradeResolution = 'workspace' | 'template';

export interface TemplateSnapshotFile {
  readonly kind: 'missing' | 'file' | 'other';
  readonly content?: string;
  readonly fingerprint: string;
  readonly detail?: string;
}

export type TemplateSnapshot = Readonly<Record<string, TemplateSnapshotFile>>;
type SnapshotFile = TemplateSnapshotFile;
type Snapshot = TemplateSnapshot;

interface StoredBaseline {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly files: Snapshot;
}

interface TemplateUpgradeState {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly template: string;
  readonly appliedVersion: string;
  readonly appliedAt: string;
  readonly source: 'creation' | 'upgrade';
  readonly commit?: string;
  readonly skillVersions?: Readonly<Record<string, { version: string; appliedAt: string }>>;
}

interface UpgradeJournal {
  readonly projection?: SkillProjectionRequest & { version: string };
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly template: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly planDigest: string;
  readonly touchedPaths: readonly string[];
  readonly preparedAt: string;
}

export interface TemplateUpgradeFilePlan {
  readonly path: string;
  readonly status: TemplateUpgradeFileStatus;
  readonly operation: 'add' | 'update' | 'remove' | 'keep' | 'none';
  readonly currentPreview: string | null;
  readonly templatePreview: string | null;
  readonly currentTruncated: boolean;
  readonly templateTruncated: boolean;
  readonly canUseTemplate: boolean;
  readonly note?: string;
}

export interface TemplateUpgradePlan {
  readonly workspaceId: string;
  readonly template: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly strategy: 'managed-context';
  readonly planDigest: string;
  readonly source: 'recorded-baseline' | 'legacy-root-commit';
  readonly blocked: boolean;
  readonly blockers: readonly string[];
  /** Concrete process evidence behind `active_sessions`. */
  readonly activity: WorkspaceRuntimeActivity;
  readonly files: readonly TemplateUpgradeFilePlan[];
  readonly summary: {
    readonly ready: number;
    readonly preserved: number;
    readonly conflicts: number;
    readonly unchanged: number;
  };
}

export interface SkillProjectionRequest {
  readonly skill: typeof ALICE_HARNESS_SKILLS[number];
  readonly action: 'install' | 'update' | 'remove' | 'restore';
}

export interface ApplyTemplateUpgradeInput {
  readonly projection?: SkillProjectionRequest;
  readonly planDigest: string;
  readonly resolutions?: Readonly<Record<string, TemplateUpgradeResolution>>;
}

export interface TemplateUpgradeResult {
  readonly workspaceId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly commit: string;
  readonly changedPaths: readonly string[];
  readonly keptPaths: readonly string[];
}

export class TemplateUpgradeError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'unsupported'
      | 'already_current'
      | 'busy'
      | 'staged_changes'
      | 'stale_plan'
      | 'unresolved_conflict'
      | 'invalid_resolution',
    message: string,
    public readonly plan?: TemplateUpgradePlan,
  ) {
    super(message);
    this.name = 'TemplateUpgradeError';
  }
}

export interface TemplateUpgradeManagerOptions {
  readonly aliceHarness?: boolean;
  readonly registry: WorkspaceRegistry;
  readonly templates: TemplateRegistry;
  readonly workspaceRuntimeActivity?: (workspaceId: string) => WorkspaceRuntimeActivity;
  readonly logger: Logger;
  readonly operationGuard?: WorkspaceOperationGuard;
  /** Test seam: production materializes the actual current template. */
  readonly materializeTemplate?: (template: TemplateMeta, workspaceId: string) => Promise<Snapshot>;
}

/**
 * Reconciles launcher-managed template assets into an existing Workspace.
 *
 * This is intentionally a three-way merge instead of a template re-copy:
 * the last applied template snapshot is Base, the live Workspace is Local,
 * and today's template snapshot is Incoming. Only Incoming-only changes are
 * automatic. Local-only changes are preserved and dual edits require an
 * explicit file-level choice from the user.
 *
 * The change-plan vocabulary is source-neutral on purpose. Workspace Absorb
 * can reuse the same Base/Local/Incoming classification later without making
 * template upgrade and desk consolidation pretend to be the same operation.
 */
export class TemplateUpgradeManager {
  private readonly operationGuard: WorkspaceOperationGuard;
  private readonly paths: UpgradePaths;

  constructor(private readonly opts: TemplateUpgradeManagerOptions) {
    this.paths = upgradePaths(opts.aliceHarness);
    this.operationGuard = opts.operationGuard ?? new WorkspaceOperationGuard();
  }

  async recover(): Promise<void> {
    for (const workspace of this.opts.registry.list()) {
      if (!existsSync(join(workspace.dir, this.paths.journal))) continue;
      await this.recoverWorkspace(workspace).catch((err) =>
        this.opts.logger.error('template_upgrade.recovery_failed', {
          workspaceId: workspace.id,
          err,
        }),
      );
    }
  }

  async projectHarnessCatalog() {
    const version = await aliceHarnessSourceVersion();
    const skills = await aliceHarnessSkillCatalog();
    const workspaces = [];
    // Sequential filesystem scans keep large Project inventories bounded.
    for (const workspace of this.opts.registry.list()) {
      try {
        const plan = await this.plan(workspace.id);
        workspaces.push({ id: workspace.id, name: workspace.tag, template: workspace.template, plan: { ...plan, files: [] }, projections: await this.skillProjections(workspace, skills) });
      } catch (error) {
        workspaces.push({ id: workspace.id, name: workspace.tag, template: workspace.template, error: (error as Error).message });
      }
    }
    return { version, skills, workspaces, commands: Object.fromEntries(Object.values(CLI_EXPORTS).filter((exp) => exp.binary !== 'alice-workspace').map((exp) => [exp.binary, Object.fromEntries(Object.entries(exp.commands).map(([group, verbs]) => [group, Object.keys(verbs)]))])) };
  }

  async skillProjection(workspaceId: string, skill: string) {
    const workspace = this.opts.registry.get(workspaceId);
    if (!workspace) throw new TemplateUpgradeError('not_found', 'Workspace not found');
    const sources = (await aliceHarnessSkillCatalog()).filter((source) => source.name === skill);
    if (!sources.length) throw new TemplateUpgradeError('not_found', 'Project Skill not found');
    return (await this.skillProjections(workspace, sources, true))[0]!;
  }

  private async skillProjections(workspace: WorkspaceMeta, sources: Awaited<ReturnType<typeof aliceHarnessSkillCatalog>>, includeContent = false) {
    const state = await readState(workspace.dir, this.paths);
    const local = await readManagedWorkspaceSnapshot(workspace.dir);
    const stored = await readBaseline(workspace.dir, this.paths);
    const baseline = stored?.files ?? await readLegacyRootBaseline(workspace.dir);
    const config = await readAliceHarnessConfig(workspace.dir);
    const defaults = this.opts.templates.get(workspace.template ?? '')?.injectTools === true;
    return Promise.all(sources.map(async (source) => {
      const prototype = Object.fromEntries(source.files.map((file) => [file.path, fileContent(file.content)]));
      const canonical = Object.fromEntries(Object.entries(local).filter(([path]) => path.startsWith(`.agents/skills/${source.name}/`)).map(([path, value]) => [path.slice(`.agents/skills/${source.name}/`.length), value]));
      const mirror = Object.fromEntries(Object.entries(local).filter(([path]) => path.startsWith(`.claude/skills/${source.name}/`)).map(([path, value]) => [path.slice(`.claude/skills/${source.name}/`.length), value]));
      const paths = [...new Set([
        ...Object.keys(local).filter((path) => isProjectionPath(path, source.name)),
        ...source.files.flatMap((file) => ['.agents', '.claude'].map((root) => `${root}/skills/${source.name}/${file.path}`)),
      ])].sort();
      const inspected = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readLocalFile(workspace.dir, path)] as const)));
      const files = paths.map((path) => {
        const current = inspected[path] ?? missingFile();
        const original = path.startsWith('.pi/') ? missingFile() : prototype[path.split('/').slice(3).join('/')] ?? missingFile();
        return { path, ...(includeContent ? { currentPreview: preview(current).value, sourcePreview: preview(original).value } : {}),
          truncated: preview(current).truncated || preview(original).truncated,
          differs: !sameFile(current, original), unverified: current.kind === 'other' };
      });
      const present = Object.keys(inspected).filter((path) => inspected[path]?.kind !== 'missing');
      return {
        name: source.name,
        injectedVersion: typeof state?.skillVersions?.[source.name]?.version === 'string' ? state.skillVersions[source.name]!.version : null,
        injectedAt: typeof state?.skillVersions?.[source.name]?.appliedAt === 'string' ? state.skillVersions[source.name]!.appliedAt : null,
        enabled: config.skills?.[source.name] ?? (defaults || source.name === 'self-scheduling'),
        installed: present.length > 0, canonicalPresent: Object.keys(canonical).length > 0,
        mirrorDiverged: digestPlan(canonical) !== digestPlan(mirror),
        customized: paths.some((path) => !sameFile(inspected[path] ?? missingFile(), baseline[path] ?? missingFile())),
        sourceChanged: [...new Set([...Object.keys(baseline).filter((path) => path.startsWith(`.agents/skills/${source.name}/`)).map((path) => path.split('/').slice(3).join('/')), ...Object.keys(prototype)])].some((path) => !sameFile(baseline[`.agents/skills/${source.name}/${path}`] ?? missingFile(), prototype[path] ?? missingFile())),
        files,
      };
    }));
  }

  async harnessStatus(workspaceId: string) {
    const workspace = this.opts.registry.get(workspaceId);
    if (!workspace) throw new TemplateUpgradeError('not_found', 'Workspace not found');
    return {
      appliedVersion: await this.currentVersion(workspace) ?? null,
      availableVersion: await aliceHarnessSourceVersion(),
      runtimeAuthority: 'alice-project' as const,
      skillDefaults: Object.fromEntries(ALICE_HARNESS_SKILLS.map((name) => [name, this.opts.templates.get(workspace.template ?? '')?.injectTools === true || name === 'self-scheduling'])),
      managedSkillNames: [...LEGACY_ALICE_HARNESS_SKILLS],
      config: await readAliceHarnessConfig(workspace.dir),
      commands: Object.fromEntries(Object.values(CLI_EXPORTS).filter((exp) => exp.binary !== 'alice-workspace').map((exp) => [exp.binary, Object.keys(exp.commands)])),
    };
  }

  async configureHarness(workspaceId: string, value: unknown): Promise<void> {
    const config = parseAliceHarnessConfig(value);
    const lease = this.operationGuard.acquire(workspaceId, 'alice-harness-config');
    if (!lease) throw new TemplateUpgradeError('busy', 'Workspace has another checkout operation');
    try {
      const workspace = this.opts.registry.get(workspaceId);
      if (!workspace) throw new TemplateUpgradeError('not_found', 'Workspace not found');
      if (this.opts.workspaceRuntimeActivity?.(workspaceId).busy) throw new TemplateUpgradeError('busy', 'Pause Workspace Sessions before changing CLI configuration');
      const unsafeParent = await parentPathIssue(workspace.dir, ALICE_HARNESS_CONFIG_PATH);
      if (unsafeParent) throw new Error(`Unsafe config path: ${unsafeParent}`);
      await atomicWriteJson(join(workspace.dir, ALICE_HARNESS_CONFIG_PATH), config);
    } finally { lease.release(); }
  }

  async currentVersion(workspace: WorkspaceMeta): Promise<string | undefined> {
    const state = await readState(workspace.dir, this.paths);
    if (state && state.template === (this.opts.aliceHarness ? 'alice-harness' : workspace.template)) return state.appliedVersion;
    return this.opts.aliceHarness ? undefined : workspace.spawnedFromVersion;
  }

  async plan(workspaceId: string, projection?: SkillProjectionRequest): Promise<TemplateUpgradePlan> {
    const lease = await this.operationGuard.acquireWhenAvailable(workspaceId, 'template-upgrade-preview');
    try {
      const workspace = this.opts.registry.get(workspaceId);
      if (!workspace) throw new TemplateUpgradeError('not_found', 'Workspace not found');
      const template = await this.resolveTemplate(workspace);
      await this.recoverWorkspace(workspace);
      const incoming = await this.materializeTemplate(template, workspace.id, projection);
      return this.buildPlan(workspace, template, incoming, projection);
    } finally {
      lease.release();
    }
  }

  async apply(
    workspaceId: string,
    input: ApplyTemplateUpgradeInput,
  ): Promise<TemplateUpgradeResult> {
    const lease = this.operationGuard.acquire(workspaceId, 'template-upgrade');
    if (!lease) {
      const current = this.operationGuard.current(workspaceId);
      throw new TemplateUpgradeError(
        'busy',
        `Workspace is busy with ${current ?? 'another directory operation'}.`,
      );
    }
    try {
      return await this.applyLocked(workspaceId, input);
    } finally {
      lease.release();
    }
  }

  private async applyLocked(
    workspaceId: string,
    input: ApplyTemplateUpgradeInput,
  ): Promise<TemplateUpgradeResult> {
    const workspace = this.opts.registry.get(workspaceId);
    if (!workspace) throw new TemplateUpgradeError('not_found', 'Workspace not found');
    const template = await this.resolveTemplate(workspace);
    await this.recoverWorkspace(workspace);

    // Materialize once: the exact Incoming snapshot included in the reviewed
    // digest is also the one written to disk. Regenerating it after validation
    // would leave a small but real time-of-check/time-of-use race.
    const incoming = await this.materializeTemplate(template, workspace.id, input.projection);
    const plan = await this.buildPlan(workspace, template, incoming, input.projection);
    if (plan.blocked) {
      const code = plan.blockers.includes('active_sessions') ? 'busy' : 'staged_changes';
      throw new TemplateUpgradeError(code, blockerMessage(plan.blockers), plan);
    }
    if (plan.planDigest !== input.planDigest) {
      throw new TemplateUpgradeError(
        'stale_plan',
        'The Workspace changed after this preview. Review the refreshed plan before applying.',
        plan,
      );
    }
    if ((input.projection && !plan.files.some((file) => file.status === 'ready' || file.status === 'conflict')) || plan.fromVersion === plan.toVersion && (!this.opts.aliceHarness || !plan.files.some((file) => file.status === 'ready' || file.status === 'conflict'))) {
      throw new TemplateUpgradeError('already_current', 'Workspace is already on this template version', plan);
    }

    const resolutions = input.resolutions ?? {};
    const changedPaths: string[] = [];
    const keptPaths: string[] = [];
    const before: Record<string, SnapshotFile> = {};

    for (const file of plan.files) {
      if (file.status === 'unchanged' || file.status === 'preserved') {
        if (file.status === 'preserved') keptPaths.push(file.path);
        continue;
      }
      let choice: TemplateUpgradeResolution = 'template';
      if (file.status === 'conflict') {
        const requested = resolutions[file.path];
        if (!requested) {
          throw new TemplateUpgradeError(
            'unresolved_conflict',
            `Choose how to resolve ${file.path} before applying.`,
            plan,
          );
        }
        if (requested === 'template' && !file.canUseTemplate) {
          throw new TemplateUpgradeError(
            'invalid_resolution',
            `${file.path} is not a regular file and cannot be replaced safely. Keep the Workspace copy or repair it manually.`,
            plan,
          );
        }
        choice = requested;
      }
      if (choice === 'workspace') {
        keptPaths.push(file.path);
        continue;
      }
      changedPaths.push(file.path);
      before[file.path] = await readLocalFile(workspace.dir, file.path);
    }

    const journal: UpgradeJournal = {
      schemaVersion: STATE_SCHEMA_VERSION,
      workspaceId: workspace.id,
      template: template.name,
      fromVersion: plan.fromVersion,
      toVersion: input.projection ? plan.fromVersion : plan.toVersion,
      planDigest: plan.planDigest,
      ...(input.projection ? { projection: { ...input.projection, version: plan.toVersion } } : {}),
      touchedPaths: changedPaths,
      preparedAt: new Date().toISOString(),
    };

    await ensureStateExcluded(workspace.dir, this.paths);
    await writeCompressedJson(join(workspace.dir, this.paths.before), {
      schemaVersion: STATE_SCHEMA_VERSION,
      files: before,
    } satisfies StoredBaseline);
    await writeCompressedJson(join(workspace.dir, this.paths.incoming), {
      schemaVersion: STATE_SCHEMA_VERSION,
      files: incoming,
    } satisfies StoredBaseline);
    await atomicWriteJson(join(workspace.dir, this.paths.journal), journal);

    try {
      for (const path of changedPaths) {
        await writeSnapshotFile(workspace.dir, path, incoming[path] ?? missingFile());
      }
      if (changedPaths.length > 0) {
        await runGit(workspace.dir, ['add', '-A', '--', ...changedPaths]);
      }
      const message = [
        input.projection ? `skill(${input.projection.skill}): ${input.projection.action} Project files` : `template(${template.name}): upgrade ${plan.fromVersion} -> ${plan.toVersion}`,
        '',
        `OpenAlice-Template-Upgrade: ${plan.planDigest}`,
      ].join('\n');
      await runGit(workspace.dir, [
        '-c', 'user.email=launcher@local',
        '-c', 'user.name=OpenAlice',
        'commit', '--allow-empty', '-q', '-m', message,
      ]);
      const commit = (await runGit(workspace.dir, ['rev-parse', 'HEAD'])).trim();
      await persistAppliedState(workspace.dir, input.projection ? { ...template, version: plan.fromVersion } : template, incoming, 'upgrade', commit, this.paths, journal.projection);
      await rm(join(workspace.dir, this.paths.transaction), { recursive: true, force: true });
      this.opts.logger.info('template_upgrade.applied', {
        workspaceId: workspace.id,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        commit,
        changedPaths,
        keptPaths,
      });
      return {
        workspaceId: workspace.id,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        commit,
        changedPaths,
        keptPaths,
      };
    } catch (err) {
      await this.recoverWorkspace(workspace).catch((recoveryErr) =>
        this.opts.logger.error('template_upgrade.apply_recovery_failed', {
          workspaceId: workspace.id,
          err: recoveryErr,
        }),
      );
      throw err;
    }
  }

  private async buildPlan(
    workspace: WorkspaceMeta,
    template: TemplateMeta,
    incoming: Snapshot,
    projection?: SkillProjectionRequest,
  ): Promise<TemplateUpgradePlan> {
    const state = await readState(workspace.dir, this.paths);
    const stored = state?.template === template.name ? await readBaseline(workspace.dir, this.paths) : null;
    const baseline = stored?.files ?? await readLegacyRootBaseline(workspace.dir);
    const source: TemplateUpgradePlan['source'] = stored
      ? 'recorded-baseline'
      : 'legacy-root-commit';
    // Local-only managed files are part of the review too. Omitting them would
    // preserve the bytes but hide an important Workspace customization from
    // the user and from the plan digest.
    const localSnapshot = await readManagedWorkspaceSnapshot(workspace.dir);
    const paths = [...new Set([
      ...Object.keys(baseline),
      ...Object.keys(localSnapshot),
      ...Object.keys(incoming),
    ])]
      .filter((path) => isManagedTemplatePath(path) && (this.opts.aliceHarness ? (isAliceHarnessSkillPath(path) || path === ALICE_HARNESS_CONFIG_PATH) : (!isAliceHarnessSkillPath(path) && path !== ALICE_HARNESS_CONFIG_PATH)))
      .filter((path) => !projection || path === ALICE_HARNESS_CONFIG_PATH || isProjectionPath(path, projection.skill))
      .sort();
    const localEntries = await Promise.all(paths.map((path) => readLocalFile(workspace.dir, path)));
    const files = paths.map((path, index) => classifyFile(
      path,
      baseline[path] ?? missingFile(),
      localEntries[index] ?? missingFile(),
      incoming[path] ?? missingFile(),
    ));
    if (this.opts.aliceHarness) {
      const policy = await readAliceHarnessConfig(workspace.dir);
      for (const [index, file] of files.entries()) {
        const local = localEntries[index] ?? missingFile();
        const next = incoming[file.path] ?? missingFile();
        if (projection && file.status !== 'unchanged') {
          const regular = local.kind !== 'other' && next.kind !== 'other';
          const replace = file.path === ALICE_HARNESS_CONFIG_PATH
            || projection.action === 'restore'
            || (projection.action === 'install' && local.kind === 'missing');
          if (replace) Object.assign(file, {
            status: regular ? 'ready' : 'conflict', operation: operationFor(local, next),
            canUseTemplate: regular,
            note: regular ? 'Apply the reviewed Project projection.' : 'Repair this non-regular entry before replacing it.',
          });
        }
        const skill = file.path.split('/')[2] as typeof ALICE_HARNESS_SKILLS[number];
        if (isAliceHarnessSkillPath(file.path) && (projection ? projection.action === 'remove' : policy.skills?.[skill] === false) && file.status === 'preserved') {
          Object.assign(file, { status: 'conflict', operation: 'remove', canUseTemplate: local.kind !== 'other' && next.kind !== 'other', note: 'This Skill is excluded, but contains local files. Review before removing.' });
        }
      }
    }
    const activity = this.opts.workspaceRuntimeActivity?.(workspace.id) ?? {
      busy: false,
      sessions: [],
      headless: [],
    };
    const blockers: string[] = [];
    // Skill projections are live documents; running agents do not lock their updates.
    if (activity.busy && !this.opts.aliceHarness) blockers.push('active_sessions');
    if ((await stagedPaths(workspace.dir)).length > 0) blockers.push('staged_changes');
    const fromVersion = state?.template === template.name
      ? state.appliedVersion
      : this.opts.aliceHarness ? 'unversioned' : workspace.spawnedFromVersion ?? 'unknown';
    const planDigest = digestPlan({
      workspaceId: workspace.id,
      template: template.name,
      fromVersion,
      toVersion: template.version,
      baseline,
      ...(projection ? { projection } : {}),
      ...(this.opts.aliceHarness ? { config: await readAliceHarnessConfig(workspace.dir) } : {}),
      incoming,
      local: Object.fromEntries(paths.map((path, index) => [path, localEntries[index] ?? missingFile()])),
    });
    return {
      workspaceId: workspace.id,
      template: template.name,
      fromVersion,
      toVersion: template.version,
      strategy: 'managed-context',
      planDigest,
      source,
      blocked: blockers.length > 0,
      blockers,
      activity,
      files,
      summary: {
        ready: files.filter((file) => file.status === 'ready').length,
        preserved: files.filter((file) => file.status === 'preserved').length,
        conflicts: files.filter((file) => file.status === 'conflict').length,
        unchanged: files.filter((file) => file.status === 'unchanged').length,
      },
    };
  }

  private async resolveTemplate(workspace: WorkspaceMeta): Promise<TemplateMeta> {
    if (!this.opts.aliceHarness) return resolveUpgradeableTemplate(workspace, this.opts.templates);
    const template = workspace.template ? this.opts.templates.get(workspace.template) : undefined;
    if (!template) throw new TemplateUpgradeError('unsupported', 'Workspace template is unavailable');
    return { ...template, name: 'alice-harness', version: await aliceHarnessSourceVersion(), upgradeStrategy: 'managed-context' };
  }

  private async materializeTemplate(template: TemplateMeta, workspaceId: string, projection?: SkillProjectionRequest): Promise<Snapshot> {
    if (projection && (!this.opts.aliceHarness || !ALICE_HARNESS_SKILLS.includes(projection.skill)
      || !['install', 'update', 'remove', 'restore'].includes(projection.action))) {
      throw new TemplateUpgradeError('unsupported', 'Unknown Project Skill operation');
    }
    if (this.opts.materializeTemplate) return this.opts.materializeTemplate(template, workspaceId);
    if (!this.opts.aliceHarness) return materializeTemplateSnapshot(template, workspaceId);
    const workspace = this.opts.registry.get(workspaceId)!;
    const previousConfig = await readAliceHarnessConfig(workspace.dir);
    const config = projection ? { ...previousConfig, skills: { ...previousConfig.skills, [projection.skill]: projection.action !== 'remove' } } : previousConfig;
    const dir = await mkdtemp(join(tmpdir(), 'alice-harness-'));
    try {
      await injectAliceHarnessSkills(dir, template.injectTools, config);
      const snapshot = { ...await readManagedWorkspaceSnapshot(dir) };
      // Adopt legacy Workspaces through the same reviewed, recoverable transaction.
      // Existing policy bytes are Workspace-owned and are never regenerated.
      const existingConfig = await readLocalFile(workspace.dir, ALICE_HARNESS_CONFIG_PATH);
      if (existingConfig.kind === 'missing' || (projection && existingConfig.kind === 'file')) {
        await atomicWriteJson(join(dir, ALICE_HARNESS_CONFIG_PATH), config);
        snapshot[ALICE_HARNESS_CONFIG_PATH] = await readLocalFile(dir, ALICE_HARNESS_CONFIG_PATH);
      } else snapshot[ALICE_HARNESS_CONFIG_PATH] = existingConfig;
      if (projection) {
        const stored = await readBaseline(workspace.dir, this.paths);
        const baseline = stored?.files ?? await readLegacyRootBaseline(workspace.dir);
        const scoped = Object.fromEntries(Object.entries(baseline).filter(([path]) => !isProjectionPath(path, projection.skill)));
        for (const [path, value] of Object.entries(snapshot)) {
          if (isProjectionPath(path, projection.skill) || path === ALICE_HARNESS_CONFIG_PATH) scoped[path] = value;
        }
        return scoped;
      }
      return snapshot;
    } finally { await rm(dir, { recursive: true, force: true }); }
  }

  private async recoverWorkspace(workspace: WorkspaceMeta): Promise<void> {
    const journal = await readJson<UpgradeJournal>(join(workspace.dir, this.paths.journal));
    if (!journal) return;
    const incoming = await readCompressedJson<StoredBaseline>(join(workspace.dir, this.paths.incoming));
    const headMessage = await runGit(workspace.dir, ['log', '-1', '--pretty=%B']).catch(() => '');
    if (headMessage.includes(`OpenAlice-Template-Upgrade: ${journal.planDigest}`) && incoming) {
      const template = this.opts.aliceHarness ? await this.resolveTemplate(workspace) : this.opts.templates.get(journal.template);
      if (!template) throw new Error(`cannot recover missing template: ${journal.template}`);
      const commit = (await runGit(workspace.dir, ['rev-parse', 'HEAD'])).trim();
      await persistAppliedState(workspace.dir, {
        ...template,
        version: journal.toVersion,
      }, incoming.files, 'upgrade', commit, this.paths, journal.projection);
      await rm(join(workspace.dir, this.paths.transaction), { recursive: true, force: true });
      this.opts.logger.info('template_upgrade.recovered_committed', {
        workspaceId: workspace.id,
        commit,
      });
      return;
    }
    const before = await readCompressedJson<StoredBaseline>(join(workspace.dir, this.paths.before));
    if (!before) throw new Error('template upgrade recovery snapshot is missing');
    for (const path of journal.touchedPaths) {
      await writeSnapshotFile(workspace.dir, path, before.files[path] ?? missingFile());
    }
    if (journal.touchedPaths.length > 0) {
      await runGit(workspace.dir, ['reset', '-q', '--', ...journal.touchedPaths]).catch(() => '');
    }
    await rm(join(workspace.dir, this.paths.transaction), { recursive: true, force: true });
    this.opts.logger.warn('template_upgrade.recovered_rollback', {
      workspaceId: workspace.id,
      preparedAt: journal.preparedAt,
    });
  }
}

/** Record the exact launcher-managed assets in a newly-created Workspace. */
export async function initializeWorkspaceTemplateState(
  workspace: WorkspaceMeta,
  template: TemplateMeta,
): Promise<void> {
  const snapshot = await readManagedWorkspaceSnapshot(workspace.dir);
  const injected = Object.fromEntries(Object.entries(snapshot).filter(([path]) => isAliceHarnessSkillPath(path)));
  await persistAppliedState(workspace.dir, { ...template, name: 'alice-harness', version: await aliceHarnessSourceVersion() }, injected, 'creation', undefined, upgradePaths(true));
  if (template.upgradeStrategy !== 'managed-context') return;
  await ensureStateExcluded(workspace.dir);
  await persistAppliedState(workspace.dir, template, Object.fromEntries(Object.entries(snapshot).filter(([path]) => !isAliceHarnessSkillPath(path))), 'creation');
}

export function isManagedTemplatePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  if (['.agents', '.claude', '.pi'].some(root => normalized.startsWith(`${root}/skills/alice-stickers/`))) return false;
  if (
    normalized.startsWith('/')
    || normalized.includes('\0')
    || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) return false;
  return normalized === ALICE_HARNESS_CONFIG_PATH || MANAGED_ROOT_FILES.some((candidate) => normalized === candidate)
    || normalized.startsWith('.agents/skills/')
    || normalized.startsWith('.claude/skills/')
    // Old Pi injection duplicated the shared skill tree. Treat it as legacy
    // managed content so an unmodified copy can be removed during upgrade.
    || normalized.startsWith('.pi/skills/');
}

function resolveUpgradeableTemplate(
  workspace: WorkspaceMeta,
  templates: TemplateRegistry,
): TemplateMeta {
  if (!workspace.template) {
    throw new TemplateUpgradeError('unsupported', 'This legacy Workspace has no template lineage');
  }
  const template = templates.get(workspace.template);
  if (!template) {
    throw new TemplateUpgradeError('unsupported', `Template ${workspace.template} is unavailable`);
  }
  if (template.upgradeStrategy !== 'managed-context') {
    throw new TemplateUpgradeError(
      'unsupported',
      `${template.displayName ?? template.name} does not support in-place upgrade`,
    );
  }
  return template;
}

function isProjectionPath(path: string, skill: string): boolean {
  return MANAGED_TREE_ROOTS.some((root) => path.startsWith(`${root}/${skill}/`));
}

function classifyFile(
  path: string,
  base: SnapshotFile,
  local: SnapshotFile,
  incoming: SnapshotFile,
): TemplateUpgradeFilePlan {
  const current = preview(local);
  const next = preview(incoming);
  const operation = operationFor(local, incoming);
  if (sameFile(local, incoming)) {
    return {
      path,
      status: 'unchanged',
      operation: 'none',
      currentPreview: current.value,
      currentTruncated: current.truncated,
      templatePreview: next.value,
      templateTruncated: next.truncated,
      canUseTemplate: true,
    };
  }
  const localChanged = !sameFile(local, base);
  const incomingChanged = !sameFile(incoming, base);
  if (!localChanged && incomingChanged) {
    return {
      path,
      status: 'ready',
      operation,
      currentPreview: current.value,
      templatePreview: next.value,
      currentTruncated: current.truncated,
      templateTruncated: next.truncated,
      canUseTemplate: true,
    };
  }
  if (localChanged && !incomingChanged) {
    return {
      path,
      status: 'preserved',
      operation: 'keep',
      currentPreview: current.value,
      templatePreview: next.value,
      currentTruncated: current.truncated,
      templateTruncated: next.truncated,
      canUseTemplate: true,
      note: 'Changed only in this Workspace; it will stay as-is.',
    };
  }
  const canUseTemplate = local.kind !== 'other' && incoming.kind !== 'other';
  return {
    path,
    status: 'conflict',
    operation,
    currentPreview: current.value,
    templatePreview: next.value,
    currentTruncated: current.truncated,
    templateTruncated: next.truncated,
    canUseTemplate,
    ...(canUseTemplate
      ? { note: 'Both the Workspace and template changed this file.' }
      : { note: `Workspace entry is ${local.detail ?? 'not a regular file'}; repair it manually or keep it.` }),
  };
}

function operationFor(local: SnapshotFile, incoming: SnapshotFile): TemplateUpgradeFilePlan['operation'] {
  if (incoming.kind === 'missing') return 'remove';
  if (local.kind === 'missing') return 'add';
  return 'update';
}

function preview(file: SnapshotFile): { value: string | null; truncated: boolean } {
  if (file.kind === 'missing') return { value: null, truncated: false };
  if (file.kind === 'other') return { value: `[${file.detail ?? 'non-file entry'}]`, truncated: false };
  const content = file.content ?? '';
  return {
    value: content.length > MAX_PREVIEW_CHARS ? content.slice(0, MAX_PREVIEW_CHARS) : content,
    truncated: content.length > MAX_PREVIEW_CHARS,
  };
}

function digestPlan(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fileContent(content: string): SnapshotFile {
  return {
    kind: 'file',
    content,
    fingerprint: `file:${createHash('sha256').update(content).digest('hex')}`,
  };
}

function missingFile(): SnapshotFile {
  return { kind: 'missing', fingerprint: 'missing' };
}

function otherFile(detail: string): SnapshotFile {
  return {
    kind: 'other',
    detail,
    fingerprint: `other:${createHash('sha256').update(detail).digest('hex')}`,
  };
}

function sameFile(left: SnapshotFile, right: SnapshotFile): boolean {
  return left.kind === right.kind && left.fingerprint === right.fingerprint;
}

async function materializeTemplateSnapshot(
  template: TemplateMeta,
  workspaceId: string,
): Promise<Snapshot> {
  const dir = await mkdtemp(join(tmpdir(), `openalice-template-${template.name}-`));
  try {
    if (template.readmePath) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'README.md'), await readFile(template.readmePath, 'utf8'), 'utf8');
    }
    await injectWorkspaceContext({ template, wsId: workspaceId, dir, templateOnly: true });
    // Await inside the try. Returning the unresolved Promise would enter the
    // finally block first and delete the materialization while its recursive
    // reader is still walking — producing nondeterministic partial snapshots.
    return await readManagedWorkspaceSnapshot(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readManagedWorkspaceSnapshot(dir: string): Promise<Snapshot> {
  const files: Record<string, SnapshotFile> = {};
  for (const path of MANAGED_ROOT_FILES) {
    const file = await readLocalFile(dir, path);
    if (file.kind !== 'missing') files[path] = file;
  }
  // Never scan the whole Workspace. Template Upgrade owns three small trees;
  // walking research data, build output, or node_modules here is both wasteful
  // and makes a review endpoint scale with unrelated user files.
  for (const root of MANAGED_TREE_ROOTS) {
    if (await directoryPathIssue(dir, root)) continue;
    await walkFiles(dir, root, async (path) => {
      if (!isManagedTemplatePath(path)) return;
      files[path] = await readLocalFile(dir, path);
    });
  }
  return files;
}

async function walkFiles(
  root: string,
  rel: string,
  visit: (path: string) => Promise<void>,
): Promise<void> {
  const dir = join(root, rel);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isENOENT(err)) return;
    throw err;
  }
  for (const entry of entries) {
    if (rel === '' && (entry.name === '.git' || entry.name === 'node_modules')) continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walkFiles(root, path, visit);
    else await visit(path);
  }
}

async function readLocalFile(workspaceDir: string, path: string): Promise<SnapshotFile> {
  const abs = safePath(workspaceDir, path);
  const parentIssue = await parentPathIssue(workspaceDir, path);
  if (parentIssue) return otherFile(parentIssue);
  try {
    const stat = await lstat(abs);
    if (stat.isSymbolicLink()) return otherFile(`symlink -> ${await readlink(abs)}`);
    if (!stat.isFile()) return otherFile(stat.isDirectory() ? 'directory' : 'special entry');
    return fileContent(await readFile(abs, 'utf8'));
  } catch (err) {
    if (isENOENT(err)) return missingFile();
    throw err;
  }
}

async function writeSnapshotFile(
  workspaceDir: string,
  path: string,
  file: SnapshotFile,
): Promise<void> {
  if (!isManagedTemplatePath(path)) throw new Error(`refusing unmanaged template path: ${path}`);
  const abs = safePath(workspaceDir, path);
  const parentIssue = await parentPathIssue(workspaceDir, path);
  if (parentIssue) throw new Error(`refusing unsafe template path ${path}: ${parentIssue}`);
  if (file.kind === 'other') throw new Error(`cannot restore non-file entry: ${path}`);
  if (file.kind === 'missing') {
    await rm(abs, { recursive: true, force: true });
    await pruneManagedParents(workspaceDir, dirname(path));
    return;
  }
  await mkdir(dirname(abs), { recursive: true });
  const temp = `${abs}.openalice-template-upgrade.tmp`;
  await writeFile(temp, file.content ?? '', 'utf8');
  await rename(temp, abs);
}

async function pruneManagedParents(workspaceDir: string, start: string): Promise<void> {
  let current = start.replaceAll('\\', '/');
  while (current.startsWith('.agents/skills/') || current.startsWith('.claude/skills/') || current.startsWith('.pi/skills/')) {
    try {
      await rm(safePath(workspaceDir, current), { recursive: false });
    } catch {
      return;
    }
    current = dirname(current).replaceAll('\\', '/');
  }
}

async function readLegacyRootBaseline(workspaceDir: string): Promise<Snapshot> {
  const root = (await runGit(workspaceDir, ['rev-list', '--max-parents=0', 'HEAD'])).trim().split(/\s+/)[0];
  if (!root) throw new Error('Workspace has no root commit for legacy template baseline');
  const listed = await runGit(workspaceDir, ['ls-tree', '-r', '--name-only', root]);
  const paths = listed.split(/\r?\n/).filter(isManagedTemplatePath).sort();
  const files: Record<string, SnapshotFile> = {};
  for (const path of paths) {
    try {
      files[path] = fileContent(await runGit(workspaceDir, ['show', `${root}:${path}`]));
    } catch {
      files[path] = otherFile('non-text or non-blob entry in root commit');
    }
  }
  return files;
}

async function stagedPaths(workspaceDir: string): Promise<string[]> {
  const output = await runGit(workspaceDir, ['diff', '--cached', '--name-only']);
  return output.split(/\r?\n/).filter(Boolean);
}

async function ensureStateExcluded(workspaceDir: string, paths = TEMPLATE_PATHS): Promise<void> {
  const path = join(workspaceDir, '.git', 'info', 'exclude');
  await mkdir(dirname(path), { recursive: true });
  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch (err) {
    if (!isENOENT(err)) throw err;
  }
  const excludes = [paths.exclude, ...(paths.state === ALICE_HARNESS_VERSION_PATH ? [`/${ALICE_HARNESS_VERSION_PATH}`] : [])];
  const missing = excludes.filter((line) => !current.split(/\r?\n/).includes(line));
  if (!missing.length) return;
  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  await writeFile(path, `${current}${separator}${missing.join('\n')}\n`, 'utf8');
}

async function persistAppliedState(
  workspaceDir: string,
  template: TemplateMeta,
  baseline: Snapshot,
  source: TemplateUpgradeState['source'],
  commit?: string,
  paths = TEMPLATE_PATHS,
  projection?: SkillProjectionRequest & { version: string },
): Promise<void> {
  const appliedAt = new Date().toISOString();
  const previous = projection ? await readState(workspaceDir, paths) : null;
  const skillVersions = { ...(projection ? previous?.skillVersions : {}) };
  if (template.name === 'alice-harness') {
    for (const skill of ALICE_HARNESS_SKILLS) {
      if (projection && projection.skill !== skill) continue;
      if (Object.keys(baseline).some((path) => isProjectionPath(path, skill))) {
        skillVersions[skill] = { version: projection?.version ?? template.version, appliedAt };
      } else delete skillVersions[skill];
    }
  }
  await ensureStateExcluded(workspaceDir, paths);
  await writeCompressedJson(join(workspaceDir, paths.baseline), {
    schemaVersion: STATE_SCHEMA_VERSION,
    files: baseline,
  } satisfies StoredBaseline);
  await atomicWriteJson(join(workspaceDir, paths.state), {
    schemaVersion: STATE_SCHEMA_VERSION,
    template: template.name,
    appliedVersion: template.version,
    appliedAt,
    ...(template.name === 'alice-harness' ? { skillVersions } : {}),
    source,
    ...(commit ? { commit } : {}),
  } satisfies TemplateUpgradeState);
}

async function readState(workspaceDir: string, paths = TEMPLATE_PATHS): Promise<TemplateUpgradeState | null> {
  const parsed = await readJson<TemplateUpgradeState>(join(workspaceDir, paths.state));
  if (!parsed || parsed.schemaVersion !== STATE_SCHEMA_VERSION) return null;
  if (typeof parsed.template !== 'string' || typeof parsed.appliedVersion !== 'string') return null;
  return parsed;
}

async function readBaseline(workspaceDir: string, paths = TEMPLATE_PATHS): Promise<StoredBaseline | null> {
  const parsed = await readCompressedJson<StoredBaseline>(join(workspaceDir, paths.baseline));
  return parsed?.schemaVersion === STATE_SCHEMA_VERSION ? parsed : null;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

async function writeCompressedJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, await gzipAsync(Buffer.from(JSON.stringify(value))));
  await rename(temp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

async function readCompressedJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await gunzipAsync(await readFile(path));
    return JSON.parse(raw.toString('utf8')) as T;
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

function safePath(workspaceDir: string, relPath: string): string {
  const clean = normalize(relPath);
  if (clean === '..' || clean.startsWith(`..${sep}`)) throw new Error(`unsafe path: ${relPath}`);
  const root = resolve(workspaceDir);
  const abs = resolve(root, clean);
  if (abs !== root && !abs.startsWith(`${root}${sep}`)) throw new Error(`unsafe path: ${relPath}`);
  return abs;
}

async function parentPathIssue(workspaceDir: string, relPath: string): Promise<string | null> {
  const parts = relPath.replaceAll('\\', '/').split('/').slice(0, -1);
  let current = workspaceDir;
  const traversed: string[] = [];
  for (const part of parts) {
    current = join(current, part);
    traversed.push(part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) return `${traversed.join('/')} is a symlink`;
      if (!stat.isDirectory()) return `${traversed.join('/')} is not a directory`;
    } catch (err) {
      if (isENOENT(err)) return null;
      throw err;
    }
  }
  return null;
}

async function directoryPathIssue(workspaceDir: string, relPath: string): Promise<string | null> {
  const parentIssue = await parentPathIssue(workspaceDir, `${relPath}/__entry__`);
  if (parentIssue) return parentIssue;
  try {
    const stat = await lstat(safePath(workspaceDir, relPath));
    if (stat.isSymbolicLink()) return `${relPath} is a symlink`;
    if (!stat.isDirectory()) return `${relPath} is not a directory`;
    return null;
  } catch (err) {
    if (isENOENT(err)) return 'missing';
    throw err;
  }
}

function gitOptions(): IGitStringExecutionOptions {
  return {
    maxBuffer: MAX_GIT_BUFFER,
    signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
  };
}

async function runGit(workspaceDir: string, args: readonly string[]): Promise<string> {
  const result = await gitExec([...args], workspaceDir, gitOptions());
  if (result.exitCode !== 0) {
    let commandIndex = 0;
    while (args[commandIndex] === '-c') commandIndex += 2;
    const command = args[commandIndex] ?? args[0] ?? '';
    throw new Error(`git ${command} exited ${result.exitCode}: ${String(result.stderr).slice(0, 800)}`);
  }
  return String(result.stdout);
}

function blockerMessage(blockers: readonly string[]): string {
  if (blockers.includes('active_sessions')) {
    return 'Pause the Workspace sessions and headless work before upgrading its shared instructions.';
  }
  return 'Commit or unstage the current staged files before upgrading so the template gets its own clean Git commit.';
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
