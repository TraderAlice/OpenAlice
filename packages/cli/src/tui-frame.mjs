const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g
const OSC_PATTERN = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g
const CONTROL_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
}

export function createSupervisorFrame(model, options = {}) {
  const columns = terminalDimension(options.columns, 80, 1)
  const rows = terminalDimension(options.rows, 24, 2)
  const useColor = options.color === true
  const normalized = normalizeModel(model)
  const lines = columns < 60
    ? createNarrowFrame(normalized, columns)
    : createWideFrame(normalized, columns)

  const action = columns < 60
    ? 'q detach  ? help'
    : 'o open  l logs  d doctor  r restart  x stop  ? help  q detach'
  const availableBodyRows = Math.max(1, rows - 1)
  const body = lines.slice(0, availableBodyRows)
  while (body.length < availableBodyRows) body.push('')
  body.push(action)

  return body.map((line, index) => {
    const fitted = fitTerminalLine(line, columns)
    if (!useColor) return fitted
    if (index === 0) return `${COLORS.bold}${COLORS.cyan}${fitted}${COLORS.reset}`
    if (index === body.length - 1) return `${COLORS.dim}${fitted}${COLORS.reset}`
    if (line.includes(normalized.state.toUpperCase())) {
      return `${stateColor(normalized.state)}${fitted}${COLORS.reset}`
    }
    return fitted
  })
}

export function fitTerminalLine(value, columns) {
  const limit = Math.max(1, Number(columns) || 1)
  const clean = sanitizeTerminalText(value)
  if (terminalStringWidth(clean) <= limit) {
    return `${clean}${' '.repeat(limit - terminalStringWidth(clean))}`
  }

  const ellipsis = limit > 1 ? '…' : ''
  const target = limit - terminalStringWidth(ellipsis)
  let output = ''
  let width = 0
  for (const grapheme of graphemes(clean)) {
    const nextWidth = graphemeWidth(grapheme)
    if (width + nextWidth > target) break
    output += grapheme
    width += nextWidth
  }
  return `${output}${ellipsis}${' '.repeat(Math.max(0, limit - width - terminalStringWidth(ellipsis)))}`
}

export function sanitizeTerminalText(value) {
  return String(value ?? '')
    .replace(OSC_PATTERN, '')
    .replace(ANSI_PATTERN, '')
    .replace(CONTROL_PATTERN, (character) => character === '\n' || character === '\r' ? ' ' : '')
    .replace(/[\r\n]+/g, ' ')
}

export function terminalStringWidth(value) {
  let width = 0
  for (const grapheme of graphemes(sanitizeTerminalText(value))) {
    width += graphemeWidth(grapheme)
  }
  return width
}

function createWideFrame(model, columns) {
  const state = model.state.toUpperCase()
  const titleGap = Math.max(1, columns - terminalStringWidth(` OpenAlice ${model.productVersion} ${state} `))
  return [
    ` OpenAlice ${model.productVersion}${' '.repeat(titleGap)}${state} `,
    '─'.repeat(columns),
    ` Instance   ${model.instance}    Uptime ${model.uptime}`,
    ` Web        ${model.endpoint}`,
    ` Home       ${model.home}`,
    ` Provider   ${model.provider}`,
    '',
    ' Components',
    ...model.components.map(([name, status]) => ` ${fitTerminalLine(name, 11)}${status}`),
    '',
    ` ${model.detail}`,
  ]
}

function createNarrowFrame(model) {
  return [
    `OpenAlice ${model.productVersion}`,
    `${model.state.toUpperCase()} · ${model.instance}`,
    model.endpoint,
    `Home ${model.home}`,
    `Provider ${model.provider} · ${model.uptime}`,
    ...model.components.map(([name, status]) => `${name}: ${status}`),
    model.detail,
  ]
}

function normalizeModel(model = {}) {
  return {
    productVersion: sanitizeTerminalText(model.productVersion || 'unknown'),
    state: sanitizeTerminalText(model.state || 'unavailable').toLowerCase(),
    instance: sanitizeTerminalText(model.instance || 'default'),
    endpoint: sanitizeTerminalText(model.endpoint || 'not available'),
    home: sanitizeTerminalText(model.home || 'not available'),
    uptime: sanitizeTerminalText(model.uptime || '—'),
    provider: sanitizeTerminalText(model.provider || 'unknown'),
    components: Array.isArray(model.components)
      ? model.components.slice(0, 6).map((component) => [
          sanitizeTerminalText(component?.[0] || 'Component'),
          sanitizeTerminalText(component?.[1] || 'unknown'),
        ])
      : [],
    detail: sanitizeTerminalText(model.detail || 'Runtime control is read-only in this preview.'),
  }
}

function stateColor(state) {
  if (state === 'running' || state === 'ready') return COLORS.green
  if (state === 'degraded' || state === 'starting' || state === 'reconnecting') return COLORS.yellow
  if (state === 'stopped' || state === 'unavailable') return COLORS.dim
  return COLORS.red
}

function terminalDimension(value, fallback, minimum) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0
    ? Math.max(minimum, Math.floor(numeric))
    : fallback
}

function graphemes(value) {
  if (!segmenter) return Array.from(value)
  return Array.from(segmenter.segment(value), ({ segment }) => segment)
}

function graphemeWidth(grapheme) {
  if (!grapheme) return 0
  if (/^\p{Mark}+$/u.test(grapheme)) return 0
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2
  const codePoint = grapheme.codePointAt(0)
  return isFullwidthCodePoint(codePoint) ? 2 : 1
}

function isFullwidthCodePoint(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1b000 && codePoint <= 0x1b2ff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}
