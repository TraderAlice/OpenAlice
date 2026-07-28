#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_REPOSITORY = 'TraderAlice/OpenAlice'
const DEFAULT_OUTPUT = 'docs/images/star-history.svg'
const THEMES = {
  light: {
    backgroundStart: '#fbfffd',
    backgroundEnd: '#f3faf7',
    border: '#d8ebe3',
    eyebrow: '#668176',
    title: '#17231e',
    metric: '#17231e',
    label: '#6b8378',
    axis: '#6f857b',
    grid: '#deebe5',
    tick: '#a8bdb4',
    accent: '#2fa678',
    accentSoft: '#7bd3b0',
    areaOpacity: '0.30',
    endpointStroke: '#fbfffd',
    divider: '#d8e7e0',
  },
  dark: {
    backgroundStart: '#101a16',
    backgroundEnd: '#0b1310',
    border: '#294038',
    eyebrow: '#89a99b',
    title: '#edf7f2',
    metric: '#edf7f2',
    label: '#91a89d',
    axis: '#82998e',
    grid: '#24372f',
    tick: '#476257',
    accent: '#63d6aa',
    accentSoft: '#8ae4bf',
    areaOpacity: '0.32',
    endpointStroke: '#101a16',
    divider: '#2b4037',
  },
}

function startOfUtcDay(value) {
  const date = new Date(value)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatCompactCount(value) {
  if (value < 1_000) return String(value)
  const thousands = value / 1_000
  return `${thousands >= 10 || Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`
}

function formatDate(value, includeDay = true) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    ...(includeDay ? { day: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(value)
}

function formatFullDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(value)
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function niceAxis(maximum, targetIntervals = 4) {
  if (maximum <= 0) return { maximum: 1, step: 1 }
  const roughStep = maximum / targetIntervals
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalized = roughStep / magnitude
  const niceNormalized = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10
  const step = niceNormalized * magnitude
  return {
    maximum: Math.ceil(maximum / step) * step,
    step,
  }
}

export function aggregateStarHistory(timestamps) {
  const sorted = timestamps
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())

  if (sorted.length === 0) {
    throw new Error('[star-history] GitHub returned no valid stargazer timestamps')
  }

  const firstDay = startOfUtcDay(sorted[0])
  const lastDay = startOfUtcDay(sorted.at(-1))
  const dayCount = Math.floor((lastDay - firstDay) / DAY_MS) + 1
  const points = []
  let starIndex = 0

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const day = firstDay + dayIndex * DAY_MS
    const nextDay = day + DAY_MS
    while (starIndex < sorted.length && sorted[starIndex].getTime() < nextDay) {
      starIndex += 1
    }
    points.push({ date: new Date(day), count: starIndex })
  }

  return points
}

function selectDateTicks(points) {
  const ticks = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const date = points[index].date
    if (date.getUTCDate() === 1) ticks.push(points[index])
  }
  if (points.length > 1) ticks.push(points.at(-1))
  return ticks
}

export function renderStarHistorySvg({
  points,
  repository = DEFAULT_REPOSITORY,
  generatedAt = new Date(),
  theme = 'light',
}) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('[star-history] at least one aggregate point is required')
  }
  const palette = THEMES[theme]
  if (!palette) throw new Error(`[star-history] unknown theme: ${theme}`)

  const width = 1200
  const height = 560
  const plot = {
    left: 92,
    right: 1144,
    top: 174,
    bottom: 478,
  }
  const plotWidth = plot.right - plot.left
  const plotHeight = plot.bottom - plot.top
  const total = points.at(-1).count
  const axis = niceAxis(total)
  const xForIndex = (index) => {
    if (points.length === 1) return plot.left
    return plot.left + (index / (points.length - 1)) * plotWidth
  }
  const yForCount = (count) => plot.bottom - (count / axis.maximum) * plotHeight
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xForIndex(index).toFixed(2)} ${yForCount(point.count).toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L ${xForIndex(points.length - 1).toFixed(2)} ${plot.bottom} L ${plot.left} ${plot.bottom} Z`
  const intervalCount = Math.round(axis.maximum / axis.step)
  const yTicks = Array.from({ length: intervalCount + 1 }, (_, index) => index * axis.step)
  const dateTicks = selectDateTicks(points)
  const pointIndexByTime = new Map(points.map((point, index) => [point.date.getTime(), index]))
  const title = `${repository} star history`
  const snapshotDate = points.at(-1).date
  const snapshotMonthDay = formatDate(snapshotDate).toUpperCase()
  const snapshotYear = String(snapshotDate.getUTCFullYear())
  const description = `${formatCount(total)} stars in this snapshot. Daily cumulative history from ${formatFullDate(points[0].date)} through ${formatFullDate(snapshotDate)}.`

  const grid = yTicks
    .map((tick) => {
      const y = yForCount(tick)
      return `
        <line x1="${plot.left}" y1="${y.toFixed(2)}" x2="${plot.right}" y2="${y.toFixed(2)}" class="grid"/>
        <text x="${plot.left - 18}" y="${(y + 5).toFixed(2)}" text-anchor="end" class="axis-label">${formatCompactCount(tick)}</text>`
    })
    .join('')

  const xAxis = dateTicks
    .map((point, tickIndex) => {
      const index = pointIndexByTime.get(point.date.getTime())
      const x = xForIndex(index)
      const isEndpoint = tickIndex === 0 || tickIndex === dateTicks.length - 1
      return `
        <line x1="${x.toFixed(2)}" y1="${plot.bottom}" x2="${x.toFixed(2)}" y2="${plot.bottom + 7}" class="tick"/>
        <text x="${x.toFixed(2)}" y="${plot.bottom + 30}" text-anchor="${tickIndex === 0 ? 'start' : tickIndex === dateTicks.length - 1 ? 'end' : 'middle'}" class="axis-label">${formatDate(point.date, isEndpoint)}</text>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)}</title>
  <desc id="description">${escapeXml(description)}</desc>
  <metadata>
    <repository>${escapeXml(repository)}</repository>
    <generated-at>${escapeXml(generatedAt.toISOString())}</generated-at>
    <aggregation>daily cumulative active stargazers</aggregation>
    <theme>${theme}</theme>
  </metadata>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.backgroundStart}"/>
      <stop offset="100%" stop-color="${palette.backgroundEnd}"/>
    </linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.accentSoft}" stop-opacity="${palette.areaOpacity}"/>
      <stop offset="100%" stop-color="${palette.accentSoft}" stop-opacity="0"/>
    </linearGradient>
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .eyebrow { fill: ${palette.eyebrow}; font-size: 15px; font-weight: 650; letter-spacing: 2.3px; }
      .title { fill: ${palette.title}; font-size: 28px; font-weight: 720; }
      .metric { fill: ${palette.metric}; font-size: 30px; font-weight: 740; }
      .date { fill: ${palette.accent}; font-size: 25px; font-weight: 720; }
      .metric-label { fill: ${palette.label}; font-size: 14px; font-weight: 580; letter-spacing: 0.8px; }
      .axis-label { fill: ${palette.axis}; font-size: 14px; font-weight: 520; }
      .grid { stroke: ${palette.grid}; stroke-width: 1; }
      .tick { stroke: ${palette.tick}; stroke-width: 1; }
    </style>
  </defs>

  <rect width="${width}" height="${height}" rx="22" fill="url(#background)"/>
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="21.25" fill="none" stroke="${palette.border}" stroke-width="1.5"/>

  <path d="M 55 48 L 61 61 L 75 62.5 L 64.5 71.5 L 67.5 85 L 55 78 L 42.5 85 L 45.5 71.5 L 35 62.5 L 49 61 Z" fill="${palette.accent}"/>
  <text x="92" y="59" class="eyebrow">OPENALICE</text>
  <text x="92" y="91" class="title">Star History</text>

  <g transform="translate(782 43)">
    <text x="0" y="31" class="metric">${formatCount(total)}</text>
    <text x="0" y="56" class="metric-label">STARS AT SNAPSHOT</text>
    <line x1="170" y1="4" x2="170" y2="61" stroke="${palette.divider}"/>
    <text x="207" y="31" class="date">${snapshotMonthDay}</text>
    <text x="207" y="56" class="metric-label">${snapshotYear} · UTC SNAPSHOT</text>
  </g>

  <text x="${plot.left}" y="143" class="metric-label">DAILY CUMULATIVE STAR HISTORY</text>
${grid}
${xAxis}
  <path d="${areaPath}" fill="url(#area)"/>
  <path d="${linePath}" fill="none" stroke="${palette.accent}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${xForIndex(points.length - 1).toFixed(2)}" cy="${yForCount(total).toFixed(2)}" r="6" fill="${palette.accentSoft}" stroke="${palette.endpointStroke}" stroke-width="3"/>
</svg>
`
}

export async function fetchStargazerTimestamps({
  repository = DEFAULT_REPOSITORY,
  token,
  fetchImpl = fetch,
  onPage,
}) {
  if (!token) throw new Error('[star-history] a GitHub token is required')

  const timestamps = []
  const perPage = 100
  for (let page = 1; ; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repository}/stargazers`)
    url.searchParams.set('per_page', String(perPage))
    url.searchParams.set('page', String(page))
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github.star+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'OpenAlice-Star-History',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`[star-history] GitHub API returned ${response.status}: ${detail.slice(0, 240)}`)
    }

    const pageItems = await response.json()
    if (!Array.isArray(pageItems)) {
      throw new Error('[star-history] GitHub API returned an unexpected response')
    }

    for (const item of pageItems) {
      if (typeof item?.starred_at === 'string') timestamps.push(item.starred_at)
    }
    onPage?.({ page, fetched: pageItems.length, total: timestamps.length })

    if (pageItems.length < perPage) break
  }

  return timestamps
}

function resolveGitHubToken() {
  const environmentToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (environmentToken) return environmentToken

  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    throw new Error('[star-history] set GH_TOKEN/GITHUB_TOKEN or authenticate with `gh auth login`')
  }
}

function parseArgs(argv) {
  const values = {
    repository: DEFAULT_REPOSITORY,
    output: DEFAULT_OUTPUT,
    darkOutput: null,
  }

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value == null) {
      throw new Error(`[star-history] invalid arguments: ${argv.join(' ')}`)
    }
    if (key === '--repository') values.repository = value
    else if (key === '--output') values.output = value
    else if (key === '--dark-output') values.darkOutput = value
    else throw new Error(`[star-history] unknown option: ${key}`)
  }

  return values
}

function darkOutputPath(output) {
  const extension = extname(output)
  if (!extension) return `${output}-dark.svg`
  return `${output.slice(0, -extension.length)}-dark${extension}`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const token = resolveGitHubToken()
  const timestamps = await fetchStargazerTimestamps({
    repository: options.repository,
    token,
    onPage: ({ page, total }) => {
      if (page === 1 || page % 10 === 0) {
        console.log(`[star-history] fetched page ${page} (${formatCount(total)} timestamps)`)
      }
    },
  })
  const points = aggregateStarHistory(timestamps)
  const generatedAt = new Date()
  const lightSvg = renderStarHistorySvg({
    points,
    repository: options.repository,
    generatedAt,
    theme: 'light',
  })
  const darkSvg = renderStarHistorySvg({
    points,
    repository: options.repository,
    generatedAt,
    theme: 'dark',
  })
  const outputPath = resolve(options.output)
  const darkOutput = options.darkOutput || darkOutputPath(options.output)
  const darkOutputResolved = resolve(darkOutput)
  mkdirSync(dirname(outputPath), { recursive: true })
  mkdirSync(dirname(darkOutputResolved), { recursive: true })
  writeFileSync(outputPath, lightSvg)
  writeFileSync(darkOutputResolved, darkSvg)
  console.log(`[star-history] wrote ${options.output} and ${darkOutput} from ${formatCount(timestamps.length)} active stargazers`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
