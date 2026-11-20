export interface WorkspaceOperationLease {
  readonly workspaceId: string;
  readonly operation: string;
  release(): void;
}

export interface WorkspaceOperationGroupLease {
  readonly workspaceIds: readonly string[];
  readonly operation: string;
  release(): void;
}

/**
 * Serializes directory-wide Workspace mutations inside the Alice process.
 *
 * Template Upgrade, offboarding, and a future Merge/Absorb flow have different
 * domain rules, but none may rename or reconcile the same checkout while
 * another one is in flight. The lease is deliberately synchronous so there is
 * no gap between checking availability and claiming the Workspace.
 */
export class WorkspaceOperationGuard {
  private readonly active = new Map<string, string>();
  private readonly shared = new Map<string, Array<{ token: symbol; operation: string }>>();
  private readonly waiters = new Map<string, Array<() => void>>();

  acquire(workspaceId: string, operation: string): WorkspaceOperationLease | null {
    if (this.active.has(workspaceId) || (this.shared.get(workspaceId)?.length ?? 0) > 0) return null;
    this.active.set(workspaceId, operation);
    let released = false;
    return {
      workspaceId,
      operation,
      release: () => {
        if (released) return;
        released = true;
        if (this.active.get(workspaceId) === operation) {
          this.active.delete(workspaceId);
          this.notify(workspaceId);
        }
      },
    };
  }

  /**
   * Process start-leases (headless-run, headless-probe, web-session-start,
   * interactive-session-start) coexist with each other: they only exist to
   * block directory-wide exclusive mutations during the brief pre-spawn
   * window before a child PID is registered. Concurrency across processes is
   * bounded elsewhere (MAX_CONCURRENT_HEADLESS, per-resumeId claims).
   */
  acquireShared(workspaceId: string, operation: string): WorkspaceOperationLease | null {
    if (this.active.has(workspaceId)) return null;
    const entry = { token: Symbol(), operation };
    const leases = this.shared.get(workspaceId) ?? [];
    leases.push(entry);
    this.shared.set(workspaceId, leases);
    let released = false;
    return {
      workspaceId,
      operation,
      release: () => {
        if (released) return;
        released = true;
        const current = this.shared.get(workspaceId);
        if (!current) return;
        const idx = current.indexOf(entry);
        if (idx === -1) return;
        current.splice(idx, 1);
        if (current.length === 0) {
          this.shared.delete(workspaceId);
          this.notify(workspaceId);
        }
      },
    };
  }

  private notify(workspaceId: string): void {
    this.waiters.get(workspaceId)?.shift()?.();
    if (this.waiters.get(workspaceId)?.length === 0) this.waiters.delete(workspaceId);
  }


  /**
   * Atomically claim several Workspaces in stable id order. No partial lease
   * escapes: a collision releases every claim already made. This is the
   * deadlock-free primitive for directional source -> target operations.
   */
  acquireMany(workspaceIds: readonly string[], operation: string): WorkspaceOperationGroupLease | null {
    const ids = [...new Set(workspaceIds)].sort();
    const leases: WorkspaceOperationLease[] = [];
    for (const id of ids) {
      const lease = this.acquire(id, operation);
      if (!lease) {
        for (const acquired of leases.reverse()) acquired.release();
        return null;
      }
      leases.push(lease);
    }
    let released = false;
    return {
      workspaceIds: ids,
      operation,
      release: () => {
        if (released) return;
        released = true;
        for (const lease of leases.reverse()) lease.release();
      },
    };
  }

  async acquireManyWhenAvailable(
    workspaceIds: readonly string[],
    operation: string,
  ): Promise<WorkspaceOperationGroupLease> {
    const ids = [...new Set(workspaceIds)].sort();
    for (;;) {
      const lease = this.acquireMany(ids, operation);
      if (lease) return lease;
      const busyIds = ids.filter((id) => this.active.has(id) || (this.shared.get(id)?.length ?? 0) > 0);
      // A lease can be released between acquireMany() observing the collision
      // and this snapshot. Promise.race([]) never settles, so retry instead of
      // turning that harmless release race into a permanent preview hang.
      if (busyIds.length === 0) continue;
      await Promise.race(busyIds.map((id) => this.waitForRelease(id)));
    }
  }

  /**
   * Read/review operations may queue behind a directory mutation instead of
   * flashing a transient busy error. Mutating callers still use `acquire()`
   * so a duplicate apply/offboard request fails explicitly.
   */
  async acquireWhenAvailable(workspaceId: string, operation: string): Promise<WorkspaceOperationLease> {
    for (;;) {
      const lease = this.acquire(workspaceId, operation);
      if (lease) return lease;
      await new Promise<void>((resolve) => {
        const queue = this.waiters.get(workspaceId) ?? [];
        queue.push(resolve);
        this.waiters.set(workspaceId, queue);
      });
    }
  }

  current(workspaceId: string): string | null {
    return this.active.get(workspaceId) ?? this.shared.get(workspaceId)?.[0]?.operation ?? null;
  }

  private waitForRelease(workspaceId: string): Promise<void> {
    if (!this.active.has(workspaceId) && (this.shared.get(workspaceId)?.length ?? 0) === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const queue = this.waiters.get(workspaceId) ?? [];
      queue.push(resolve);
      this.waiters.set(workspaceId, queue);
    });
  }
}
