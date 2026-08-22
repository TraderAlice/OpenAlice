import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const MAX_MANIFEST_BYTES = 64 * 1024
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/)

const capabilitySchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  ports: z.array(identifier).min(1),
  entryPort: identifier,
  readinessPath: z.string().startsWith('/'),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.ports).size !== value.ports.length) {
    ctx.addIssue({ code: 'custom', path: ['ports'], message: 'port names must be unique' })
  }
  if (!value.ports.includes(value.entryPort)) {
    ctx.addIssue({ code: 'custom', path: ['entryPort'], message: 'entryPort must name a declared port' })
  }
})

const manifestSchema = z.object({
  manifestVersion: z.literal(1),
  version: z.string().min(1).max(128),
  capabilities: z.record(identifier, capabilitySchema),
}).strict()

export type HarnessCapability = z.infer<typeof capabilitySchema>
export type HarnessManifest = z.infer<typeof manifestSchema>

export class HarnessManifestError extends Error {
  constructor(
    readonly code: 'missing' | 'too_large' | 'invalid_json' | 'invalid_manifest',
    message: string,
  ) {
    super(message)
    this.name = 'HarnessManifestError'
  }
}

export async function readHarnessManifest(workspaceDir: string): Promise<HarnessManifest> {
  const path = join(workspaceDir, 'harness.json')
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HarnessManifestError('missing', 'This Workspace has no harness.json')
    }
    throw err
  }
  if (Buffer.byteLength(source) > MAX_MANIFEST_BYTES) {
    throw new HarnessManifestError('too_large', 'harness.json exceeds 64 KiB')
  }
  return parseHarnessManifest(source)
}

/** Parse a manifest obtained from an immutable Git object without checking it out. */
export function parseHarnessManifest(source: string): HarnessManifest {
  if (Buffer.byteLength(source) > MAX_MANIFEST_BYTES) {
    throw new HarnessManifestError('too_large', 'harness.json exceeds 64 KiB')
  }
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    throw new HarnessManifestError('invalid_json', 'harness.json is not valid JSON')
  }
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('; ')
    throw new HarnessManifestError('invalid_manifest', detail)
  }
  if (Object.keys(parsed.data.capabilities).length === 0) {
    throw new HarnessManifestError('invalid_manifest', 'capabilities must not be empty')
  }
  return parsed.data
}
