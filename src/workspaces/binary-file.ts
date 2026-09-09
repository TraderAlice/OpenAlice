import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

/** Channel-independent, bounded access to a regular Workspace file. */
export async function readWorkspaceBinaryFile(root: string, path: string, limit = 1024 * 1024): Promise<{
  filename: string; content: Buffer
}> {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0')) throw new Error('invalid_path')
  const canonicalRoot = await realpath(root)
  const target = await realpath(resolve(canonicalRoot, path))
  const rel = relative(canonicalRoot, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('invalid_path')
  const handle = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('not_regular_file')
    if (info.size > limit) throw new Error('file_too_large')
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > limit) throw new Error('file_too_large')
    return { filename: basename(path), content: buffer.subarray(0, size) }
  } finally { await handle.close() }
}
