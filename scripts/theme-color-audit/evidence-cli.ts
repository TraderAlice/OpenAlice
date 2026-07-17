import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { buildBindings, type RuntimeCaptureEvent } from './runtime-binding-cli.js'
import { assertUiSourceTreeMatchesCommit, buildStaticManifest } from './static-inventory.js'
import { THEME_COLOR_EVIDENCE_SCHEMA_VERSION, validateThemeColorEvidenceManifest } from './evidence.js'

const root = resolve(import.meta.dirname, '../..')
const evidenceRoot = resolve(root, '.artifacts/theme-color-audit/evidence')
const manifestPath = resolve(evidenceRoot, 'manifest.json')
const jpegQuality = 80

type ImageRecord = { path: string; sha256: string; width: number; height: number; label: string }
type EvidenceEntry = {
  kind: 'occurrence-evidence'
  inventoryId: string
  source: RuntimeCaptureEvent['occurrence']
  scenario: { scenarioId: string; state: string; fixtureProfile: string; theme: 'light' | 'dark' }
  channel: string
  actualValue: string
  winner: RuntimeCaptureEvent['binding']['winner']
  target: RuntimeCaptureEvent['binding']['target'] & { active: true }
  sampleBounds: { selector: string; x: number; y: number; width: number; height: number }
  context: ImageRecord
  crop: ImageRecord
}
type EvidenceManifest = { schemaVersion: typeof THEME_COLOR_EVIDENCE_SCHEMA_VERSION; sourceCommit: string; jpegQuality: 80; entries: EvidenceEntry[] }

function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
function safeName(id: string): string { return id.replace(/[^a-z0-9-]/gi, '-') }
function jpegDimensions(buffer: Buffer): { width: number; height: number } {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]!
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('JPEG dimensions unavailable')
}

async function relocateForCapture(event: RuntimeCaptureEvent): Promise<RuntimeCaptureEvent> {
  const direct = event.page.locator(`[data-openalice-color-audit~="${event.binding.inventoryId}"], .openalice-audit-${event.binding.inventoryId}`).first()
  const locator = await direct.count() > 0 ? direct : event.page.locator(event.binding.target.selector).first()
  if (await locator.count() === 0) return event
  await locator.scrollIntoViewIfNeeded(); await event.page.waitForTimeout(20)
  const target = await locator.evaluate((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
  if (target.width <= 0 || target.height <= 0) return event
  return { ...event, binding: { ...event.binding, target: { ...event.binding.target, ...target } } }
}

async function annotate(page: Page, event: RuntimeCaptureEvent): Promise<{ context: { x: number; y: number; width: number; height: number }; crop: { x: number; y: number; width: number; height: number } }> {
  return page.evaluate(({ binding, occurrence }) => {
    document.querySelectorAll('[data-openalice-evidence-overlay]').forEach((element) => element.remove())
    const sx = window.scrollX; const sy = window.scrollY
    const pageX = Math.max(0, sx + binding.target.x); const pageY = Math.max(0, sy + binding.target.y)
    const pageWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth)
    const pageHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight)
    const box = document.createElement('div'); box.dataset['openaliceEvidenceOverlay'] = 'box'
    Object.assign(box.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2147483646', left: `${pageX}px`, top: `${pageY}px`, width: `${binding.target.width}px`, height: `${binding.target.height}px`, boxSizing: 'border-box', border: '4px solid rgb(255, 45, 85)', background: 'rgba(255,45,85,0.06)' })
    const label = document.createElement('div'); label.dataset['openaliceEvidenceOverlay'] = 'label'
    label.textContent = `${binding.inventoryId} · ${occurrence.path}:${occurrence.span.startLine} · ${binding.channel}`
    Object.assign(label.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2147483647', left: `${pageX}px`, top: `${Math.max(0, pageY - 28)}px`, maxWidth: '900px', padding: '5px 8px', color: 'white', background: 'rgb(255, 45, 85)', border: '2px solid white', borderRadius: '4px', font: 'bold 13px/16px ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap' })
    document.body.append(box, label)
    const clip = (padding: number, minWidth: number, minHeight: number, maxWidth: number, maxHeight: number) => {
      const desiredX = Math.max(0, pageX - padding); const desiredY = Math.max(0, pageY - padding - 30)
      const desiredWidth = Math.min(maxWidth, Math.max(binding.target.width + padding * 2, minWidth))
      const desiredHeight = Math.min(maxHeight, Math.max(binding.target.height + padding * 2 + 30, minHeight))
      return { x: Math.min(desiredX, Math.max(0, pageWidth - desiredWidth)), y: Math.min(desiredY, Math.max(0, pageHeight - desiredHeight)), width: Math.min(desiredWidth, pageWidth), height: Math.min(desiredHeight, pageHeight) }
    }
    return { context: clip(120, 900, 360, 1200, 820), crop: clip(36, 600, 220, 760, 540) }
  }, { binding: event.binding, occurrence: event.occurrence })
}

async function captureOne(originalEvent: RuntimeCaptureEvent): Promise<EvidenceEntry> {
  const event = await relocateForCapture(originalEvent)
  const clips = await annotate(event.page, event)
  const name = safeName(event.binding.inventoryId)
  const contextRel = `images/${name}-context.jpg`; const cropRel = `images/${name}-crop.jpg`
  const contextBuffer = await event.page.screenshot({ type: 'jpeg', quality: jpegQuality, clip: clips.context })
  const cropBuffer = await event.page.screenshot({ type: 'jpeg', quality: jpegQuality, clip: clips.crop })
  await writeFile(resolve(evidenceRoot, contextRel), contextBuffer); await writeFile(resolve(evidenceRoot, cropRel), cropBuffer)
  const label = `${event.binding.inventoryId} · ${event.occurrence.path}:${event.occurrence.span.startLine} · ${event.binding.channel}`
  const contextSize = jpegDimensions(contextBuffer); const cropSize = jpegDimensions(cropBuffer)
  return {
    kind: 'occurrence-evidence', inventoryId: event.binding.inventoryId, source: event.occurrence,
    scenario: { scenarioId: event.scenario.scenarioId, state: event.scenario.state, fixtureProfile: event.scenario.fixtureProfile, theme: event.binding.theme },
    channel: event.binding.channel, actualValue: event.binding.actualValue, winner: event.binding.winner, target: { ...event.binding.target, active: true }, sampleBounds: { selector: event.binding.target.selector, ...clips.crop },
    context: { path: contextRel, sha256: sha256(contextBuffer), ...contextSize, label },
    crop: { path: cropRel, sha256: sha256(cropBuffer), ...cropSize, label },
  }
}

async function capture(): Promise<void> {
  await rm(evidenceRoot, { recursive: true, force: true }); await mkdir(resolve(evidenceRoot, 'images'), { recursive: true })
  const captured = new Set<string>(); const entries: EvidenceEntry[] = []
  const runtime = (await buildStaticManifest(root)).occurrences.filter((entry) => entry.sourceClass === 'runtime' && entry.role === 'color-consumer')
  const runtimeIds = new Set(runtime.map((entry) => entry.inventoryId))
  const result = await buildBindings({ onBinding: async (event) => {
    if (captured.has(event.binding.inventoryId)) return
    const entry = await captureOne(event); entries.push(entry); captured.add(event.binding.inventoryId)
    console.log(`captured ${captured.size}/${runtimeIds.size} ${event.binding.inventoryId}`)
  } })
  const missing = [...runtimeIds].filter((id) => !captured.has(id)); if (missing.length) throw new Error(`missing occurrence evidence (${missing.length}):\n${missing.join('\n')}`)
  entries.sort((a, b) => a.source.path.localeCompare(b.source.path) || a.source.span.startLine - b.source.span.startLine || a.inventoryId.localeCompare(b.inventoryId))
  const manifest: EvidenceManifest = { schemaVersion: THEME_COLOR_EVIDENCE_SCHEMA_VERSION, sourceCommit: result.sourceCommit, jpegQuality, entries }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`captured ${entries.length} independent occurrence evidence records`)
}

async function decodeAndInspect(page: Page, path: string): Promise<{ width: number; height: number; variance: number; redPixels: number }> {
  const buffer = await readFile(path)
  return page.evaluate(async (base64) => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d'); if (!context) throw new Error('2d context unavailable')
    context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let sum = 0; let sumSquare = 0; let redPixels = 0
    for (let index = 0; index < data.length; index += 16) { const value = data[index]! + data[index + 1]! + data[index + 2]!; sum += value; sumSquare += value * value; if (data[index]! > 180 && data[index + 1]! < 110 && data[index + 2]! < 150) redPixels += 1 }
    const samples = data.length / 16; return { width: image.naturalWidth, height: image.naturalHeight, variance: sumSquare / samples - (sum / samples) ** 2, redPixels }
  }, buffer.toString('base64'))
}

async function checkAnnotations(): Promise<void> {
  const input = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  const declaredCommit = (input as { sourceCommit?: unknown }).sourceCommit
  if (typeof declaredCommit !== 'string') throw new Error('evidence manifest sourceCommit must be a string')
  assertUiSourceTreeMatchesCommit(root, declaredCommit)
  const staticManifest = await buildStaticManifest(root, declaredCommit); const runtime = staticManifest.occurrences.filter((entry) => entry.sourceClass === 'runtime' && entry.role === 'color-consumer')
  const manifest = validateThemeColorEvidenceManifest(input, runtime.map((entry) => ({ inventoryId: entry.inventoryId, path: entry.path, sourceText: entry.sourceText, span: entry.span })), staticManifest.sourceCommit)
  const expected = new Set(runtime.map((entry) => entry.inventoryId)); const seen = new Set<string>()
  const browser = await chromium.launch({ headless: true, channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome' }); const page = await browser.newPage()
  try {
    for (const entry of manifest.entries) {
      if (!expected.has(entry.inventoryId)) throw new Error(`orphan evidence: ${entry.inventoryId}`)
      if (seen.has(entry.inventoryId)) throw new Error(`shared or duplicate evidence: ${entry.inventoryId}`); seen.add(entry.inventoryId)
      if (entry.kind !== 'occurrence-evidence' || entry.target.width <= 0 || entry.target.height <= 0 || !entry.actualValue) throw new Error(`inactive/value-only evidence: ${entry.inventoryId}`)
      for (const image of [entry.context, entry.crop]) {
        if (image.label !== `${entry.inventoryId} · ${entry.source.path}:${entry.source.span.startLine} · ${entry.channel}`) throw new Error(`label identity mismatch: ${entry.inventoryId}`)
        const absolute = resolve(evidenceRoot, image.path); const buffer = await readFile(absolute)
        if (sha256(buffer) !== image.sha256) throw new Error(`hash mismatch: ${entry.inventoryId} ${image.path}`)
        const decoded = await decodeAndInspect(page, absolute)
        if (decoded.width !== image.width || decoded.height !== image.height || decoded.variance < 25 || decoded.redPixels < 8) throw new Error(`blank/unannotated JPEG: ${entry.inventoryId} ${image.path}`)
      }
    }
  } finally { await browser.close() }
  const missing = [...expected].filter((id) => !seen.has(id)); if (missing.length) throw new Error(`missing evidence (${missing.length})`)
  console.log(`validated ${seen.size} occurrence annotations, JPEG hashes, labels, bounds, and pixels`)
}

async function buildReviewIndex(): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as EvidenceManifest
  const rows = manifest.entries.map((entry) => `<article id="${entry.inventoryId}"><h2>${entry.inventoryId}</h2><p><code>${entry.source.path}:${entry.source.span.startLine}:${entry.source.span.startColumn}</code> · <code>${entry.source.sourceText}</code> · ${entry.scenario.scenarioId}/${entry.scenario.theme} · <code>${entry.channel}=${entry.actualValue}</code></p><div><figure><img src="${entry.context.path}" loading="lazy"><figcaption>context · ${entry.context.sha256}</figcaption></figure><figure><img src="${entry.crop.path}" loading="lazy"><figcaption>crop · ${entry.crop.sha256}</figcaption></figure></div></article>`).join('\n')
  const html = `<!doctype html><meta charset="utf-8"><title>Theme color occurrence evidence</title><style>body{font:14px system-ui;margin:24px;background:#111;color:#eee}article{border-top:1px solid #555;padding:24px 0}article>div{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{max-width:100%;border:1px solid #777}code{color:#ff9fbc}figcaption{word-break:break-all;font-size:11px}@media(max-width:900px){article>div{grid-template-columns:1fr}}</style><h1>${manifest.entries.length} occurrence evidence records</h1><p>source commit <code>${manifest.sourceCommit}</code> · JPEG quality ${manifest.jpegQuality}</p>${rows}`
  await writeFile(resolve(evidenceRoot, 'review-index.html'), html); console.log(`built complete review index for ${manifest.entries.length} occurrences`)
}

const command = process.argv[2]
if (command === 'capture') await capture()
else if (command === 'check-annotations') await checkAnnotations()
else if (command === 'build-review-index') await buildReviewIndex()
else throw new Error(`unknown evidence command: ${command ?? '<missing>'}`)
