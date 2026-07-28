#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_REPOSITORY = 'TraderAlice/OpenAlice'
const DEFAULT_OUTPUT = 'docs/images/star-history.svg'

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
}) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('[star-history] at least one aggregate point is required')
  }

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
  const thirtyDayBaselineIndex = Math.max(0, points.length - 31)
  const lastThirtyDays = total - points[thirtyDayBaselineIndex].count
  const title = `${repository} star history`
  const description = `${formatCount(total)} stars in this snapshot. ${formatCount(lastThirtyDays)} stars added in the latest 30-day window. Daily cumulative history from ${formatFullDate(points[0].date)} through ${formatFullDate(points.at(-1).date)}.`

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
  </metadata>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#101713"/>
      <stop offset="100%" stop-color="#080b09"/>
    </linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e3b341" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#e3b341" stop-opacity="0"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .eyebrow { fill: #8b9890; font-size: 15px; font-weight: 650; letter-spacing: 2.3px; }
      .title { fill: #f2f5f3; font-size: 28px; font-weight: 720; }
      .metric { fill: #f2f5f3; font-size: 30px; font-weight: 740; }
      .metric-label { fill: #8b9890; font-size: 14px; font-weight: 580; letter-spacing: 0.8px; }
      .metric-accent { fill: #e3b341; }
      .axis-label { fill: #7e8a83; font-size: 14px; font-weight: 520; }
      .grid { stroke: #253029; stroke-width: 1; }
      .tick { stroke: #465249; stroke-width: 1; }
    </style>
  </defs>

  <rect width="${width}" height="${height}" rx="22" fill="url(#background)"/>
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="21.25" fill="none" stroke="#29342d" stroke-width="1.5"/>

  <path d="M 55 48 L 61 61 L 75 62.5 L 64.5 71.5 L 67.5 85 L 55 78 L 42.5 85 L 45.5 71.5 L 35 62.5 L 49 61 Z" fill="#e3b341"/>
  <text x="92" y="59" class="eyebrow">OPENALICE</text>
  <text x="92" y="91" class="title">Star History</text>

  <g transform="translate(758 43)">
    <text x="0" y="31" class="metric">${formatCount(total)}</text>
    <text x="0" y="56" class="metric-label">STARS AT SNAPSHOT</text>
    <line x1="160" y1="4" x2="160" y2="61" stroke="#2d3931"/>
    <text x="198" y="31" class="metric metric-accent">+${formatCount(lastThirtyDays)}</text>
    <text x="198" y="56" class="metric-label">LAST 30 DAYS</text>
  </g>

  <text x="${plot.left}" y="143" class="metric-label">DAILY CUMULATIVE · THROUGH ${formatFullDate(points.at(-1).date).toUpperCase()} UTC</text>
${grid}
${xAxis}
  <path d="${areaPath}" fill="url(#area)"/>
  <path d="${linePath}" fill="none" stroke="#e3b341" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" filter="url(#glow)"/>
  <circle cx="${xForIndex(points.length - 1).toFixed(2)}" cy="${yForCount(total).toFixed(2)}" r="6" fill="#f6d365" stroke="#101713" stroke-width="3"/>
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
  }

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value == null) {
      throw new Error(`[star-history] invalid arguments: ${argv.join(' ')}`)
    }
    if (key === '--repository') values.repository = value
    else if (key === '--output') values.output = value
    else throw new Error(`[star-history] unknown option: ${key}`)
  }

  return values
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
  const svg = renderStarHistorySvg({
    points,
    repository: options.repository,
  })
  const outputPath = resolve(options.output)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, svg)
  console.log(`[star-history] wrote ${options.output} from ${formatCount(timestamps.length)} active stargazers`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
