import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolveMediaPath, persistMedia } from './media-store.js'

// ==================== resolveMediaPath ====================

describe('resolveMediaPath', () => {
  it('should join MEDIA_DIR with the given name', () => {
    const result = resolveMediaPath('2026-01-01/ace-aim-air.png')
    expect(result).toContain(join('data', 'media', '2026-01-01', 'ace-aim-air.png'))
  })
})

// ==================== persistMedia ====================

describe('persistMedia', () => {
  it('should produce deterministic 3-word names for same content', async () => {
    const dir = join(tmpdir(), `media-test-${randomUUID()}`)
    await mkdir(dir, { recursive: true })

    const filePath = join(dir, 'test.png')
    await writeFile(filePath, 'deterministic content')

    const result1 = await persistMedia(filePath)
    const result2 = await persistMedia(filePath)

    // Same content → same name (content-addressable)
    expect(result1).toBe(result2)
    // Format: YYYY-MM-DD/word-word-word.ext
    expect(result1).toMatch(/^\d{4}-\d{2}-\d{2}\/[a-z]+-[a-z]+-[a-z]+\.png$/)
  })

  it('should preserve file extension', async () => {
    const dir = join(tmpdir(), `media-test-${randomUUID()}`)
    await mkdir(dir, { recursive: true })

    const filePath = join(dir, 'photo.jpg')
    await writeFile(filePath, 'jpg content')

    const result = await persistMedia(filePath)
    expect(result).toMatch(/\.jpg$/)
  })

  it('should use .bin for files with no extension', async () => {
    const dir = join(tmpdir(), `media-test-${randomUUID()}`)
    await mkdir(dir, { recursive: true })

    const filePath = join(dir, 'noext')
    await writeFile(filePath, 'binary stuff')

    const result = await persistMedia(filePath)
    expect(result).toMatch(/\.bin$/)
  })

  it('should produce different names for different content', async () => {
    const dir = join(tmpdir(), `media-test-${randomUUID()}`)
    await mkdir(dir, { recursive: true })

    const file1 = join(dir, 'a.png')
    const file2 = join(dir, 'b.png')
    await writeFile(file1, 'content A')
    await writeFile(file2, 'content B')

    const result1 = await persistMedia(file1)
    const result2 = await persistMedia(file2)

    // Different content → different names (with high probability)
    expect(result1).not.toBe(result2)
  })
})
