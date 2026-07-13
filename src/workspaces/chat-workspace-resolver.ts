import type { SessionRegistry } from './session-registry.js';
import type { CreateResult, WorkspaceCreator } from './workspace-creator.js';
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js';

export const CHAT_WORKSPACE_TEMPLATE = 'chat';

type CreateFailure = Extract<CreateResult, { readonly ok: false }>;

export type ChatWorkspaceResolution =
  | { readonly ok: true; readonly workspace: WorkspaceMeta }
  | CreateFailure
  | { readonly ok: false; readonly code: 'create_failed'; readonly message: string };

interface ChatWorkspaceResolverDeps {
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
export class ChatWorkspaceResolver {
  private gate: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ChatWorkspaceResolverDeps) {}

  resolveOrCreate(preferredWorkspaceId?: string | null): Promise<ChatWorkspaceResolution> {
    const run = this.gate
      .catch(() => undefined)
      .then(() => this.resolveOrCreateUnlocked(preferredWorkspaceId));
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

  private async mostRecentlyActiveChat(): Promise<WorkspaceMeta | undefined> {
    const chats = this.deps.registry
      .list()
      .filter((workspace) => workspace.template === CHAT_WORKSPACE_TEMPLATE);
    if (chats.length <= 1) return chats[0];
    const ranked = await Promise.all(chats.map(async (workspace) => ({
      workspace,
      activity: await this.workspaceActivityMs(workspace),
    })));
    ranked.sort((a, b) => b.activity - a.activity);
    return ranked[0]?.workspace;
  }

  private starterTag(): string {
    const tags = new Set(this.deps.registry.list().map((workspace) => workspace.tag));
    if (!tags.has(CHAT_WORKSPACE_TEMPLATE)) return CHAT_WORKSPACE_TEMPLATE;
    let suffix = 2;
    while (tags.has(`${CHAT_WORKSPACE_TEMPLATE}-${suffix}`)) suffix += 1;
    return `${CHAT_WORKSPACE_TEMPLATE}-${suffix}`;
  }

  private async resolveOrCreateUnlocked(
    preferredWorkspaceId?: string | null,
  ): Promise<ChatWorkspaceResolution> {
    const preferred = preferredWorkspaceId
      ? this.deps.registry.get(preferredWorkspaceId)
      : undefined;
    if (preferred?.template === CHAT_WORKSPACE_TEMPLATE) {
      return { ok: true, workspace: preferred };
    }

    const existing = await this.mostRecentlyActiveChat();
    if (existing) return { ok: true, workspace: existing };

    let created: CreateResult;
    try {
      created = await this.deps.creator.create(this.starterTag(), CHAT_WORKSPACE_TEMPLATE);
    } catch (error) {
      // A concurrent or external creator may have committed a Chat workspace.
      const after = await this.mostRecentlyActiveChat();
      if (after) return { ok: true, workspace: after };
      return {
        ok: false,
        code: 'create_failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (created.ok) return { ok: true, workspace: created.workspace };
    if (created.code === 'tag_in_use') {
      const after = await this.mostRecentlyActiveChat();
      if (after) return { ok: true, workspace: after };
    }
    return created;
  }
}
