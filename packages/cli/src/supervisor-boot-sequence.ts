import {
  SUPERVISOR_BRAND_MARK_ROWS,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'

export const SUPERVISOR_BOOT_LAST_FRAME = 15

const BOOT_STAGES = ['ALICEPROJECT', 'MACHINE', 'RUNTIME', 'CONTROL'] as const
const LARGE_BRAND_MARK = SUPERVISOR_BRAND_MARK_ROWS.flatMap((line) => {
  const doubled = [...line].map((character) => `${character}${character}`).join('')
  return [doubled, doubled]
})

export function supervisorBootSequenceEnabled(
  env: NodeJS.ProcessEnv = process.env,
  motionEnabled = true,
  colorEnabled = true,
): boolean {
  if (!motionEnabled || !colorEnabled || env['OPENALICE_TUI_BOOT'] === '0') return false
  if (env['OPENALICE_TUI_BOOT'] === '1') return true
  return env['NODE_ENV'] !== 'test'
}

export function renderSupervisorBootSequence(
  width: number,
  height: number,
  frame: number,
  theme: SupervisorTuiTheme,
): string[] {
  const safeWidth = Math.max(1, Math.floor(width))
  const safeHeight = Math.max(1, Math.floor(height))
  const safeFrame = clamp(Math.floor(frame), 0, SUPERVISOR_BOOT_LAST_FRAME)
  const field = Array.from({ length: safeHeight }, (_, row) => (
    renderSignalFieldRow(safeWidth, row, safeFrame)
  ))

  if (safeWidth < 48 || safeHeight < 14) {
    return renderCompactBoot(field, safeWidth, safeHeight, safeFrame, theme)
  }

  const mark = safeWidth >= 72 && safeHeight >= 22
    ? LARGE_BRAND_MARK
    : [...SUPERVISOR_BRAND_MARK_ROWS]
  const contentHeight = mark.length + 7
  const markStart = Math.max(1, Math.floor((safeHeight - contentHeight) / 2))
  mark.forEach((line, index) => {
    field[markStart + index] = centeredStyledRow(
      field[markStart + index]!,
      line,
      theme.brand(line, safeFrame),
    )
  })

  const identityRow = markStart + mark.length + 1
  const identity = 'O P E N A L I C E   ·   L O C A L   T R A D I N G   W O R K S P A C E'
  const fittedIdentity = truncatePlain(identity, safeWidth)
  field[identityRow] = centeredStyledRow(
    field[identityRow]!,
    fittedIdentity,
    theme.accentStrong(fittedIdentity),
  )

  const stageRow = identityRow + 2
  const activeStage = Math.min(
    BOOT_STAGES.length - 1,
    Math.floor((safeFrame / (SUPERVISOR_BOOT_LAST_FRAME + 1)) * BOOT_STAGES.length),
  )
  field[stageRow] = centeredSegmentsRow(
    field[stageRow]!,
    BOOT_STAGES.flatMap((stage, index) => [
      {
        text: index === activeStage ? `◆ ${stage}` : `◇ ${stage}`,
        style: index === activeStage ? theme.accentStrong : theme.muted,
      },
      ...(index < BOOT_STAGES.length - 1
        ? [{ text: '  ──  ', style: theme.muted }]
        : []),
    ]),
  )

  const horizonRow = stageRow + 2
  const horizon = renderSignalHorizon(Math.min(safeWidth - 12, 72), safeFrame)
  field[horizonRow] = centeredStyledRow(
    field[horizonRow]!,
    horizon,
    theme.accent(horizon),
  )

  const hint = 'press any key or click to enter'
  const hintRow = Math.max(horizonRow + 2, safeHeight - 2)
  if (hintRow < safeHeight) {
    field[hintRow] = centeredStyledRow(field[hintRow]!, hint, theme.muted(hint))
  }
  return field.map((row) => theme.muted(row))
}

function renderCompactBoot(
  field: string[],
  width: number,
  height: number,
  frame: number,
  theme: SupervisorTuiTheme,
): string[] {
  const content = height >= 8
    ? [
        { text: '◆ OPENALICE', style: theme.brand },
        { text: 'LOCAL TRADING WORKSPACE', style: theme.accentStrong },
        { text: renderSignalHorizon(Math.min(width - 4, 28), frame), style: theme.accent },
        { text: 'press any key to enter', style: theme.muted },
      ]
    : [
        { text: '◆ OPENALICE', style: theme.brand },
        { text: 'press any key to enter', style: theme.muted },
      ]
  const start = Math.max(0, Math.floor((height - content.length) / 2))
  content.forEach((item, index) => {
    const row = start + index
    if (row >= height) return
    const text = truncatePlain(item.text, width)
    field[row] = centeredStyledRow(field[row]!, text, item.style(text, frame))
  })
  return field.map((row) => theme.muted(row))
}

function renderSignalFieldRow(width: number, row: number, frame: number): string {
  let output = ''
  const phase = Math.floor(frame / 3)
  for (let column = 0; column < width; column += 1) {
    const hash = Math.abs(
      Math.imul(column + 11, 73_856_093)
      ^ Math.imul(row + 17, 19_349_663)
      ^ Math.imul(phase + 23, 83_492_791),
    )
    const bucket = hash % 173
    output += bucket === 0 ? '✦' : bucket < 3 ? '·' : ' '
  }
  return output
}

function renderSignalHorizon(width: number, frame: number): string {
  const safeWidth = Math.max(3, width)
  const ramp = ['·', '░', '▒', '▓'] as const
  let output = ''
  for (let index = 0; index < safeWidth; index += 1) {
    const distance = Math.abs(index - (safeWidth - 1) / 2) / Math.max(1, safeWidth / 2)
    if (distance > 0.93) {
      output += ' '
      continue
    }
    const wave = (Math.sin(index * 0.48 - frame * 0.72) + 1) / 2
    const strength = wave * (1 - distance * 0.72)
    output += ramp[Math.min(ramp.length - 1, Math.floor(strength * ramp.length))]!
  }
  return output
}

function centeredStyledRow(background: string, text: string, styledText: string): string {
  const safeText = truncatePlain(text, background.length)
  const left = Math.max(0, Math.floor((background.length - safeText.length) / 2))
  const right = left + safeText.length
  return `${background.slice(0, left)}${styledText}${background.slice(right)}`
}

function centeredSegmentsRow(
  background: string,
  segments: Array<{ text: string; style: (value: string) => string }>,
): string {
  const text = segments.map((segment) => segment.text).join('')
  if (text.length > background.length) {
    const compact = segments.filter((_, index) => index % 2 === 0)
    return centeredSegmentsRow(background, compact)
  }
  const left = Math.max(0, Math.floor((background.length - text.length) / 2))
  return `${background.slice(0, left)}${segments.map((segment) => (
    segment.style(segment.text)
  )).join('')}${background.slice(left + text.length)}`
}

function truncatePlain(value: string, width: number): string {
  if (value.length <= width) return value
  if (width <= 1) return value.slice(0, Math.max(0, width))
  return `${value.slice(0, width - 1)}…`
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
