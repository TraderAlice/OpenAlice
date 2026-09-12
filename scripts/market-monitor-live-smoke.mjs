#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ASSETS = ['BTC', 'TSLA']
const DEFAULT_BASE_URL = 'http://127.0.0.1:47331'
const DEFAULT_OUTPUT = 'dist/market-monitor-acceptance.json'

export function parseOptions(argv, env = process.env) {
  const options = {
    baseUrl: env.OPENALICE_MARKET_MONITOR_BASE_URL?.trim() || DEFAULT_BASE_URL,
    output: DEFAULT_OUTPUT,
    scan: false,
    allowRemote: false,
    assets: [...ASSETS],
    help: false,
  }
  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--scan') options.scan = true
    else if (arg === '--allow-remote') options.allowRemote = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--base-url=')) options.baseUrl = arg.slice('--base-url='.length)
    else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length)
    else if (arg.startsWith('--asset=')) {
      const asset = arg.slice('--asset='.length).toUpperCase()
      if (!ASSETS.includes(asset)) throw new Error('--asset must be BTC or TSLA')
      options.assets = [asset]
    } else throw new Error(`unknown option: ${arg}`)
  }
  const url = new URL(options.baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--base-url must use http or https')
  options.baseUrl = url.toString().replace(/\/$/, '')
  if (!options.allowRemote && !isLoopbackHost(url.hostname)) {
    throw new Error('remote acceptance requires --allow-remote; the default is loopback-only')
  }
  if (!options.output.trim()) throw new Error('--output must not be empty')
  return options
}

export function isLoopbackHost(hostname) {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value)
}

export function validateSnapshot(asset, snapshot) {
  if (!snapshot || snapshot.asset !== asset) throw new Error(`${asset}: response has the wrong asset`)
  if (snapshot.strategyId !== 'evidence-chain-v1') throw new Error(`${asset}: unexpected strategy identity`)
  if (!snapshot.fingerprint || !snapshot.hypothesis?.id) throw new Error(`${asset}: evidence identity is incomplete`)
  if (!Number.isFinite(snapshot.metrics?.lastPrice)) throw new Error(`${asset}: last price is unavailable`)
  if (!Array.isArray(snapshot.chart?.daily) || snapshot.chart.daily.length < 20) throw new Error(`${asset}: fewer than 20 daily bars were restored`)
  if (!Array.isArray(snapshot.chart?.intraday)) throw new Error(`${asset}: intraday series is not explicit`)
  const health = snapshot.sourceHealth
  if (!Array.isArray(health) || !health.some((source) => source.id === 'daily-bars')) {
    throw new Error(`${asset}: daily source attribution is missing`)
  }
  const hourly = health.find((source) => source.id === 'intraday-bars')
  if (!hourly) throw new Error(`${asset}: hourly source attribution is missing`)
  if (hourly.status === 'unavailable' && snapshot.chart.intraday.length !== 0) {
    throw new Error(`${asset}: unavailable hourly data was replaced by another timeframe`)
  }
}

export function validateScanPair(asset, first, second) {
  validateSnapshot(asset, first?.snapshot)
  validateSnapshot(asset, second?.snapshot)
  for (const result of [first, second]) {
    const expected = result.stored ? 'stored' : 'duplicate'
    if (result.receipt?.asset !== asset || result.receipt?.outcome !== expected) {
      throw new Error(`${asset}: scan receipt does not match its storage outcome`)
    }
  }
  if (first.snapshot.fingerprint === second.snapshot.fingerprint && second.stored) {
    throw new Error(`${asset}: identical semantic evidence created a duplicate observation`)
  }
}

async function request(fetcher, baseUrl, path, init, timeoutMs = 45_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${baseUrl}${path}`, { ...init, signal: controller.signal })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`${init?.method ?? 'GET'} ${path} returned ${response.status}: ${detail}`)
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function json(fetcher, baseUrl, path, init) {
  return request(fetcher, baseUrl, path, init).then((response) => response.json())
}

export async function runAcceptance(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const startedAt = new Date().toISOString()
  const page = await request(fetcher, options.baseUrl, '/market/evidence')
  const html = await page.text()
  if (!html.includes('id="root"')) throw new Error('market page did not return the OpenAlice application shell')
  const settings = await json(fetcher, options.baseUrl, '/api/market-monitor/settings')
  if (!Array.isArray(settings.enabledAssets) || !Number.isFinite(settings.intervalMinutes)) {
    throw new Error('monitor settings response is invalid')
  }

  const assets = []
  for (const asset of options.assets) {
    const before = await json(fetcher, options.baseUrl, `/api/market-monitor/snapshots?asset=${asset}&limit=1000`)
    let first = null
    let second = null
    if (options.scan) {
      const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset, trigger: 'manual' }) }
      first = await json(fetcher, options.baseUrl, '/api/market-monitor/scan', init)
      second = await json(fetcher, options.baseUrl, '/api/market-monitor/scan', init)
      validateScanPair(asset, first, second)
    }
    const snapshots = await json(fetcher, options.baseUrl, `/api/market-monitor/snapshots?asset=${asset}&limit=1000`)
    const receipts = await json(fetcher, options.baseUrl, `/api/market-monitor/receipts?asset=${asset}&limit=1000`)
    const alerts = await json(fetcher, options.baseUrl, `/api/market-monitor/alerts?asset=${asset}&limit=1000`)
    const evaluation = await json(fetcher, options.baseUrl, `/api/market-monitor/evaluation?asset=${asset}`)
    const latest = snapshots.snapshots?.at(-1)
    if (latest) validateSnapshot(asset, latest)
    if (options.scan && (!latest || snapshots.count < before.count || receipts.count < 2)) {
      throw new Error(`${asset}: persisted histories did not reflect the acceptance scans`)
    }
    assets.push({
      asset,
      beforeSnapshots: before.count,
      afterSnapshots: snapshots.count,
      receipts: receipts.count,
      alerts: alerts.count,
      evaluationSamples: evaluation.samples,
      firstOutcome: first?.receipt?.outcome ?? null,
      secondOutcome: second?.receipt?.outcome ?? null,
      latestFingerprint: latest?.fingerprint ?? null,
      sources: latest?.sourceHealth?.map(({ id, status, provider }) => ({ id, status, provider })) ?? [],
    })
  }
  return {
    schemaVersion: 1,
    success: true,
    mode: options.scan ? 'live-scan' : 'read-only',
    baseUrl: options.baseUrl,
    startedAt,
    completedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    assets,
  }
}

export function helpText() {
  return `Usage: pnpm market-monitor:acceptance -- [options]

Checks a running OpenAlice Market Evidence Monitor.

Options:
  --scan                 Run two real read-only market scans per asset
  --asset=BTC|TSLA       Limit acceptance to one asset
  --base-url=<url>       OpenAlice Web endpoint (default ${DEFAULT_BASE_URL})
  --output=<path>        Receipt path (default ${DEFAULT_OUTPUT})
  --allow-remote         Permit a non-loopback endpoint
  --help                 Show this message`
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  const report = await runAcceptance(options)
  const output = resolve(options.output)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  for (const asset of report.assets) {
    console.log(`[market-monitor] ${asset.asset}: snapshots ${asset.beforeSnapshots} -> ${asset.afterSnapshots}; scans ${asset.firstOutcome ?? 'not run'} / ${asset.secondOutcome ?? 'not run'}`)
  }
  console.log(`[market-monitor] PASS (${report.mode}) -> ${output}`)
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(`[market-monitor] FAIL: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
