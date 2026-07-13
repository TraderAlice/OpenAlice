/*
 * Shared OpenAlice workspace CLI payload.
 *
 * A thin argv -> JSON -> HTTP forwarder over the /cli gateway (see
 * src/server/cli.ts). It owns no schema and no business logic: the gateway
 * validates + executes, the manifest drives --help, so new capabilities appear
 * here with zero changes to this file.
 *
 * The extensionless POSIX launchers and Windows `.cmd` twins set
 * OPENALICE_CLI_BIN to the command name, then execute this explicit `.cjs`
 * payload. Packaged launchers prefer Electron's managed Node runtime, so a
 * user's host Node version (or lack of Node) cannot change module loading.
 *
 * Runs from a workspace PTY shell, reading env the launcher already injects per
 * spawn (OPENALICE_TOOL_URL + AQ_WS_ID). It owns no Alice imports and therefore
 * needs no build step. Dynamic import is used only for node:http socket access,
 * which works from this CommonJS payload on every supported Node runtime.
 *
 *   alice                              list command groups (data export)
 *   alice-workspace inbox push ...     collaboration export
 *   <bin> <group> <verb> --help        show a verb's flags
 *   <bin> <group> <verb> [--flags]     run it; JSON to stdout
 */

// The binary name this was invoked as — set in main() from argv; drives the
// export selection and all help/error text.
let BIN = 'alice'

async function main() {
  const argv = process.argv.slice(2)

  // Launchers provide the public command name because argv[1] now points to
  // this shared payload. Keep argv fallback for direct diagnostics/tests.
  BIN = (
    process.env.OPENALICE_CLI_BIN ||
    (process.argv[1] || 'alice').split(/[\\/]/).pop() ||
    'alice'
  ).split(/[\\/]/).pop() || 'alice'
  const exportKey = BIN === 'alice' ? 'data' : BIN.replace(/^alice-/, '')

  const toolSocket = process.env.OPENALICE_TOOL_SOCKET
  const toolUrl = process.env.OPENALICE_TOOL_URL
  const legacyMcpUrl = process.env.OPENALICE_MCP_URL || 'http://127.0.0.1:47332/mcp'
  const wsId = process.env.AQ_WS_ID
  if (!wsId) {
    fail('AQ_WS_ID is not set — run from inside an OpenAlice workspace.')
  }
  // Prefer the dedicated CLI base. Fall back to legacy MCP-derived config so
  // older workspace envs keep working: .../mcp -> .../cli/<wsId>/<export>.
  const gateway = toolSocket
    ? (toolUrl || '/cli').replace(/\/+$/, '')
    : toolUrl
      ? toolUrl.replace(/\/+$/, '')
      : legacyMcpUrl.replace(/\/+$/, '').replace(/\/mcp$/, '/cli')
  const base = gateway + '/' + wsId + '/' + exportKey
  debug('runtime', { bin: BIN, wsId, toolSocket, toolUrl, base })

  const wantsHelp = argv.includes('--help') || argv.includes('-h')
  const positionals = argv.filter((a) => !a.startsWith('-'))
  const group = positionals[0]
  const verb = positionals[1]

  // `<bin>` / `<bin> --help` -> group listing
  if (!group) return printGroups(await manifest(base))

  const m = await manifest(base)
  const groupCmds = m.groups[group]
  if (!groupCmds) fail(`unknown group "${group}". Run \`${BIN}\` to list groups.`)

  // `<bin> <group>` / `<bin> <group> --help` -> verb listing
  if (!verb || (wantsHelp && !m.groups[group][verb])) return printVerbs(group, groupCmds)

  const cmd = groupCmds[verb]
  if (!cmd) fail(`unknown command "${group} ${verb}". Run \`${BIN} ${group}\` to list verbs.`)

  // `alice <group> <verb> --help` -> flag listing
  if (wantsHelp) return printVerbHelp(group, verb, cmd)

  // Run it.
  const args = parseFlags(argv.slice(argv.indexOf(verb) + 1), cmd.schema)
  const res = await invoke(base, cmd.tool, args)
  process.stdout.write(res.endsWith('\n') ? res : res + '\n')
}

// ---- HTTP -----------------------------------------------------------------

async function manifest(base) {
  const r = await fetchJson(base + '/manifest', { method: 'GET' })
  if (!r.ok) {
    const msg = r.body && r.body.error ? r.body.error : `HTTP ${r.status}`
    fail(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  if (!r.body || typeof r.body !== 'object' || !r.body.groups || typeof r.body.groups !== 'object') {
    const kind =
      typeof r.body === 'string' && r.body.trim().startsWith('<')
        ? 'HTML'
        : r.body === null
          ? 'empty response'
          : typeof r.body
    fail(
      `invalid OpenAlice CLI manifest from ${base}/manifest (${kind}) — ` +
        'check OPENALICE_TOOL_URL / OPENALICE_TOOL_SOCKET and point at the tools endpoint, not the Vite UI page.',
    )
  }
  return r.body
}

async function invoke(base, tool, args) {
  // Agent-invisible identity, forwarded out-of-band as a header — NOT in the
  // tool args, NOT in the path — so the gateway can server-side-resolve the
  // entry's origin without the agent ever trafficking its own identity. The
  // launcher injects exactly one per spawn (mirrors how it injects AQ_WS_ID for
  // the path): AQ_RUN_ID on a HEADLESS spawn, AQ_SESSION_ID on an INTERACTIVE
  // one. So at most one of these headers is ever sent.
  const headers = { 'Content-Type': 'application/json' }
  const runId = process.env.AQ_RUN_ID
  if (runId) headers['x-openalice-run'] = runId
  const sessionId = process.env.AQ_SESSION_ID
  if (sessionId) headers['x-openalice-session'] = sessionId
  const r = await fetchJson(base + '/invoke', {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool, args }),
  })
  if (!r.ok) {
    let msg = r.body && r.body.error ? r.body.error : `HTTP ${r.status}`
    if (typeof msg !== 'string') msg = JSON.stringify(msg)
    const details = r.body && r.body.details
    if (details) msg += '\n' + (typeof details === 'string' ? details : JSON.stringify(details, null, 2))
    fail(msg)
  }
  const blocks = (r.body && r.body.content) || []
  return blocks
    .map((b) => (b && b.type === 'text' ? b.text : b ? `[${b.type}]` : ''))
    .join('\n')
}

async function fetchJson(url, opts) {
  if (process.env.OPENALICE_TOOL_SOCKET && url.startsWith('/')) {
    return fetchSocketJson(process.env.OPENALICE_TOOL_SOCKET, url, opts)
  }
  let resp
  try {
    resp = await fetch(url, opts)
  } catch (e) {
    fail(`cannot reach OpenAlice at ${url} — is the backend running? (${e && e.message})`)
  }
  let body = null
  const text = await resp.text()
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { ok: resp.ok, status: resp.status, body }
}

async function fetchSocketJson(socketPath, path, opts) {
  const http = await import('node:http')
  debug('socket.request', { socketPath, path, method: opts && opts.method ? opts.method : 'GET' })
  return new Promise((resolve) => {
    const req = http.request({
      socketPath,
      path,
      method: opts && opts.method ? opts.method : 'GET',
      headers: opts && opts.headers ? opts.headers : undefined,
    }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let body = null
        try { body = raw ? JSON.parse(raw) : null } catch { body = raw }
        debug('socket.response', { path, status: res.statusCode, bytes: raw.length })
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body })
      })
    })
    req.on('error', (e) => {
      debug('socket.error', { socketPath, path, code: e && e.code, message: e && e.message })
      fail(`cannot reach OpenAlice at ${socketPath}${path} — is the backend running? (${e && e.message})`)
    })
    if (opts && opts.body) req.write(opts.body)
    req.end()
  })
}

// ---- flag parsing ---------------------------------------------------------

function parseFlags(tokens, schema) {
  const args = {}
  const meta = {}
  const docs = []
  const properties = (schema && schema.properties) || {}
  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i]
    if (!tok.startsWith('--')) continue
    tok = tok.slice(2)
    let key, val
    const eq = tok.indexOf('=')
    if (eq >= 0) {
      key = tok.slice(0, eq)
      val = tok.slice(eq + 1)
    } else {
      key = tok
      const next = tokens[i + 1]
      if (next === undefined || next.startsWith('--')) {
        val = 'true' // bare flag -> boolean-ish; gateway coerces as needed
      } else {
        val = next
        i++
      }
    }
    // JSON-looking values parse into objects/arrays so object flags work:
    //   --takeProfit '{"price":"1725"}'
    // Parse failures fall through as plain strings (gateway validates).
    if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
      try { val = JSON.parse(val) } catch { /* keep the raw string */ }
    }
    // Shell-facing flags are kebab-case; tool schemas are commonly camelCase.
    // Preserve an exact schema key first (some data tools intentionally use
    // hyphenated keys), then normalize only when the camelCase key exists.
    const camelKey = key.replace(/-([a-zA-Z0-9])/g, (_, ch) => ch.toUpperCase())
    const schemaKey = Object.prototype.hasOwnProperty.call(properties, key)
      ? key
      : Object.prototype.hasOwnProperty.call(properties, camelKey)
        ? camelKey
        : key
    const propertySchema = properties[schemaKey]
    if (propertySchema && propertySchema.type === 'boolean' && typeof val === 'string') {
      if (val === 'true') val = true
      else if (val === 'false') val = false
    }
    if (schemaKey === 'meta') {
      // repeatable: --meta key=value -> metadataFilter
      const e = val.indexOf('=')
      if (e >= 0) meta[val.slice(0, e)] = val.slice(e + 1)
    } else if (schemaKey === 'doc') {
      // repeatable: --doc <path> -> docs: [{ path }] (inbox_push attachments).
      // A JSON object value (--doc '{"path":"x"}') is kept as-is so future
      // per-doc fields keep working; a bare path is wrapped into { path }.
      docs.push(val && typeof val === 'object' ? val : { path: String(val) })
    } else if (propertySchema && propertySchema.type === 'array') {
      const current = Array.isArray(args[schemaKey]) ? args[schemaKey] : []
      args[schemaKey] = current.concat(Array.isArray(val) ? val : [val])
    } else {
      args[schemaKey] = val
    }
  }
  if (Object.keys(meta).length) args.metadataFilter = meta
  if (docs.length) args.docs = docs
  return args
}

// ---- help rendering -------------------------------------------------------

function printGroups(m) {
  const groups = Object.keys(m.groups)
  const width = Math.max(...groups.map((g) => g.length), 1)
  out(`OpenAlice CLI — ${BIN} <group> <verb> [--flags]`)
  if (m.description) out(m.description)
  out('')
  for (const g of groups) {
    out(`  ${g.padEnd(width)}  ${Object.keys(m.groups[g]).join(', ')}`)
  }
  out(`\nRun \`${BIN} <group>\` or \`${BIN} <group> <verb> --help\` for details.`)
  if (m.unmapped && m.unmapped.length) {
    out(`\n(${m.unmapped.length} tool(s) reachable via MCP but not this CLI)`)
  }
}

function printVerbs(group, cmds) {
  const verbs = Object.keys(cmds)
  const width = Math.max(...verbs.map((v) => v.length), 1)
  out(`${BIN} ${group} <verb> [--flags]\n`)
  for (const v of verbs) {
    out(`  ${v.padEnd(width)}  ${firstLine(cmds[v].description)}`)
  }
}

function printVerbHelp(group, verb, cmd) {
  out(`${BIN} ${group} ${verb} [--flags]\n`)
  if (cmd.description) out(cmd.description + '\n')
  const props = (cmd.schema && cmd.schema.properties) || {}
  const required = new Set((cmd.schema && cmd.schema.required) || [])
  const names = Object.keys(props)
  if (!names.length) return out('(no flags)')
  out('Flags:')
  for (const n of names) {
    const p = props[n] || {}
    const type = p.type || (p.enum ? 'enum' : '')
    const req = required.has(n) ? ' (required)' : ''
    const flag = n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    const valueHint = type === 'array'
      ? ' <value>'
      : type && type !== 'boolean'
        ? ' <' + type + '>'
        : ''
    const repeatable = type === 'array' ? ' (repeatable)' : ''
    out(`  --${flag}${valueHint}${req}${repeatable}   ${firstLine(p.description || '')}`)
  }
}

// ---- util -----------------------------------------------------------------

function firstLine(s) {
  return (s || '').split('\n')[0]
}
function out(s) {
  process.stdout.write(s + '\n')
}
function debug(label, value) {
  if (process.env.OPENALICE_CLI_DEBUG !== '1') return
  out('[openalice-cli-debug] ' + label + ' ' + JSON.stringify(value))
}
function fail(msg) {
  process.stderr.write(BIN + ': ' + msg + '\n')
  process.exit(1)
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)))
