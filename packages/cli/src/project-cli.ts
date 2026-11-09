import { readFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { resolveStoredLaunchContext } from './supervisor-config.ts'
import { isBunStandalone } from './bun-standalone.mjs'

/** Invoke the same manifest-driven payload used by injected Workspace CLIs. */
export async function runProjectCli(argv: string[]): Promise<number> {
  const args = [...argv]
  let project: string | undefined
  let home: string | undefined
  let wsSelector: string | undefined
  while (args[0] === '--project' || args[0] === '--home' || args[0] === '--ws' || args[0] === '--workspace' || args[0] === '--manager') {
    const flag = args.shift()
    if (flag === '--manager') {
      wsSelector = 'workspace-manager'
      continue
    }
    const value = args.shift()
    if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`)
    if (flag === '--project') project = value
    else if (flag === '--home') home = value
    else wsSelector = value
  }
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write('Usage: openalice exec [--project <key> | --home <path>] [--ws <id-or-tag> | --manager] <alice|traderhub|alice-uta> [command flags]\nExample: openalice exec --project research alice market bars --symbol AAPL --asset-class equity --count 250 --output bars.json\nWorkspace context is inherited unless an explicit Project/home is selected. Existing output files are never overwritten.\n')
    return 0
  }
  const binary = args.shift()!
  if (!['alice', 'traderhub', 'alice-uta'].includes(binary)) throw new Error(`Unsupported CLI: ${binary}`)
  const env = { ...process.env }
  const explicit = project !== undefined || home !== undefined
  if (explicit) {
    for (const key of Object.keys(env)) {
      if (key.startsWith('OPENALICE_PROJECT_') || ['OPENALICE_PROJECT', 'OPENALICE_INSTANCE', 'OPENALICE_HOME', 'AQ_WS_ID', 'AQ_RUN_ID', 'AQ_SESSION_ID', 'OPENALICE_TOOL_URL', 'OPENALICE_TOOL_SOCKET', 'OPENALICE_MCP_URL'].includes(key)) delete env[key]
    }
  }
  const context = await resolveStoredLaunchContext({ ...(project ? { project } : {}), ...(home ? { home } : {}) }, { env })
  if (wsSelector !== undefined) {
    delete env.AQ_RUN_ID
    delete env.AQ_SESSION_ID
    if (wsSelector === 'workspace-manager') env.AQ_WS_ID = 'workspace-manager'
    else {
      let registryDoc: string | undefined
      try { registryDoc = await readFile(join(context.home, 'workspaces', 'workspaces.json'), 'utf8') }
      catch (error) {
        if (error !== null && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') throw error
      }
      if (registryDoc === undefined) env.AQ_WS_ID = wsSelector
      else {
        const workspaces = parseWorkspaceEntries(JSON.parse(registryDoc))
        const ciMatches = workspaces.filter(w => w.tag.toLowerCase() === wsSelector.toLowerCase())
        const matched = workspaces.find(w => w.id === wsSelector)
          ?? workspaces.find(w => w.tag === wsSelector)
          ?? (ciMatches.length === 1 ? ciMatches[0] : undefined)
        if (!matched) throw new Error(`Workspace not found in ${context.home}: ${wsSelector}`)
        env.AQ_WS_ID = matched.id
      }
    }
  }
  const endpointPath = join(context.home, 'state', 'cli-endpoint.json')
  let endpoint: { schemaVersion?: number; projectId?: string; home?: string; appRoot?: string; url?: string; socket?: string }
  try { endpoint = JSON.parse(await readFile(endpointPath, 'utf8')) }
  catch { throw new Error(`No CLI endpoint in ${context.home}. Start or restart this Project with the updated OpenAlice Runtime.`) }
  if (endpoint.schemaVersion !== 1 || endpoint.projectId !== context.aliceProject.id || !endpoint.home || resolve(endpoint.home) !== resolve(context.home)) throw new Error('Project CLI endpoint identity does not match the selected Project')
  if (!endpoint.url) throw new Error('Project CLI endpoint has no URL')
  if (!endpoint.socket) {
    const url = new URL(endpoint.url)
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password) throw new Error('Project CLI endpoint must use local HTTP')
  }
  env.OPENALICE_PROJECT_ID = context.aliceProject.id
  env.OPENALICE_HOME = context.home
  env.OPENALICE_TOOL_URL = endpoint.socket ? '/cli' : endpoint.url
  delete env.OPENALICE_TOOL_SOCKET
  if (endpoint.socket) env.OPENALICE_TOOL_SOCKET = endpoint.socket
  env.OPENALICE_CLI_BIN = binary
  let childArgs: string[]
  if (isBunStandalone()) childArgs = ['--workspace-cli', binary, ...args]
  else {
    if (!endpoint.appRoot) throw new Error('Project endpoint is missing its runtime asset root')
    const payload = join(endpoint.appRoot, 'src', 'workspaces', 'cli', 'bin', 'openalice-cli.cjs')
    await access(payload)
    childArgs = [payload, ...args]
  }
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, childArgs, { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => done(code ?? 1))
  })
}

function parseWorkspaceEntries(value: unknown): Array<{ id: string; tag: string }> {
  const entries = Array.isArray(value) ? value : value !== null && typeof value === 'object' && 'workspaces' in value && Array.isArray(value.workspaces) ? value.workspaces : []
  return entries.filter((w): w is { id: string; tag: string } => w !== null && typeof w === 'object' && 'id' in w && 'tag' in w && typeof w.id === 'string' && typeof w.tag === 'string')
}
