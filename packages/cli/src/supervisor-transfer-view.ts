import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorActionShelf,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'
import { renderSupervisorPanel, wrapDisplayText } from './supervisor-tui-view.ts'
import type { TransferWizardPhase } from './supervisor-transfer.ts'

export interface SupervisorTransferFlightDeckView {
  phase: TransferWizardPhase
  sourceName: string
  destinationName?: string
  content: string[]
  message: string
}

export interface SupervisorTransferFlightDeckRender {
  lines: string[]
  contentFirstRow: number
  contentStartColumn: number
  contentEndColumn: number
}

export function renderSupervisorTransferInput(
  title: string,
  fieldLines: string[],
  detail: string,
  invalid = false,
): string[] {
  return [
    `${invalid ? '!' : '◆'} ${title}${invalid ? ' · FIX' : ''}`,
    ...fieldLines,
    '',
    detail,
    '',
    '◆ [ Enter ] Continue  │  [ Esc ] Back',
  ]
}

export function renderSupervisorTransferChoice(
  title: string,
  choiceLines: string[],
): string[] {
  return [
    `◆ ${title}`,
    '',
    ...choiceLines,
    '',
    '◆ [ Enter ] Choose  │  [ Esc ] Back',
  ]
}

export function renderSupervisorTransferPlanning(width: number): string[] {
  return fitTransferRows([
    '◇ Building transfer manifest · CHECKSUMS',
    '',
    ...wrapDisplayText(
      'Indexing portable files, exclusions, credentials, and scheduled Issue owners.',
      Math.max(1, width),
    ),
    'No destination state changes before review.',
  ], width)
}

export function renderSupervisorTransferReview(
  planLines: string[],
  ready: boolean,
  width: number,
): string[] {
  return fitTransferRows([
    `${ready ? '◆' : '!'} Transfer manifest · ${ready ? 'READY' : 'HOLD'}`,
    ...stripLegacyTransferCard(planLines),
    '',
    ready
      ? '✓ Boundaries checked; ready to transfer.'
      : '! Resolve every blocker before transfer.',
    ready
      ? '◆ [ Enter ] Transfer  │  [ Esc ] Cancel'
      : '◆ [ Esc ] Close',
  ], width)
}

export interface SupervisorTransferProgressView {
  files: number
  bytes: number
  totalFiles: number
  totalBytes: number
}

export function renderSupervisorTransferProgress(
  progress: SupervisorTransferProgressView,
  width: number,
): string[] {
  const fraction = transferFraction(progress)
  const percent = Math.floor(fraction * 100)
  const meterWidth = Math.max(8, Math.min(28, width - 8))
  const complete = Math.round(fraction * meterWidth)
  const meter = `${'━'.repeat(complete)}${'·'.repeat(meterWidth - complete)}`
  return fitTransferRows([
    '◈ Transfer in flight · STREAMING',
    '',
    `[${meter}] ${String(percent).padStart(3, ' ')}%`,
    `${progress.files} / ${progress.totalFiles} files`,
    `${formatTransferBytes(progress.bytes)} / ${formatTransferBytes(progress.totalBytes)}`,
    '',
    'VERIFY · checksum gate → atomic publish',
    '◆ [ Esc ] Cancel',
    'Ctrl+C cancels this transfer and detaches OpenAlice.',
  ], width)
}

export function renderSupervisorTransferRecovery(
  error: string,
  retryTransaction: boolean,
  width: number,
): string[] {
  const detail = wrapDisplayText(error || 'Unknown transfer error.', Math.max(1, width)).slice(0, 3)
  return fitTransferRows([
    '! Transfer interrupted · RECOVERY',
    '',
    ...detail,
    '',
    retryTransaction
      ? 'Marked transaction staging is safe to retry.'
      : 'No transfer transaction was published.',
    `◆ [ r ] ${retryTransaction ? 'Retry' : 'Rebuild'}  │  [ Esc ] Close`,
  ], width)
}

export function renderSupervisorTransferArrival(
  resultLines: string[],
  width: number,
): string[] {
  return fitTransferRows([
    '✓ AliceProject arrived · PUBLISHED',
    ...stripLegacyTransferCard(resultLines),
    '',
    '◆ Remote Runtime is stopped · source unchanged',
    width < 58
      ? '◆ [ s ] Start  │  [ o ] Open  │  [ Enter ] Done'
      : '◆ [ s ] Start  │  [ o ] Connect/Open  │  [ Enter ] Done',
  ], width)
}

interface TransferStage {
  label: string
  signal: string
}

const TRANSFER_STAGES: TransferStage[] = [
  { label: 'Machine', signal: 'DESTINATION' },
  { label: 'Project ID', signal: 'IDENTITY' },
  { label: 'Remote Home', signal: 'LOCATION' },
  { label: 'Credentials', signal: 'SECRETS' },
  { label: 'Issue Owners', signal: 'SCHEDULES' },
  { label: 'Review', signal: 'CHECKSUMS' },
  { label: 'Transfer', signal: 'STREAM' },
  { label: 'Complete', signal: 'ARRIVAL' },
]

export function renderSupervisorTransferFlightDeck(
  view: SupervisorTransferFlightDeckView,
  width: number,
): SupervisorTransferFlightDeckRender {
  const safeWidth = Math.max(24, width)
  const active = transferStageIndex(view.phase)
  const stage = TRANSFER_STAGES[active]!
  const mission = `${view.sourceName} → ${view.destinationName ?? 'Choose Machine'}`
  const wide = safeWidth >= 96

  if (wide) {
    const gap = 3
    const pathWidth = 36
    const briefWidth = safeWidth - pathWidth - gap
    const height = Math.max(TRANSFER_STAGES.length, view.content.length)
    const path = renderSupervisorPanel(
      'Flight Deck',
      `${active + 1}/${TRANSFER_STAGES.length} · ${stage.signal}`,
      padRows(stageRows(active, pathWidth - 4), height),
      pathWidth,
    )
    const brief = renderSupervisorPanel(
      'Mission Brief',
      mission,
      padRows(view.content, height),
      briefWidth,
    )
    return {
      lines: [
        ...path.map((line, index) => joinColumns(
          line,
          brief[index] ?? '',
          pathWidth,
          gap,
          safeWidth,
        )),
        '',
        ...renderSupervisorPanel('Safety Rail', stage.label, [view.message], safeWidth),
      ],
      contentFirstRow: 2,
      contentStartColumn: pathWidth + gap + 1,
      contentEndColumn: safeWidth - 1,
    }
  }

  const route = compactRoute(active, Math.max(1, safeWidth - 4))
  const path = renderSupervisorPanel(
    'Transfer Flight Deck',
    `${active + 1}/${TRANSFER_STAGES.length} · ${stage.signal}`,
    [route],
    safeWidth,
  )
  const brief = renderSupervisorPanel('Mission Brief', mission, view.content, safeWidth)
  return {
    lines: [
      ...path,
      '',
      ...brief,
      '',
      truncateDisplayWidth(`◆ SAFETY · ${stage.label} · ${view.message}`, safeWidth),
    ],
    contentFirstRow: path.length + 3,
    contentStartColumn: 2,
    contentEndColumn: safeWidth - 1,
  }
}

export function decorateSupervisorTransferFlightDeck(
  lines: string[],
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string[] {
  return lines.map((line) => {
    const action = [
      '◆ [ Enter ] Continue  │  [ Esc ] Back',
      '◆ [ Enter ] Choose  │  [ Esc ] Back',
      '◆ [ Enter ] Transfer  │  [ Esc ] Cancel',
      '◆ [ Esc ] Close',
      '◆ [ Esc ] Cancel',
      '◆ [ r ] Retry  │  [ Esc ] Close',
      '◆ [ r ] Rebuild  │  [ Esc ] Close',
      '◆ [ s ] Start  │  [ o ] Connect/Open  │  [ Enter ] Done',
      '◆ [ s ] Start  │  [ o ] Open  │  [ Enter ] Done',
    ].find((candidate) => line.includes(candidate))
    if (action) {
      return line.replace(action, decorateSupervisorActionShelf(action, theme, hoveredCommand))
    }
    if (!theme.enabled) return line
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    if (line.startsWith('│ ◆ ')) {
      const end = line.indexOf('│', 1)
      return end > 0
        ? `${theme.accentStrong(line.slice(0, end + 1))}${line.slice(end + 1)}`
        : theme.accentStrong(line)
    }
    if (line.startsWith('│ ') && line.includes('◆ ') && line.indexOf('│', 1) === line.lastIndexOf('│')) {
      return theme.accentStrong(line)
    }
    if (
      line.includes('FAILED')
      || line.includes('Transfer interrupted')
      || line.includes('Transfer manifest · HOLD')
    ) return theme.danger(line)
    if (line.includes(' · FIX')) return theme.danger(line)
    if (line.includes('Transfer manifest · READY') || line.includes('AliceProject arrived')) return theme.success(line)
    if (
      line.includes('Transfer in flight')
      || line.includes('Building transfer manifest')
    ) return theme.accentStrong(line)
    if (line.includes('checksum gate') || line.includes('Ctrl+C cancels')) return theme.muted(line)
    if (line.includes('ARRIVAL')) return theme.success(line)
    return line
  })
}

function stripLegacyTransferCard(lines: string[]): string[] {
  const body = lines.slice(1)
  while (body[0] === '') body.shift()
  if (body.at(-1)?.startsWith('[')) body.pop()
  while (body.at(-1) === '') body.pop()
  return body
}

function fitTransferRows(lines: string[], width: number): string[] {
  return lines.map((line) => truncateDisplayWidth(line, Math.max(1, width)))
}

function transferFraction(progress: SupervisorTransferProgressView): number {
  const ratio = progress.totalBytes > 0
    ? progress.bytes / progress.totalBytes
    : progress.totalFiles > 0
      ? progress.files / progress.totalFiles
      : 0
  return Math.max(0, Math.min(1, ratio))
}

function formatTransferBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

function stageRows(active: number, width: number): string[] {
  return TRANSFER_STAGES.map((stage, index) => {
    const marker = index < active ? '✓' : index === active ? '◆' : '·'
    const tail = index < active ? 'DONE' : index === active ? stage.signal : 'NEXT'
    return labelAndTail(`${marker} ${String(index + 1).padStart(2, '0')} ${stage.label}`, tail, width)
  })
}

function compactRoute(active: number, width: number): string {
  const previous = active > 0 ? `✓ ${TRANSFER_STAGES[active - 1]!.label}` : undefined
  const current = `◆ ${TRANSFER_STAGES[active]!.label}`
  const next = active < TRANSFER_STAGES.length - 1
    ? `→ ${TRANSFER_STAGES[active + 1]!.label}`
    : undefined
  return truncateDisplayWidth([previous, current, next].filter(Boolean).join('  '), width)
}

function transferStageIndex(phase: TransferWizardPhase): number {
  if (phase === 'destination') return 0
  if (phase === 'project-key') return 1
  if (phase === 'home') return 2
  if (phase === 'credentials') return 3
  if (phase === 'issue-policy') return 4
  if (phase === 'planning' || phase === 'review') return 5
  if (phase === 'transferring') return 6
  if (phase === 'success') return 7
  return 5
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(width / 2)))
  const safeLabel = truncateDisplayWidth(label, Math.max(1, width - displayWidth(safeTail) - 1))
  const padding = Math.max(1, width - displayWidth(safeLabel) - displayWidth(safeTail))
  return `${safeLabel}${' '.repeat(padding)}${safeTail}`
}

function padRows(rows: string[], height: number): string[] {
  return [...rows, ...Array.from({ length: Math.max(0, height - rows.length) }, () => '')]
}

function joinColumns(
  left: string,
  right: string,
  leftWidth: number,
  gap: number,
  width: number,
): string {
  const safeLeft = truncateDisplayWidth(left, leftWidth)
  const combined = `${safeLeft}${' '.repeat(Math.max(0, leftWidth - displayWidth(safeLeft) + gap))}${right}`
  return truncateDisplayWidth(combined, width)
}
