import { useEffect, useState } from 'react'
import { listFiles, readWorkspaceFile } from '../components/workspace/api'

export type SnapshotEntry = {
  kind: 'directory' | 'text' | 'unchecked'
  content?: string
}
export type Snapshot = Record<string, SnapshotEntry>
export type MirrorDifference = {
  path: string
  status: 'changed' | 'sourceOnly' | 'mirrorOnly' | 'unchecked'
  source?: SnapshotEntry
  mirror?: SnapshotEntry
}

/** Bounded, read-only traversal. Never follow links or infer equality from size/mtime. */
export async function snapshotWorkspaceTree(
  wsId: string,
  root: string,
  singleFile = false,
): Promise<Snapshot> {
  const result: Snapshot = {}
  let count = 0
  async function read(path: string, key: string) {
    const value = await readWorkspaceFile(wsId, path)
    result[key] =
      value.kind === 'ok' && !/[\u0000\ufffd]/.test(value.content)
        ? { kind: 'text', content: value.content }
        : { kind: 'unchecked' }
  }
  async function visit(path: string, relative: string, depth: number) {
    if (depth > 24 || ++count > 2000) {
      result[relative || '.'] = { kind: 'unchecked' }
      return
    }
    try {
      const files = await listFiles(wsId, path)
      for (const entry of files.entries) {
        const key = relative ? `${relative}/${entry.name}` : entry.name
        if (++count > 2000) {
          result[relative || '.'] = { kind: 'unchecked' }
          break
        }
        if (entry.kind === 'dir') {
          result[key] = { kind: 'directory' }
          await visit(`${path}/${entry.name}`, key, depth + 1)
        } else if (entry.kind === 'file') {
          await read(`${path}/${entry.name}`, key)
        } else result[key] = { kind: 'unchecked' }
      }
    } catch {
      result[relative || '.'] = { kind: 'unchecked' }
    }
  }
  if (singleFile) await read(root, 'Instructions')
  else await visit(root, '', 0)
  return result
}

export function compareWorkspaceTrees(
  source: Snapshot,
  mirror: Snapshot,
): MirrorDifference[] {
  return [...new Set([...Object.keys(source), ...Object.keys(mirror)])]
    .sort()
    .flatMap((path) => {
      const a = source[path],
        b = mirror[path]
      const status =
        a?.kind === 'unchecked' || b?.kind === 'unchecked'
          ? 'unchecked'
          : !a
            ? 'mirrorOnly'
            : !b
              ? 'sourceOnly'
              : a.kind !== b.kind || a.content !== b.content
                ? 'changed'
                : undefined
      return status ? [{ path, status, source: a, mirror: b }] : []
    })
}

export function useWorkspaceMirror(
  wsId: string,
  source: string,
  mirror: string,
  singleFile: boolean,
) {
  const id = JSON.stringify([wsId, source, mirror, singleFile])
  const [state, setState] = useState<{
    id: string
    differences?: MirrorDifference[]
    failed?: boolean
  }>()
  useEffect(() => {
    let active = true
    setState(undefined)
    void Promise.all([
      snapshotWorkspaceTree(wsId, source, singleFile),
      snapshotWorkspaceTree(wsId, mirror, singleFile),
    ]).then(
      ([a, b]) => {
        if (active) setState({ id, differences: compareWorkspaceTrees(a, b) })
      },
      () => {
        if (active) setState({ id, failed: true })
      },
    )
    return () => {
      active = false
    }
  }, [id, wsId, source, mirror, singleFile])
  return state?.id === id ? state : undefined
}
