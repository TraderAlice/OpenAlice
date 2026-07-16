import { createHash } from 'node:crypto'
import { imageSize } from 'image-size'
import type { EvidenceImage } from './types.js'

export function evidenceImageName(scenarioId: string, theme: 'light' | 'dark'): string {
  return `${scenarioId}--${theme}.jpg`
}

export function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function sortEvidence(images: readonly EvidenceImage[]): readonly EvidenceImage[] {
  return [...images].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId) || left.theme.localeCompare(right.theme))
}

export function validateEvidenceContent(image: EvidenceImage, content: Uint8Array): void {
  if (content[0] !== 0xff || content[1] !== 0xd8 || content.length < 1_000) throw new Error(`${image.relativePath}: invalid or blank JPEG`)
  if (sha256(content) !== image.sha256) throw new Error(`${image.relativePath}: SHA-256 mismatch`)
  const size = imageSize(content)
  if (size.width !== image.width || size.height !== image.height) throw new Error(`${image.relativePath}: dimension mismatch`)
  if (image.width > image.viewport.width || image.height > image.viewport.height) throw new Error(`${image.relativePath}: image exceeds viewport`)
}
