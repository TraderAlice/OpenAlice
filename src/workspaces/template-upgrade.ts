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

import { exec as gitExec, type IGitStringExecutionOptions } from 'dugite';

import { injectWorkspaceContext } from './context-injector.js';
import type { Logger } from './logger.js';
import type { TemplateMeta, TemplateRegistry } from './template-registry.js';
import { WorkspaceOperationGuard } from './workspace-operation-guard.js';
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js';
import type { WorkspaceRuntimeActivity } from './workspace-runtime-activity.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const STATE_SCHEMA_VERSION = 1 as const;
const STATE_REL = '.alice/template-upgrade/state.json';
const BASELINE_REL = '.alice/template-upgrade/baseline.json.gz';
const TRANSACTION_DIR_REL = '.alice/template-upgrade/transaction';
const JOURNAL_REL = `${TRANSACTION_DIR_REL}/journal.json`;
const BEFORE_REL = `${TRANSACTION_DIR_REL}/before.json.gz`;
const INCOMING_REL = `${TRANSACTION_DIR_REL}/incoming.json.gz`;
const EXCLUDE_LINE = '/.alice/template-upgrade/';
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
}

interface UpgradeJournal {
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

export interface ApplyTemplateUpgradeInput {
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

  constructor(private readonly opts: TemplateUpgradeManagerOptions) {
    this.operationGuard = opts.operationGuard ?? new WorkspaceOperationGuard();
  }

  async recover(): Promise<void> {
    for (const workspace of this.opts.registry.list()) {
      if (!existsSync(join(workspace.dir, JOURNAL_REL))) continue;
      await this.recoverWorkspace(workspace).catch((err) =>
        this.opts.logger.error('template_upgrade.recovery_failed', {
          workspaceId: workspace.id,
          err,
        }),
      );
    }
  }

  async currentVersion(workspace: WorkspaceMeta): Promise<string | undefined> {
    const state = await readState(workspace.dir);
    if (state && state.template === workspace.template) return state.appliedVersion;
    return workspace.spawnedFromVersion;
  }

  async plan(workspaceId: string): Promise<TemplateUpgradePlan> {
    const lease = await this.operationGuard.acquireWhenAvailable(workspaceId, 'template-upgrade-preview');
    try {
      const workspace = this.opts.registry.get(workspaceId);
      if (!workspace) throw new TemplateUpgradeError('not_found', 'Workspace not found');
      const template = resolveUpgradeableTemplate(workspace, this.opts.templates);
      await this.recoverWorkspace(workspace);
      const incoming = await this.materializeTemplate(template, workspace.id);
      return this.buildPlan(workspace, template, incoming);
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
    const template = resolveUpgradeableTemplate(workspace, this.opts.templates);
    await this.recoverWorkspace(workspace);

    // Materialize once: the exact Incoming snapshot included in the reviewed
    // digest is also the one written to disk. Regenerating it after validation
    // would leave a small but real time-of-check/time-of-use race.
    const incoming = await this.materializeTemplate(template, workspace.id);
    const plan = await this.buildPlan(workspace, template, incoming);
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
    if (plan.fromVersion === plan.toVersion) {
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
      toVersion: plan.toVersion,
      planDigest: plan.planDigest,
      touchedPaths: changedPaths,
      preparedAt: new Date().toISOString(),
    };

    await ensureStateExcluded(workspace.dir);
    await writeCompressedJson(join(workspace.dir, BEFORE_REL), {
      schemaVersion: STATE_SCHEMA_VERSION,
      files: before,
    } satisfies StoredBaseline);
    await writeCompressedJson(join(workspace.dir, INCOMING_REL), {
      schemaVersion: STATE_SCHEMA_VERSION,
      files: incoming,
    } satisfies StoredBaseline);
    await atomicWriteJson(join(workspace.dir, JOURNAL_REL), journal);

    try {
      for (const path of changedPaths) {
        await writeSnapshotFile(workspace.dir, path, incoming[path] ?? missingFile());
      }
      if (changedPaths.length > 0) {
        await runGit(workspace.dir, ['add', '-A', '--', ...changedPaths]);
      }
      const message = [
        `template(${template.name}): upgrade ${plan.fromVersion} -> ${plan.toVersion}`,
        '',
        `OpenAlice-Template-Upgrade: ${plan.planDigest}`,
      ].join('\n');
      await runGit(workspace.dir, [
        '-c', 'user.email=launcher@local',
        '-c', 'user.name=OpenAlice',
        'commit', '--allow-empty', '-q', '-m', message,
      ]);
      const commit = (await runGit(workspace.dir, ['rev-parse', 'HEAD'])).trim();
      await persistAppliedState(workspace.dir, template, incoming, 'upgrade', commit);
      await rm(join(workspace.dir, TRANSACTION_DIR_REL), { recursive: true, force: true });
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
  ): Promise<TemplateUpgradePlan> {
    const state = await readState(workspace.dir);
    const stored = state?.template === template.name ? await readBaseline(workspace.dir) : null;
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
      .filter(isManagedTemplatePath)
      .sort();
    const localEntries = await Promise.all(paths.map((path) => readLocalFile(workspace.dir, path)));
    const files = paths.map((path, index) => classifyFile(
      path,
      baseline[path] ?? missingFile(),
      localEntries[index] ?? missingFile(),
      incoming[path] ?? missingFile(),
    ));
    const activity = this.opts.workspaceRuntimeActivity?.(workspace.id) ?? {
      busy: false,
      sessions: [],
      headless: [],
    };
    const blockers: string[] = [];
    if (activity.busy) blockers.push('active_sessions');
    if ((await stagedPaths(workspace.dir)).length > 0) blockers.push('staged_changes');
    const fromVersion = state?.template === template.name
      ? state.appliedVersion
      : workspace.spawnedFromVersion ?? 'unknown';
    const planDigest = digestPlan({
      workspaceId: workspace.id,
      template: template.name,
      fromVersion,
      toVersion: template.version,
      baseline,
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

  private materializeTemplate(template: TemplateMeta, workspaceId: string): Promise<Snapshot> {
    return this.opts.materializeTemplate
      ? this.opts.materializeTemplate(template, workspaceId)
      : materializeTemplateSnapshot(template, workspaceId);
  }

  private async recoverWorkspace(workspace: WorkspaceMeta): Promise<void> {
    const journal = await readJson<UpgradeJournal>(join(workspace.dir, JOURNAL_REL));
    if (!journal) return;
    const incoming = await readCompressedJson<StoredBaseline>(join(workspace.dir, INCOMING_REL));
    const headMessage = await runGit(workspace.dir, ['log', '-1', '--pretty=%B']).catch(() => '');
    if (headMessage.includes(`OpenAlice-Template-Upgrade: ${journal.planDigest}`) && incoming) {
      const template = this.opts.templates.get(journal.template);
      if (!template) throw new Error(`cannot recover missing template: ${journal.template}`);
      const commit = (await runGit(workspace.dir, ['rev-parse', 'HEAD'])).trim();
      await persistAppliedState(workspace.dir, {
        ...template,
        version: journal.toVersion,
      }, incoming.files, 'upgrade', commit);
      await rm(join(workspace.dir, TRANSACTION_DIR_REL), { recursive: true, force: true });
      this.opts.logger.info('template_upgrade.recovered_committed', {
        workspaceId: workspace.id,
        commit,
      });
      return;
    }
    const before = await readCompressedJson<StoredBaseline>(join(workspace.dir, BEFORE_REL));
    if (!before) throw new Error('template upgrade recovery snapshot is missing');
    for (const path of journal.touchedPaths) {
      await writeSnapshotFile(workspace.dir, path, before.files[path] ?? missingFile());
    }
    if (journal.touchedPaths.length > 0) {
      await runGit(workspace.dir, ['reset', '-q', '--', ...journal.touchedPaths]).catch(() => '');
    }
    await rm(join(workspace.dir, TRANSACTION_DIR_REL), { recursive: true, force: true });
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
  if (template.upgradeStrategy !== 'managed-context') return;
  const snapshot = await readManagedWorkspaceSnapshot(workspace.dir);
  await ensureStateExcluded(workspace.dir);
  await persistAppliedState(workspace.dir, template, snapshot, 'creation');
}

export function isManagedTemplatePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  if (
    normalized.startsWith('/')
    || normalized.includes('\0')
    || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) return false;
  return MANAGED_ROOT_FILES.some((candidate) => normalized === candidate)
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
    await injectWorkspaceContext({ template, wsId: workspaceId, dir });
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

async function ensureStateExcluded(workspaceDir: string): Promise<void> {
  const path = join(workspaceDir, '.git', 'info', 'exclude');
  await mkdir(dirname(path), { recursive: true });
  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch (err) {
    if (!isENOENT(err)) throw err;
  }
  if (current.split(/\r?\n/).includes(EXCLUDE_LINE)) return;
  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  await writeFile(path, `${current}${separator}${EXCLUDE_LINE}\n`, 'utf8');
}

async function persistAppliedState(
  workspaceDir: string,
  template: TemplateMeta,
  baseline: Snapshot,
  source: TemplateUpgradeState['source'],
  commit?: string,
): Promise<void> {
  await ensureStateExcluded(workspaceDir);
  await writeCompressedJson(join(workspaceDir, BASELINE_REL), {
    schemaVersion: STATE_SCHEMA_VERSION,
    files: baseline,
  } satisfies StoredBaseline);
  await atomicWriteJson(join(workspaceDir, STATE_REL), {
    schemaVersion: STATE_SCHEMA_VERSION,
    template: template.name,
    appliedVersion: template.version,
    appliedAt: new Date().toISOString(),
    source,
    ...(commit ? { commit } : {}),
  } satisfies TemplateUpgradeState);
}

async function readState(workspaceDir: string): Promise<TemplateUpgradeState | null> {
  const parsed = await readJson<TemplateUpgradeState>(join(workspaceDir, STATE_REL));
  if (!parsed || parsed.schemaVersion !== STATE_SCHEMA_VERSION) return null;
  if (typeof parsed.template !== 'string' || typeof parsed.appliedVersion !== 'string') return null;
  return parsed;
}

async function readBaseline(workspaceDir: string): Promise<StoredBaseline | null> {
  const parsed = await readCompressedJson<StoredBaseline>(join(workspaceDir, BASELINE_REL));
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
