import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Logger } from './logger.js';

/**
 * Persistent session-identity record. Lives across server restart so the user
 * can pause a session today and resume it tomorrow. The `id` is the stable
 * launcher-owned record id used in every cross-system reference (URL hash,
 * WebSocket query, REST route) — what we previously called `sessionToken`
 * (transient, in-memory).
 *
 * `state` is the launcher's view: 'running' means we have a live PTY in the
 * pool keyed by this id; 'paused' means the record exists but no PTY. On a
 * crash recovery we flip any 'running' to 'paused' (see `bootFixup`).
 *
 * `resumeHint` is adapter-specific guidance written when the adapter has
 * enough information to recover the agent's own session id (claude's JSONL
 * UUID, discovered by the transcript watcher). Codex doesn't have this — its
 * `resume --last` is cwd-filtered so we don't need to track the id ourselves.
 *
 * `scrollbackFile` is a path **relative to** the launcher's scrollback dir
 * (see `scrollback-store.ts`), populated when a shell session is paused so
 * the prior xterm buffer can be restored on resume.
 */
export interface SessionRecord {
  readonly id: string;
  readonly wsId: string;
  readonly agent: string;
  readonly name: string;
  readonly createdAt: string;
  lastActiveAt: string;
  state: 'running' | 'paused';
  resumeHint?: { kind: 'agent-session-id'; value: string };
  scrollbackFile?: string;
  /**
   * The user's first message, captured when the session is seeded (quick-chat).
   * Surfaced as a human-readable title in the chat sidebar instead of the sticky
   * `c1` name. Only present for seeded sessions; absent ones fall back to `name`.
   * Stored capped — we don't need the whole prompt for a one-line title.
   */
  readonly title?: string;
}

interface FileShape {
  readonly version: 1;
  readonly records: SessionRecord[];
}

const SESSION_FILE_RE = /^[A-Za-z0-9_-]+\.json$/;

/**
 * Per-workspace persistent registry of SessionRecords. Each workspace gets
 * its own file at `${stateRoot}/sessions/<wsId>.json` (atomic write via
 * temp-file + rename, same pattern as `WorkspaceRegistry`).
 *
 * Loaded lazily: a workspace's records are only read from disk when first
 * needed (most workspaces never get touched in a given server lifetime).
 * `bootFixup()` is called once at startup on every existing file so we can
 * flip orphaned 'running' records to 'paused' before any UI sees them.
 *
 * Writes flush the touched workspace's file only — never all of them.
 */
export class SessionRegistry {
  /** wsId → (recordId → record) */
  private readonly byWs = new Map<string, Map<string, SessionRecord>>();
  /** wsId set of workspaces whose file has been loaded (or known-absent). */
  private readonly loaded = new Set<string>();

  private constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {}

  /**
   * One-shot factory. Creates the sessions directory and runs `bootFixup`
   * across every existing session file so orphaned 'running' records flip
   * to 'paused' before the rest of the server comes online.
   */
  static async load(stateRoot: string, logger: Logger): Promise<SessionRegistry> {
    const dir = join(stateRoot, 'sessions');
    await mkdir(dir, { recursive: true });
    const reg = new SessionRegistry(dir, logger);
    await reg.bootFixup();
    return reg;
  }

  private async bootFixup(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return;
    }
    let orphaned = 0;
    for (const name of files) {
      if (!SESSION_FILE_RE.test(name)) continue;
      const wsId = name.slice(0, -'.json'.length);
      await this.ensureLoaded(wsId);
      const records = this.byWs.get(wsId);
      if (!records || records.size === 0) continue;
      let touched = false;
      const now = new Date().toISOString();
      for (const rec of records.values()) {
        if (rec.state === 'running') {
          rec.state = 'paused';
          rec.lastActiveAt = now;
          orphaned += 1;
          touched = true;
          this.logger.warn('session.orphaned_on_boot', {
            wsId,
            id: rec.id,
            agent: rec.agent,
            name: rec.name,
          });
        }
      }
      if (touched) await this.flush(wsId);
    }
    if (orphaned > 0) {
      this.logger.info('session_registry.boot_fixup', { orphaned });
    }
  }

  /**
   * Force-load the records for one workspace (no-op if already loaded or
   * the file doesn't exist). New workspaces start with an empty map.
   */
  async ensureLoaded(wsId: string): Promise<void> {
    if (this.loaded.has(wsId)) return;
    const path = join(this.dir, `${wsId}.json`);
    if (!existsSync(path)) {
      this.byWs.set(wsId, new Map());
      this.loaded.add(wsId);
      return;
    }
    try {
      const raw = await readFile(path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const records = validateFile(parsed);
      const map = new Map<string, SessionRecord>();
      for (const r of records) map.set(r.id, r);
      this.byWs.set(wsId, map);
    } catch (err) {
      this.logger.error('session_registry.load_failed', { wsId, path, err });
      this.byWs.set(wsId, new Map());
    }
    this.loaded.add(wsId);
  }

  listFor(wsId: string): SessionRecord[] {
    const records = this.byWs.get(wsId);
    if (!records) return [];
    return Array.from(records.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1,
    );
  }

  get(wsId: string, id: string): SessionRecord | undefined {
    return this.byWs.get(wsId)?.get(id);
  }

  /** Find a record by id without knowing its wsId (record ids are global). */
  findById(id: string): SessionRecord | undefined {
    for (const records of this.byWs.values()) {
      const r = records.get(id);
      if (r) return r;
    }
    return undefined;
  }

  async create(record: SessionRecord): Promise<void> {
    await this.ensureLoaded(record.wsId);
    const records = this.byWs.get(record.wsId)!;
    if (records.has(record.id)) {
      throw new Error(`session record already exists: ${record.id}`);
    }
    records.set(record.id, record);
    await this.flush(record.wsId);
  }

  async update(
    wsId: string,
    id: string,
    patch: Partial<Omit<SessionRecord, 'id' | 'wsId' | 'agent' | 'name' | 'createdAt'>>,
  ): Promise<SessionRecord | undefined> {
    await this.ensureLoaded(wsId);
    const records = this.byWs.get(wsId);
    const rec = records?.get(id);
    if (!records || !rec) return undefined;
    Object.assign(rec, patch);
    await this.flush(wsId);
    return rec;
  }

  async remove(wsId: string, id: string): Promise<SessionRecord | undefined> {
    await this.ensureLoaded(wsId);
    const records = this.byWs.get(wsId);
    if (!records) return undefined;
    const rec = records.get(id);
    if (!rec) return undefined;
    records.delete(id);
    await this.flush(wsId);
    return rec;
  }

  /** Drop everything for a workspace (called from workspace DELETE). */
  async removeAllFor(wsId: string): Promise<readonly SessionRecord[]> {
    await this.ensureLoaded(wsId);
    const records = this.byWs.get(wsId);
    if (!records || records.size === 0) return [];
    const all = Array.from(records.values());
    records.clear();
    await this.flush(wsId);
    return all;
  }

  /**
   * Derive a sticky per-(workspace, agent) name like `c1` / `x2`. Reads
   * existing records for the workspace; picks `max(suffix) + 1`, so deleted
   * names are NOT recycled — historical references to `c1` always point to
   * the same logical session.
   */
  nextName(wsId: string, agent: string, prefix: string): string {
    const records = this.byWs.get(wsId);
    if (!records) return `${prefix}1`;
    let max = 0;
    const re = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`);
    for (const r of records.values()) {
      if (r.agent !== agent) continue;
      const m = re.exec(r.name);
      if (!m) continue;
      const n = Number.parseInt(m[1]!, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${prefix}${max + 1}`;
  }

  private async flush(wsId: string): Promise<void> {
    const records = this.byWs.get(wsId);
    if (!records) return;
    const payload: FileShape = {
      version: 1,
      records: Array.from(records.values()),
    };
    const path = join(this.dir, `${wsId}.json`);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await rename(tmp, path);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateFile(value: unknown): SessionRecord[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error('sessions.json: root must be an object');
  }
  const v = value as Record<string, unknown>;
  if (v['version'] !== 1) {
    throw new Error(`sessions.json: unsupported version ${String(v['version'])}`);
  }
  if (!Array.isArray(v['records'])) {
    throw new Error('sessions.json: records must be an array');
  }
  const out: SessionRecord[] = [];
  for (let i = 0; i < v['records'].length; i++) {
    const e = v['records'][i];
    if (typeof e !== 'object' || e === null) {
      throw new Error(`sessions.json: record ${i} not an object`);
    }
    const r = e as Record<string, unknown>;
    if (
      typeof r['id'] !== 'string' ||
      typeof r['wsId'] !== 'string' ||
      typeof r['agent'] !== 'string' ||
      typeof r['name'] !== 'string' ||
      typeof r['createdAt'] !== 'string' ||
      typeof r['lastActiveAt'] !== 'string' ||
      (r['state'] !== 'running' && r['state'] !== 'paused')
    ) {
      throw new Error(`sessions.json: record ${i} has wrong shape`);
    }
    const base: SessionRecord = {
      id: r['id'],
      wsId: r['wsId'],
      agent: r['agent'],
      name: r['name'],
      createdAt: r['createdAt'],
      lastActiveAt: r['lastActiveAt'],
      state: r['state'],
      // Carry the session title (the captured first message) across reloads —
      // it's written to disk by `flush`, so it must be read back here too, or
      // every server restart / registry reload reverts the row to the `c1` name.
      ...(typeof r['title'] === 'string' ? { title: r['title'] } : {}),
    };
    const hint = r['resumeHint'];
    if (
      typeof hint === 'object' && hint !== null &&
      (hint as Record<string, unknown>)['kind'] === 'agent-session-id' &&
      typeof (hint as Record<string, unknown>)['value'] === 'string'
    ) {
      base.resumeHint = { kind: 'agent-session-id', value: (hint as { value: string }).value };
    }
    if (typeof r['scrollbackFile'] === 'string') {
      base.scrollbackFile = r['scrollbackFile'];
    }
    out.push(base);
  }
  return out;
}
