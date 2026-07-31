import type { SessionRegistry } from './session-registry.js';
import type { CreateResult, WorkspaceCreator } from './workspace-creator.js';
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js';

export const CHAT_WORKSPACE_TEMPLATE = 'chat';
export const AUTO_QUANT_WORKSPACE_TEMPLATE = 'auto-quant-v2';

type CreateFailure = Extract<CreateResult, { readonly ok: false }>;

export type TemplateWorkspaceResolution =
  | { readonly ok: true; readonly workspace: WorkspaceMeta }
  | CreateFailure
  | { readonly ok: false; readonly code: 'create_failed'; readonly message: string };
export type ChatWorkspaceResolution = TemplateWorkspaceResolution;

interface TemplateWorkspaceResolverDeps {
  readonly registry: Pick<WorkspaceRegistry, 'get' | 'list'>;
  readonly sessionRegistry: Pick<SessionRegistry, 'ensureLoaded' | 'listFor'>;
  readonly creator: Pick<WorkspaceCreator, 'create'>;
}

/**
 * Owns the single durable Chat Workspace selection policy used by both the
 * Quick Chat entry point and onboarding runtime probes.
 *
 * The in-process gate prevents two first-use callers from creating parallel
 * starter workspaces. WorkspaceCreator remains the durable tag/registry guard.
 */
export class TemplateWorkspaceResolver {
  private gate: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: TemplateWorkspaceResolverDeps,
    private readonly templateName: string,
    private readonly starterTagBase: string,
  ) {}

  resolveOrCreate(
    preferredWorkspaceId?: string | null,
    sourceVersion?: string,
  ): Promise<TemplateWorkspaceResolution> {
    const run = this.gate
      .catch(() => undefined)
      .then(() => this.resolveOrCreateUnlocked(preferredWorkspaceId, sourceVersion));
    this.gate = run;
    return run;
  }

  private async workspaceActivityMs(meta: WorkspaceMeta): Promise<number> {
    await this.deps.sessionRegistry.ensureLoaded(meta.id);
    const active = this.deps.sessionRegistry
      .listFor(meta.id)
      .map((session) => Date.parse(session.lastActiveAt))
      .filter(Number.isFinite);
    const created = Date.parse(meta.createdAt);
    return active.length > 0
      ? Math.max(...active)
      : Number.isFinite(created) ? created : 0;
  }

  private async mostRecentlyActiveWorkspace(): Promise<WorkspaceMeta | undefined> {
    const workspaces = this.deps.registry
      .list()
      .filter((workspace) => workspace.template === this.templateName);
    if (workspaces.length <= 1) return workspaces[0];
    const ranked = await Promise.all(workspaces.map(async (workspace) => ({
      workspace,
      activity: await this.workspaceActivityMs(workspace),
    })));
    ranked.sort((a, b) => b.activity - a.activity);
    return ranked[0]?.workspace;
  }

  private starterTag(): string {
    const tags = new Set(this.deps.registry.list().map((workspace) => workspace.tag));
    if (!tags.has(this.starterTagBase)) return this.starterTagBase;
    let suffix = 2;
    while (tags.has(`${this.starterTagBase}-${suffix}`)) suffix += 1;
    return `${this.starterTagBase}-${suffix}`;
  }

  private async resolveOrCreateUnlocked(
    preferredWorkspaceId?: string | null,
    sourceVersion?: string,
  ): Promise<TemplateWorkspaceResolution> {
    const preferred = preferredWorkspaceId
      ? this.deps.registry.get(preferredWorkspaceId)
      : undefined;
    if (preferred?.template === this.templateName) {
      return { ok: true, workspace: preferred };
    }

    const existing = await this.mostRecentlyActiveWorkspace();
    if (existing) return { ok: true, workspace: existing };

    let created: CreateResult;
    try {
      created = sourceVersion === undefined
        ? await this.deps.creator.create(this.starterTag(), this.templateName)
        : await this.deps.creator.create(
            this.starterTag(),
            this.templateName,
            sourceVersion,
          );
    } catch (error) {
      // A concurrent or external creator may have committed a Chat workspace.
      const after = await this.mostRecentlyActiveWorkspace();
      if (after) return { ok: true, workspace: after };
      return {
        ok: false,
        code: 'create_failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (created.ok) return { ok: true, workspace: created.workspace };
    if (created.code === 'tag_in_use') {
      const after = await this.mostRecentlyActiveWorkspace();
      if (after) return { ok: true, workspace: after };
    }
    return created;
  }
}

export class ChatWorkspaceResolver extends TemplateWorkspaceResolver {
  constructor(deps: TemplateWorkspaceResolverDeps) {
    super(deps, CHAT_WORKSPACE_TEMPLATE, CHAT_WORKSPACE_TEMPLATE);
  }
}
