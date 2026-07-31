import type { AdapterRegistry } from './cli-adapter.js';
import type { Logger } from './logger.js';
import type { ResumeRegistry } from './resume-registry.js';
import {
  normalizeSessionTitle,
  type SessionRecord,
  type SessionRegistry,
} from './session-registry.js';
import type { WorkspaceMeta } from './workspace-registry.js';

const DEFAULT_RETRY_MS = 30_000;
const RESOLVED_REFRESH_MS = 5 * 60_000;

/**
 * Best-effort bridge from launcher-owned Session records to the native
 * runtime's presentation metadata. Reads run in the background; callers keep
 * rendering the launch prompt until a native title is available.
 */
export class NativeSessionTitleResolver {
  private readonly attemptedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      sessionRegistry: SessionRegistry;
      resumeRegistry: ResumeRegistry;
      adapters: AdapterRegistry;
      logger: Logger;
      retryMs?: number;
    },
  ) {}

  async refreshWorkspace(meta: WorkspaceMeta): Promise<void> {
    await this.deps.sessionRegistry.ensureLoaded(meta.id);
    await Promise.all(
      this.deps.sessionRegistry.listFor(meta.id).map((record) => this.refreshRecord(meta, record)),
    );
  }

  private async refreshRecord(meta: WorkspaceMeta, record: SessionRecord): Promise<void> {
    const recordKey = `${meta.id}\0${record.id}`;
    const existing = this.inFlight.get(recordKey);
    if (existing) return existing;

    const adapter = this.deps.adapters.get(record.agent);
    if (!adapter?.readSessionTitle) return;
    const nativeSessionId = this.deps.resumeRegistry.get(record.resumeId)?.agentSessionId
      ?? record.resumeHint?.value;
    if (!nativeSessionId) return;

    const now = Date.now();
    const retryMs = this.deps.retryMs
      ?? (normalizeSessionTitle(record.title) ? RESOLVED_REFRESH_MS : DEFAULT_RETRY_MS);
    if (now - (this.attemptedAt.get(recordKey) ?? 0) < retryMs) return;
    this.attemptedAt.set(recordKey, now);

    const refresh = (async () => {
      try {
        const title = normalizeSessionTitle(
          await adapter.readSessionTitle!(meta.dir, nativeSessionId),
        );
        if (!title) return;
        if (title === normalizeSessionTitle(record.title)) return;
        await this.deps.sessionRegistry.update(meta.id, record.id, { title });
      } catch (error) {
        this.deps.logger.warn('session_title.refresh_failed', {
          wsId: meta.id,
          recordId: record.id,
          agent: record.agent,
          error,
        });
      }
    })().finally(() => {
      this.inFlight.delete(recordKey);
    });
    this.inFlight.set(recordKey, refresh);
    return refresh;
  }
}
