import {
  OFFICE_COWORKER_SPRITES,
  type OfficeCoworkerIdentity,
  type OfficeCoworkerSpriteAsset,
} from './coworker-sprites'

export const OFFICE_COWORKER_CAST_STORAGE_KEY = 'openalice:office-coworker-casts:v1'

interface StoredOfficeCoworkerCasts {
  version: 1
  workspaces: Record<string, Record<string, OfficeCoworkerIdentity>>
}

function isCoworkerIdentity(value: unknown): value is OfficeCoworkerIdentity {
  return typeof value === 'string' && Object.hasOwn(OFFICE_COWORKER_SPRITES, value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readOfficeCoworkerCasts(): ReadonlyMap<
  string,
  ReadonlyMap<string, OfficeCoworkerSpriteAsset>
> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = window.localStorage.getItem(OFFICE_COWORKER_CAST_STORAGE_KEY)
    if (!raw) return new Map()
    const stored = JSON.parse(raw) as Partial<StoredOfficeCoworkerCasts>
    if (stored.version !== 1 || !isRecord(stored.workspaces)) {
      return new Map()
    }
    const casts = new Map<string, ReadonlyMap<string, OfficeCoworkerSpriteAsset>>()
    for (const [workspaceId, members] of Object.entries(stored.workspaces)) {
      if (!workspaceId || !isRecord(members)) continue
      const cast = new Map<string, OfficeCoworkerSpriteAsset>()
      for (const [resumeId, identity] of Object.entries(members)) {
        if (resumeId && isCoworkerIdentity(identity)) {
          cast.set(resumeId, OFFICE_COWORKER_SPRITES[identity])
        }
      }
      if (cast.size > 0) casts.set(workspaceId, cast)
    }
    return casts
  } catch {
    return new Map()
  }
}

export function writeOfficeCoworkerCasts(
  casts: ReadonlyMap<string, ReadonlyMap<string, OfficeCoworkerSpriteAsset>>,
): void {
  if (typeof window === 'undefined') return
  const workspaces: StoredOfficeCoworkerCasts['workspaces'] = Object.create(null)
  for (const [workspaceId, cast] of casts) {
    if (!workspaceId || cast.size === 0) continue
    workspaces[workspaceId] = Object.fromEntries(
      Array.from(cast, ([resumeId, asset]) => [resumeId, asset.id]),
    )
  }
  try {
    window.localStorage.setItem(
      OFFICE_COWORKER_CAST_STORAGE_KEY,
      JSON.stringify({ version: 1, workspaces } satisfies StoredOfficeCoworkerCasts),
    )
  } catch {
    // Private browsing and storage quotas must not prevent the Office floor from rendering.
  }
}
