/**
 * Backlink scanner — the reverse index for the entity store.
 *
 * Walks every workspace's markdown and collects which notes contain `[[name]]`
 * links. This is a *mechanical gather of the links the agent already wrote*
 * (Obsidian-style backlinks), NOT extraction — we never parse prose to infer
 * entities or relations, only harvest authored `[[...]]` tokens.
 *
 * Computed on demand: the corpus is small (tens of workspaces, sub-MB of
 * markdown). Dot-directories (.git, .claude, .agents, .codex, …) and the
 * scaffolding files (CLAUDE.md / AGENTS.md / README.md) are skipped so injected
 * persona / skill text can't produce phantom backlinks — only the agent's own
 * notes count.
 *
 * ONE dot-dir is deliberately let back in: `.alice/issues/*.md`. Issues are
 * first-class participants in the `[[]]` graph (an issue and an entity are the
 * same kind of `[[name]]` target), so issue bodies that author `[[name]]` links
 * must feed this reverse index, and an issue note itself shows up as a backlink.
 * We descend into `.alice/issues` SPECIFICALLY — every other dot-dir (incl. the
 * rest of `.alice`) and `node_modules` stay skipped. Issue-note backlinks are
 * recognisable downstream by their `.alice/issues/` path prefix.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js'

export interface Backlink {
  workspaceId: string
  workspaceTag: string
  /** Path of the note, relative to the workspace root. */
  path: string
}

/** `[[name]]` where the inner text has no brackets or newline. */
const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g
const SKIP_FILES = new Set(['CLAUDE.md', 'AGENTS.md', 'README.md'])

export function normalizeBacklinkPath(path: string): string {
  return path.replace(/\\/g, '/')
}

async function listMarkdown(root: string): Promise<string[]> {
  const out: string[] = []

  /** Collect `.md` files directly inside one directory (the flat `.alice/issues`
   *  dir — issues are `<id>.md` files, never nested). Scaffolding names don't
   *  appear here, but skip them for parity. Unreadable/absent dir → no-op. */
  async function collectFlat(abs: string): Promise<void> {
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md') && !SKIP_FILES.has(e.name)) {
        out.push(normalizeBacklinkPath(relative(root, join(abs, e.name))))
      }
    }
  }

  async function walk(abs: string): Promise<void> {
    // Inferred Dirent<string>[]; on an unreadable dir (race with deletion etc.)
    // fall back to empty rather than aborting the whole scan.
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const child = join(abs, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue
        if (e.name.startsWith('.')) {
          // Skip every dot-dir (.git / .claude / .agents / .codex / …) EXCEPT
          // descend into `.alice/issues` so issue notes feed the [[]] graph.
          if (e.name === '.alice') await collectFlat(join(child, 'issues'))
          continue
        }
        await walk(child)
      } else if (e.isFile() && e.name.endsWith('.md') && !SKIP_FILES.has(e.name)) {
        out.push(normalizeBacklinkPath(relative(root, child)))
      }
    }
  }
  await walk(root)
  return out
}

/**
 * Scan all workspaces once. Returns a map from the lowercased `[[name]]` token
 * to the notes referencing it (deduped per file — N mentions in one note count
 * as one backlink). Callers look up by entity name (case-insensitive); tokens
 * with no matching entity are simply never queried.
 */
async function scanUncached(registry: WorkspaceRegistry): Promise<Map<string, Backlink[]>> {
  const out = new Map<string, Backlink[]>()
  for (const ws of registry.list()) {
    const files = await listMarkdown(ws.dir)
    for (const rel of files) {
      let content: string
      try {
        content = await readFile(join(ws.dir, rel), 'utf-8')
      } catch {
        continue
      }
      const seenInFile = new Set<string>()
      for (const m of content.matchAll(WIKILINK_RE)) {
        const raw = m[1]
        if (!raw) continue
        const k = raw.trim().toLowerCase()
        if (!k || seenInFile.has(k)) continue
        seenInFile.add(k)
        const link: Backlink = { workspaceId: ws.id, workspaceTag: ws.tag, path: rel }
        const arr = out.get(k)
        if (arr) arr.push(link)
        else out.set(k, [link])
      }
    }
  }
  return out
}

// ==================== Cache ====================
//
// The scan reads every markdown file in every workspace, so doing it per
// request (the Tracked list polls every 20s AND every entity-detail open
// re-scanned) was the source of the Tracked tab's slow loads. Cache the
// reverse index with stale-while-revalidate: a cold call blocks once, then
// every subsequent call returns the cached map instantly and kicks a
// background refresh when the entry is older than the TTL. Backlinks come
// from agent notes that change infrequently, so brief staleness is fine.

const TTL_MS = 30_000

interface CacheEntry {
  data: Map<string, Backlink[]> | null
  at: number
  inflight: Promise<Map<string, Backlink[]>> | null
}

// Keyed by registry INSTANCE so each registry caches independently. In
// production there's a single registry → a single cache; in tests every
// `fakeRegistry(...)` is a distinct key, so the cache never leaks between
// cases. (WeakMap → entries are GC'd with the registry.)
const caches = new WeakMap<WorkspaceRegistry, CacheEntry>()

function entryFor(registry: WorkspaceRegistry): CacheEntry {
  let e = caches.get(registry)
  if (!e) {
    e = { data: null, at: 0, inflight: null }
    caches.set(registry, e)
  }
  return e
}

function refresh(registry: WorkspaceRegistry): Promise<Map<string, Backlink[]>> {
  const e = entryFor(registry)
  if (e.inflight) return e.inflight
  e.inflight = scanUncached(registry)
    .then((data) => {
      e.data = data
      e.at = Date.now()
      return data
    })
    .finally(() => {
      e.inflight = null
    })
  return e.inflight
}

/**
 * Cached reverse index. Returns the cached map immediately when present
 * (revalidating in the background past the TTL); only the first, cold call
 * awaits a full scan. On a scan error the previous cache is kept (serve
 * stale) rather than throwing.
 */
export async function scanBacklinks(registry: WorkspaceRegistry): Promise<Map<string, Backlink[]>> {
  const e = entryFor(registry)
  if (e.data) {
    if (Date.now() - e.at >= TTL_MS && !e.inflight) {
      void refresh(registry).catch(() => {
        /* keep serving the stale cache; next call retries */
      })
    }
    return e.data
  }
  return refresh(registry)
}

/** Kick a scan to warm the cache (fire-and-forget) — call at startup so the
 *  first Tracked open is fast. */
export function warmBacklinks(registry: WorkspaceRegistry): void {
  void refresh(registry).catch(() => {
    /* warming is best-effort */
  })
}

/** Drop a registry's cache so the next `scanBacklinks` re-scans (e.g. after a
 *  known bulk note change). */
export function invalidateBacklinks(registry: WorkspaceRegistry): void {
  caches.delete(registry)
}
