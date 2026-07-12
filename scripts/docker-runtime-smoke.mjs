#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildDockerRuntimeSmokePlan,
  parsePublishedPort,
  redactDockerLogs,
  stripTerminalControl,
} from './docker-runtime-smoke-lib.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const plan = buildDockerRuntimeSmokePlan(process.argv.slice(2))
const {
  aiAgent,
  aiCredentialSlug,
  containerName,
  image,
  keep,
  keepImage,
  ownsImage,
  skipBuild,
  suffix,
  volumeName,
} = plan.options
const logFile = process.env['OPENALICE_DOCKER_SMOKE_LOG_FILE']?.trim()
const runtimeSecrets = []

function printHelp() {
  console.log(`Usage: pnpm docker:smoke [options]

Build and run an isolated OpenAlice server image, create a real Chat Workspace,
open a shell PTY, and execute the injected alice CLI through its live gateway.
Default mode uses no external AI credential or broker account.

Options:
  --skip-build        Reuse a caller-owned image (requires --image)
  --image <tag>       Build/reuse this caller-owned image tag
  --ai-credential <slug>
                      Run a real, two-turn conversation using one credential
                      from Alice's local vault (never copied into the image)
  --ai-agent <id>     claude (default), codex, opencode, or pi
  --keep              Keep the container, volume, and owned image for debugging
  --keep-image        Keep only the temporary image built by this run
  -h, --help          Show this help
`)
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: repoRoot,
    encoding: options.inherit ? undefined : 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    ...(options.input !== undefined ? { input: options.input } : {}),
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`docker ${args[0]} failed (${result.status ?? result.signal ?? 'unknown'})${details ? `:\n${details}` : ''}`)
  }
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

function loadAiCredentialConfig(slug, agent) {
  const source = process.env['OPENALICE_DOCKER_AI_CONFIG_FILE']?.trim()
    || resolve(homedir(), '.openalice', 'data', 'config', 'ai-provider-manager.json')
  const parsed = JSON.parse(readFileSync(source, 'utf8'))
  const credential = parsed?.credentials?.[slug]
  if (!credential || typeof credential !== 'object') throw new Error(`AI credential not found in local vault: ${slug}`)
  if (typeof credential.apiKey !== 'string' || credential.apiKey.length === 0) {
    throw new Error(`AI credential has no API key: ${slug}`)
  }
  if (typeof credential.lastModel !== 'string' || credential.lastModel.length === 0) {
    throw new Error(`AI credential has no remembered model: ${slug}`)
  }
  const wires = credential.wires && typeof credential.wires === 'object'
    ? credential.wires
    : credential.wireShape
      ? { [credential.wireShape]: credential.baseUrl ?? '' }
      : {}
  const compatibleWires = agent === 'codex'
    ? ['openai-responses']
    : agent === 'claude'
      ? ['anthropic']
      : ['openai-chat', 'anthropic', 'openai-responses']
  if (!compatibleWires.some((wire) => wire in wires)) {
    throw new Error(`AI credential ${slug} cannot drive ${agent}; missing a compatible wire`)
  }
  runtimeSecrets.push(credential.apiKey)
  return {
    model: credential.lastModel,
    config: {
      credentials: { [slug]: credential },
      workspaceCredentialDefaults: {
        [agent]: { credentialSlug: slug, model: credential.lastModel },
      },
    },
  }
}

function writeAiCredentialConfigToContainer(config) {
  const writer = [
    "const fs=require('node:fs')",
    "let input=''",
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data',(chunk)=>{input+=chunk})",
    "process.stdin.on('end',()=>{fs.mkdirSync('/data/data/config',{recursive:true});fs.writeFileSync('/data/data/config/ai-provider-manager.json',input,{mode:0o600})})",
  ].join(';')
  docker(['exec', '--interactive', containerName, 'node', '-e', writer], {
    input: `${JSON.stringify(config)}\n`,
  })
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function fetchJson(baseUrl, path, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (response.status !== expectedStatus) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`)
  }
  return body
}

async function waitForHttp(baseUrl, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    const state = docker(['inspect', '--format', '{{.State.Status}}', containerName], { allowFailure: true })
    if (state.ok && state.stdout.trim() === 'exited') {
      throw new Error('container exited before the HTTP surface became ready')
    }
    try {
      const version = await fetchJson(baseUrl, '/api/version')
      return version
    } catch (error) {
      lastError = error
      await sleep(250)
    }
  }
  throw new Error(`Alice HTTP surface did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function dispatchHeadlessTurn(baseUrl, workspaceId, { agent, prompt, resumeId }, timeoutMs = 180_000) {
  const dispatched = await fetchJson(baseUrl, `/api/workspaces/${workspaceId}/headless`, {
    method: 'POST',
    body: JSON.stringify({
      agent,
      prompt,
      timeoutMs,
      ...(resumeId ? { resumeId } : {}),
    }),
  }, 202)
  if (typeof dispatched?.taskId !== 'string' || typeof dispatched?.resumeId !== 'string') {
    throw new Error('headless dispatch omitted taskId or resumeId')
  }

  const deadline = Date.now() + timeoutMs + 15_000
  let task = null
  while (Date.now() < deadline) {
    task = await fetchJson(baseUrl, `/api/headless/${dispatched.taskId}`)
    if (task?.status !== 'running') break
    await sleep(500)
  }
  const output = await fetchJson(baseUrl, `/api/headless/${dispatched.taskId}/output`)
  if (task?.status !== 'done') {
    throw new Error(
      `AI turn ${dispatched.taskId} ended as ${task?.status ?? 'unknown'}: ${output?.structured?.assistantText ?? output?.stderr?.text ?? 'no diagnostics'}`,
    )
  }
  return {
    taskId: dispatched.taskId,
    resumeId: dispatched.resumeId,
    assistantText: output?.structured?.assistantText,
    structured: output?.structured,
  }
}

async function runCredentialedConversation(baseUrl, workspaceId, agent, model) {
  const codeword = `docker-${suffix.slice(0, 8)}`
  const first = await dispatchHeadlessTurn(baseUrl, workspaceId, {
    agent,
    prompt: `Remember the codeword ${codeword}. Reply with exactly: ACK ${codeword}. Do not use tools.`,
  })
  if (typeof first.assistantText !== 'string' || !first.assistantText.includes(codeword)) {
    throw new Error(`AI turn 1 did not return the codeword: ${first.assistantText ?? 'no assistant text'}`)
  }
  console.log(`[docker-smoke] AI turn 1 (${agent}/${model}): ${first.assistantText.trim()}`)

  const second = await dispatchHeadlessTurn(baseUrl, workspaceId, {
    agent,
    resumeId: first.resumeId,
    prompt: 'What codeword did I ask you to remember in the previous turn? Reply with only that codeword. Do not use tools.',
  })
  if (second.resumeId !== first.resumeId) throw new Error('AI turn 2 changed the OpenAlice resume identity')
  if (typeof second.assistantText !== 'string' || !second.assistantText.includes(codeword)) {
    throw new Error(`AI turn 2 did not remember the codeword: ${second.assistantText ?? 'no assistant text'}`)
  }
  console.log(`[docker-smoke] AI turn 2 resumed ${first.resumeId}: ${second.assistantText.trim()}`)

  const issueId = `docker-cli-${suffix.slice(0, 8)}`
  const dataMarker = `CLI_DATA_${suffix.slice(0, 8).toUpperCase()}`
  const third = await dispatchHeadlessTurn(baseUrl, workspaceId, {
    agent,
    resumeId: first.resumeId,
    prompt: [
      'Use the Bash tool to run these commands in order:',
      `alice-workspace issue create --title "${issueId}" --what "Docker CLI marker ${dataMarker}"`,
      `alice-workspace issue show --id "${issueId}"`,
      `Only if the second command output contains ${dataMarker}, reply exactly: CLI_DATA_OK ${dataMarker}`,
    ].join('\n'),
  })
  const completedToolOutput = JSON.stringify(
    (third.structured?.blocks ?? [])
      .filter((block) => block?.type === 'tool' && block.status === 'completed')
      .map((block) => block.output),
  )
  if ((third.structured?.metrics?.toolCalls ?? 0) < 1) {
    throw new Error('AI CLI-data turn completed without a recorded tool call')
  }
  if (!completedToolOutput.includes(dataMarker)) {
    throw new Error('AI CLI-data tool output did not contain the seeded Workspace marker')
  }
  if (third.assistantText?.trim() !== `CLI_DATA_OK ${dataMarker}`) {
    throw new Error(`AI did not confirm the CLI data round trip: ${third.assistantText ?? 'no assistant text'}`)
  }
  console.log(`[docker-smoke] AI Workspace CLI data (${third.structured.metrics.toolCalls} tool calls): ${third.assistantText.trim()}`)

  const market = await dispatchHeadlessTurn(baseUrl, workspaceId, {
    agent,
    resumeId: first.resumeId,
    prompt: [
      'Use the Bash tool to run exactly: traderhub board get --board macro',
      'Read the actual command output. Reply on one line starting with MARKET_DATA_OK followed by one metric label and value from that output.',
      'If the command fails or returns no macro data, reply exactly: MARKET_DATA_FAILED',
    ].join('\n'),
  })
  const marketToolOutput = JSON.stringify(
    (market.structured?.blocks ?? [])
      .filter((block) => block?.type === 'tool' && block.status === 'completed')
      .map((block) => block.output),
  )
  if ((market.structured?.metrics?.toolCalls ?? 0) < 1) {
    throw new Error('AI market-data turn completed without a recorded tool call')
  }
  if (!/(CPI|Fed|Treasury|Unemployment|Oil|M2|GDP|Rates)/i.test(marketToolOutput)) {
    throw new Error(`traderhub macro output was missing expected market fields: ${marketToolOutput.slice(-2000)}`)
  }
  if (!market.assistantText?.trim().startsWith('MARKET_DATA_OK ')) {
    throw new Error(`AI did not confirm the market-data round trip: ${market.assistantText ?? 'no assistant text'}`)
  }
  console.log(`[docker-smoke] AI traderhub market data: ${market.assistantText.trim()}`)
}

function decodeWsData(data) {
  if (typeof data === 'string') return Promise.resolve(data)
  if (data instanceof ArrayBuffer) return Promise.resolve(Buffer.from(data).toString('utf8'))
  if (ArrayBuffer.isView(data)) {
    return Promise.resolve(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8'))
  }
  if (data && typeof data.arrayBuffer === 'function') {
    return data.arrayBuffer().then((buffer) => Buffer.from(buffer).toString('utf8'))
  }
  return Promise.resolve(String(data ?? ''))
}

function runWorkspaceCliThroughPty(baseUrl, sessionId) {
  const wsUrl = new URL('/api/workspaces/pty', baseUrl)
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  wsUrl.searchParams.set('session', sessionId)
  wsUrl.searchParams.set('cols', '120')
  wsUrl.searchParams.set('rows', '32')
  wsUrl.searchParams.set('client', `docker-smoke-${suffix}`)
  wsUrl.searchParams.set('kind', 'smoke')
  wsUrl.searchParams.set('takeover', '1')

  const marker = `OA_DOCKER_${suffix.toUpperCase()}`
  const startMarker = `__${marker}_START__`
  const exitMarker = `__${marker}_EXIT__:0`
  const command = [
    `m=${marker}`,
    `printf '\\n__%s_START__\\n' "$m"`,
    'command -v alice',
    'alice',
    'status=$?',
    `printf '\\n__%s_EXIT__:%s\\n' "$m" "$status"`,
  ].join('; ')

  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    let output = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { ws.close() } catch { /* noop */ }
      if (error) rejectPromise(error)
      else resolvePromise(stripTerminalControl(output))
    }
    const timeout = setTimeout(() => {
      finish(new Error(`PTY CLI round-trip timed out. Output:\n${stripTerminalControl(output).slice(-4000)}`))
    }, 30_000)

    // PersistentSession reserves text frames for JSON control messages. PTY
    // keystrokes must be binary, matching the browser terminal transport.
    ws.addEventListener('open', () => ws.send(Buffer.from(`${command}\r`, 'utf8')))
    ws.addEventListener('message', (event) => {
      void decodeWsData(event.data).then((chunk) => {
        output += chunk
        const clean = stripTerminalControl(output)
        if (clean.includes(exitMarker)) {
          const result = clean.slice(clean.lastIndexOf(startMarker))
          if (!result.includes('/usr/local/bin/alice')) {
            finish(new Error(`Workspace PATH did not resolve the image-owned alice launcher:\n${result.slice(-4000)}`))
          } else if (!result.includes('OpenAlice CLI')) {
            finish(new Error(`alice did not read its live CLI manifest:\n${result.slice(-4000)}`))
          } else {
            finish(null)
          }
        }
      }).catch(finish)
    })
    ws.addEventListener('error', () => finish(new Error('PTY WebSocket failed')))
    ws.addEventListener('close', () => {
      if (!settled) finish(new Error(`PTY WebSocket closed before ${exitMarker}`))
    })
  })
}

function collectFailureLogs() {
  const logs = docker(['logs', containerName], { allowFailure: true })
  const inspect = docker([
    'inspect',
    '--format',
    'state={{json .State}} health={{json .State.Health}} network={{json .NetworkSettings.Ports}}',
    containerName,
  ], { allowFailure: true })
  const report = redactDockerLogs([
    '=== docker state ===',
    inspect.stdout,
    inspect.stderr,
    '=== docker logs ===',
    logs.stdout,
    logs.stderr,
  ].filter(Boolean).join('\n'), runtimeSecrets).trim()
  if (logFile && report) {
    const target = resolve(repoRoot, logFile)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${report}\n`)
    console.error(`[docker-smoke] failure log: ${target}`)
  }
  return report
}

if (plan.options.help) {
  printHelp()
  process.exit(0)
}
if (plan.errors.length > 0) {
  for (const error of plan.errors) console.error(error)
  printHelp()
  process.exit(1)
}
for (const warning of plan.warnings) console.warn(warning)

let containerCreated = false
let volumeCreated = false
let passed = false
let finalCode = 0
let aiCredential = null

try {
  if (aiCredentialSlug) aiCredential = loadAiCredentialConfig(aiCredentialSlug, aiAgent)
  docker(['info'])
  if (!skipBuild) {
    console.log(`[docker-smoke] building ${image}`)
    docker(['build', '--tag', image, '.'], { inherit: true })
  } else {
    console.log(`[docker-smoke] reusing caller-owned image ${image}`)
  }

  docker(['volume', 'create', '--label', 'openalice.smoke=1', volumeName])
  volumeCreated = true
  const run = docker([
    'run', '--detach',
    '--name', containerName,
    '--label', 'openalice.smoke=1',
    '--publish', '127.0.0.1::47331',
    '--env', 'OPENALICE_DISABLE_AUTH=1',
    '--env', 'OPENALICE_TRADING_MODE=lite',
    '--mount', `type=volume,source=${volumeName},target=/data`,
    image,
  ])
  containerCreated = true
  console.log(`[docker-smoke] container: ${containerName} (${run.stdout.trim().slice(0, 12)})`)

  const port = parsePublishedPort(docker(['port', containerName, '47331/tcp']).stdout)
  const baseUrl = `http://127.0.0.1:${port}`
  const version = await waitForHttp(baseUrl)
  console.log(`[docker-smoke] HTTP ready: ${baseUrl} (${version?.version ?? 'version route OK'})`)
  const agentInventory = await fetchJson(baseUrl, '/api/workspaces/agents')
  const inventoryById = new Map((agentInventory?.agents ?? []).map((agent) => [agent.id, agent]))
  const missingRuntimes = ['claude', 'codex', 'opencode', 'pi'].filter(
    (id) => inventoryById.get(id)?.installed !== true,
  )
  if (missingRuntimes.length > 0) {
    throw new Error(`Docker image did not detect all agent runtimes: ${missingRuntimes.join(', ')}`)
  }
  console.log('[docker-smoke] agent runtimes detected: claude, codex, opencode, pi')
  if (aiCredential) {
    writeAiCredentialConfigToContainer(aiCredential.config)
    console.log(`[docker-smoke] staged isolated ${aiAgent} credential config (${aiCredential.model})`)
  }

  const created = await fetchJson(baseUrl, '/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({
      tag: `docker-smoke-${suffix}`,
      template: 'chat',
      agents: ['shell', ...(aiCredential ? [aiAgent] : [])],
    }),
  }, 201)
  const workspaceId = created?.workspace?.id
  if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspace create response omitted workspace.id')
  console.log(`[docker-smoke] Workspace created: ${workspaceId}`)

  const session = await fetchJson(baseUrl, `/api/workspaces/${workspaceId}/sessions/spawn`, {
    method: 'POST',
    body: JSON.stringify({ agent: 'shell' }),
  }, 201)
  if (typeof session?.sessionId !== 'string' || !session.sessionId) {
    throw new Error('shell spawn response omitted sessionId')
  }
  console.log(`[docker-smoke] shell Session spawned: ${session.sessionId}`)

  const terminalOutput = await runWorkspaceCliThroughPty(baseUrl, session.sessionId)
  console.log('[docker-smoke] Workspace PTY + alice manifest round-trip: OK')
  if (process.env['OPENALICE_DOCKER_SMOKE_VERBOSE'] === '1') console.log(terminalOutput)
  if (aiCredential) {
    await runCredentialedConversation(baseUrl, workspaceId, aiAgent, aiCredential.model)
    console.log('[docker-smoke] credentialed multi-turn conversation + Workspace CLI data: OK')
  }

  await fetchJson(baseUrl, `/api/workspaces/${workspaceId}/offboard`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'docker runtime smoke complete' }),
  })
  console.log('[docker-smoke] Workspace offboarding: OK')
  passed = true
} catch (error) {
  finalCode = 1
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[docker-smoke] ${redactDockerLogs(message, runtimeSecrets)}`)
  if (containerCreated) {
    const report = collectFailureLogs()
    if (report) console.error(report.split('\n').slice(-160).join('\n'))
  }
} finally {
  if (keep) {
    console.log(`[docker-smoke] kept container=${containerName} volume=${volumeName} image=${image}`)
  } else {
    const cleanupFailures = []
    const cleanup = (label, args) => {
      const result = docker(args, { allowFailure: true })
      if (!result.ok) cleanupFailures.push(`${label}: ${(result.stderr || result.stdout).trim() || 'docker command failed'}`)
    }
    if (containerCreated) cleanup('container', ['rm', '--force', containerName])
    if (volumeCreated) cleanup('volume', ['volume', 'rm', '--force', volumeName])
    if (ownsImage && !keepImage) cleanup('image', ['image', 'rm', '--force', image])
    if (cleanupFailures.length > 0) {
      finalCode = 1
      console.error(`[docker-smoke] owned resource cleanup failed:\n${cleanupFailures.join('\n')}`)
    }
  }
}

if (passed) console.log('[docker-smoke] passed')
process.exit(finalCode)
