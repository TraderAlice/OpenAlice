import { createServer } from 'node:net'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const PORT_DEFAULTS = {
  web: 47331,
  mcp: 47332,
  uta: 47333,
  connector: 47334,
}

const ENV_KEYS = {
  web: 'OPENALICE_WEB_PORT',
  mcp: 'OPENALICE_MCP_PORT',
  uta: 'OPENALICE_UTA_PORT',
  connector: 'OPENALICE_CONNECTOR_PORT',
}

export function parseProdPort(raw, origin) {
  const port = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `[guardian/prod] invalid port ${JSON.stringify(raw)} from ${origin} — expected an integer in 1..65535`,
    )
  }
  return port
}

export async function readProdPortsFile(userDataHome, options = {}) {
  const readFileImpl = options.readFileImpl ?? readFile
  const filePath = resolve(userDataHome, 'data', 'config', 'ports.json')
  let raw
  try {
    raw = await readFileImpl(filePath, 'utf8')
  } catch {
    return {}
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `[guardian/prod] ${filePath} is not valid JSON: ${error?.message ?? error}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `[guardian/prod] ${filePath} must be a JSON object like {"web":47331,"mcp":47332,"uta":47333,"connector":47334}`,
    )
  }
  const result = {}
  for (const name of Object.keys(PORT_DEFAULTS)) {
    if (parsed[name] !== undefined) {
      result[name] = parseProdPort(
        parsed[name],
        `${filePath} ("${name}")`,
      )
    }
  }
  return result
}

export function resolveProdPortConfig(env, file) {
  const pick = (name) => {
    const envValue = env[ENV_KEYS[name]]
    if (envValue !== undefined && envValue !== '') {
      return {
        value: parseProdPort(envValue, ENV_KEYS[name]),
        source: 'env',
      }
    }
    if (file[name] !== undefined) {
      return { value: file[name], source: 'file' }
    }
    return { value: PORT_DEFAULTS[name], source: 'default' }
  }
  return {
    web: pick('web'),
    mcp: pick('mcp'),
    uta: pick('uta'),
    connector: pick('connector'),
  }
}

export async function planProdPorts(
  config,
  options = {},
) {
  const probe = options.probe ?? probeFreePort
  const claim = async (name, choice, probeStart) => {
    if (choice.source === 'default') return probe(probeStart)
    try {
      return await probe(choice.value, choice.value)
    } catch {
      const origin = choice.source === 'env'
        ? ENV_KEYS[name]
        : 'data/config/ports.json'
      throw new Error(
        `[guardian/prod] port ${choice.value} (${name}, from ${origin}) is already in use — free it or configure another port`,
      )
    }
  }

  const web = await claim('web', config.web, PORT_DEFAULTS.web)
  const mcp = await claim('mcp', config.mcp, web + 1)
  const uta = options.skipUta
    ? config.uta.value
    : await claim(
        'uta',
        config.uta,
        Math.max(PORT_DEFAULTS.uta, mcp + 1),
      )
  const connector = options.skipConnector
    ? config.connector.value
    : await claim(
        'connector',
        config.connector,
        Math.max(PORT_DEFAULTS.connector, uta + 1),
      )
  return { web, mcp, uta, connector }
}

async function probeFreePort(start, max = 65_535) {
  for (let port = start; port <= max; port += 1) {
    if (await canListen(port)) return port
  }
  throw new Error(
    `[guardian/prod] no free loopback port available from ${start} to ${max}`,
  )
}

function canListen(port) {
  return new Promise((resolveResult) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolveResult(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolveResult(true))
    })
  })
}
