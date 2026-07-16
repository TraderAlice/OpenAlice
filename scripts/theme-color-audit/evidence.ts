import { createHash } from 'node:crypto'
import { imageSize } from 'image-size'
import type { EvidenceImage, OccurrenceEvidenceRecord } from './types.js'

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

export function validateOccurrenceEvidenceRecord(record: OccurrenceEvidenceRecord): void {
  if (record.source.inventoryId !== record.inventoryId) throw new Error(`${record.inventoryId}: source identity mismatch`)
  if (record.kind === 'non-visual-probe') {
    if (record.bindingIndexes.length === 0) throw new Error(`${record.inventoryId}: non-visual probe has no runtime binding`)
    return
  }
  const { targetBounds, annotation, crop, context } = record
  if (!record.locator || !record.channel || !record.actualValue) throw new Error(`${record.inventoryId}: visual binding metadata missing`)
  if (record.channel.startsWith('--')) throw new Error(`${record.inventoryId}: CSS variable definition cannot be visual evidence`)
  if (record.surfaceKind === 'dom-element' && !record.locator.startsWith('#') && !record.locator.includes(record.inventoryId)) throw new Error(`${record.inventoryId}: locator does not identify current occurrence`)
  if (targetBounds.width <= 0 || targetBounds.height <= 0) throw new Error(`${record.inventoryId}: target has zero area`)
  if (targetBounds.x < 0 || targetBounds.y < 0 || targetBounds.x + targetBounds.width > record.viewport.width || targetBounds.y + targetBounds.height > record.viewport.height) throw new Error(`${record.inventoryId}: target is outside viewport`)
  const viewportArea = record.viewport.width * record.viewport.height
  const targetAreaRatio = targetBounds.width * targetBounds.height / viewportArea
  const annotationAreaRatio = annotation.bounds.width * annotation.bounds.height / viewportArea
  if (!annotation.label.includes(record.inventoryId) || !annotation.label.includes(record.channel)) throw new Error(`${record.inventoryId}: annotation does not identify target and channel`)
  if (annotation.bounds.x < targetBounds.x || annotation.bounds.y < targetBounds.y || annotation.bounds.x + annotation.bounds.width > targetBounds.x + targetBounds.width || annotation.bounds.y + annotation.bounds.height > targetBounds.y + targetBounds.height) throw new Error(`${record.inventoryId}: annotation bounds leave target surface`)
  if (targetAreaRatio > 0.5) {
    if (annotation.strategy !== 'surface-sample' || annotationAreaRatio >= 0.1) throw new Error(`${record.inventoryId}: viewport-majority target requires a bounded surface sample`)
  } else if (annotation.strategy !== 'element-bounds' || JSON.stringify(annotation.bounds) !== JSON.stringify(targetBounds)) throw new Error(`${record.inventoryId}: element annotation must match target bounds`)
  if (context.width !== record.viewport.width || context.height !== record.viewport.height) throw new Error(`${record.inventoryId}: context dimensions do not match viewport`)
  if (crop.width <= 0 || crop.height <= 0 || crop.annotationBoundsInImage.x < 0 || crop.annotationBoundsInImage.y < 0 || crop.annotationBoundsInImage.x + crop.annotationBoundsInImage.width > crop.width || crop.annotationBoundsInImage.y + crop.annotationBoundsInImage.height > crop.height) throw new Error(`${record.inventoryId}: crop bounds are invalid`)
}

export function validateOccurrenceJpeg(record: Extract<OccurrenceEvidenceRecord, { kind: 'visual-element' }>, role: 'context' | 'crop', content: Uint8Array): void {
  const image = record[role]
  if (content[0] !== 0xff || content[1] !== 0xd8 || content.length < 1_000) throw new Error(`${record.inventoryId}: ${role} is invalid or blank`)
  if (sha256(content) !== image.sha256) throw new Error(`${record.inventoryId}: ${role} SHA-256 mismatch`)
  const size = imageSize(content)
  if (size.width !== image.width || size.height !== image.height) throw new Error(`${record.inventoryId}: ${role} dimension mismatch`)
}
