import { appendFile, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REQUIRED_MANIFESTS = ['package.json', 'packages/cli/package.json']
const VERSION_LINE = /^  "version": "([^"]+)",\r?$/gm
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta(?:\.([1-9]\d*))?)?$/
const BETA_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta(?:\.([1-9]\d*))?$/

function result(betaReleasePrep, reason) {
  return { betaReleasePrep, reason }
}

export function parseChangedFiles(output) {
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 2 !== 0) {
    throw new Error('git diff returned an incomplete name-status record')
  }

  const changes = []
  for (let index = 0; index < fields.length; index += 2) {
    changes.push({ status: fields[index], path: fields[index + 1] })
  }
  return changes
}

function versionToken(source) {
  const matches = [...source.matchAll(VERSION_LINE)]
  if (matches.length !== 1) return undefined

  const match = matches[0]
  const value = match[1]
  const valueOffset = match[0].indexOf(value)
  if (match.index === undefined || valueOffset < 0) return undefined

  let parsed
  try {
    parsed = JSON.parse(source)
  } catch {
    return undefined
  }
  if (parsed?.version !== value) return undefined

  return {
    value,
    start: match.index + valueOffset,
    end: match.index + valueOffset + value.length,
  }
}

function replaceVersion(source, token, value) {
  return `${source.slice(0, token.start)}${value}${source.slice(token.end)}`
}

function parseReleaseVersion(value) {
  const match = RELEASE_VERSION.exec(value)
  if (!match) return undefined
  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    beta: value.includes('-beta'),
    betaNumber: match[4] === undefined ? undefined : BigInt(match[4]),
  }
}

function isNewerBeta(baseValue, nextValue) {
  if (!BETA_VERSION.test(nextValue)) return false
  const base = parseReleaseVersion(baseValue)
  const next = parseReleaseVersion(nextValue)
  if (!base || !next?.beta) return false

  for (let index = 0; index < base.core.length; index += 1) {
    if (next.core[index] !== base.core[index]) {
      return next.core[index] > base.core[index]
    }
  }

  if (!base.beta) return false
  if (base.betaNumber === undefined) return next.betaNumber !== undefined
  if (next.betaNumber === undefined) return false
  return next.betaNumber > base.betaNumber
}

export function classifyBetaReleasePrep({
  eventName,
  ref,
  baseRef,
  changes,
  baseManifests,
  headManifests,
}) {
  const isMasterPullRequest = eventName === 'pull_request' && baseRef === 'master'
  if (!isMasterPullRequest) {
    return result(false, 'only master pull requests can use the beta release-preparation fast lane')
  }

  if (
    changes.length !== REQUIRED_MANIFESTS.length ||
    changes.some((change) => change.status !== 'M') ||
    !REQUIRED_MANIFESTS.every((path) => changes.some((change) => change.path === path))
  ) {
    return result(false, 'the complete diff is not exactly the two modified product manifests')
  }

  const baseTokens = {}
  const headTokens = {}
  for (const path of REQUIRED_MANIFESTS) {
    const baseSource = baseManifests[path]
    const headSource = headManifests[path]
    if (typeof baseSource !== 'string' || typeof headSource !== 'string') {
      return result(false, `could not read both revisions of ${path}`)
    }

    const baseToken = versionToken(baseSource)
    const headToken = versionToken(headSource)
    if (!baseToken || !headToken) {
      return result(false, `${path} does not have the expected single top-level version line`)
    }
    if (replaceVersion(headSource, headToken, baseToken.value) !== baseSource) {
      return result(false, `${path} changes bytes outside the top-level version value`)
    }
    baseTokens[path] = baseToken
    headTokens[path] = headToken
  }

  const baseVersion = baseTokens[REQUIRED_MANIFESTS[0]].value
  const nextVersion = headTokens[REQUIRED_MANIFESTS[0]].value
  if (baseTokens[REQUIRED_MANIFESTS[1]].value !== baseVersion) {
    return result(false, 'the base product manifest versions disagree')
  }
  if (headTokens[REQUIRED_MANIFESTS[1]].value !== nextVersion) {
    return result(false, 'the candidate product manifest versions disagree')
  }
  if (!isNewerBeta(baseVersion, nextVersion)) {
    return result(false, `${nextVersion} is not a forward beta version from ${baseVersion}`)
  }

  return result(true, `exact beta release preparation ${baseVersion} -> ${nextVersion}`)
}

function git(args) {
  const completed = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  if (completed.status !== 0) {
    throw new Error(completed.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return completed.stdout
}

export function classifyBetaReleasePrepFromGit({ eventName, ref, baseRef, baseSha, headSha }) {
  if (!/^[a-f0-9]{40}$/i.test(baseSha ?? '') || !/^[a-f0-9]{40}$/i.test(headSha ?? '')) {
    return result(false, 'event did not provide two commit SHAs')
  }
  if (/^0{40}$/.test(baseSha)) {
    return result(false, 'event base SHA is the null revision')
  }

  try {
    git(['merge-base', '--is-ancestor', baseSha, headSha])
    const changes = parseChangedFiles(git([
      'diff', '--name-status', '-z', '--no-renames', baseSha, headSha, '--',
    ]))
    for (const path of REQUIRED_MANIFESTS) {
      for (const revision of [baseSha, headSha]) {
        const treeEntry = git(['ls-tree', revision, '--', path])
        if (!treeEntry.startsWith(`100644 blob `) || !treeEntry.endsWith(`\t${path}\n`)) {
          return result(false, `${path} is not a regular 100644 blob in both revisions`)
        }
      }
    }
    const baseManifests = Object.fromEntries(
      REQUIRED_MANIFESTS.map((path) => [path, git(['show', `${baseSha}:${path}`])]),
    )
    const headManifests = Object.fromEntries(
      REQUIRED_MANIFESTS.map((path) => [path, git(['show', `${headSha}:${path}`])]),
    )
    return classifyBetaReleasePrep({
      eventName,
      ref,
      baseRef,
      changes,
      baseManifests,
      headManifests,
    })
  } catch (error) {
    return result(false, `classifier failed closed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function eventInputs() {
  let event = {}
  if (process.env.GITHUB_EVENT_PATH) {
    try {
      event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
    } catch (error) {
      return {
        error: `could not read GitHub event payload: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  const eventName = process.env.GITHUB_EVENT_NAME ?? ''
  if (eventName === 'pull_request') {
    return {
      eventName,
      ref: process.env.GITHUB_REF ?? '',
      baseRef: event.pull_request?.base?.ref ?? process.env.GITHUB_BASE_REF ?? '',
      baseSha: event.pull_request?.base?.sha ?? '',
      headSha: process.env.GITHUB_SHA ?? event.pull_request?.merge_commit_sha ?? '',
    }
  }
  return {
    eventName,
    ref: process.env.GITHUB_REF ?? '',
    baseRef: process.env.GITHUB_BASE_REF ?? '',
    baseSha: '',
    headSha: process.env.GITHUB_SHA ?? '',
  }
}

async function main() {
  const githubOutputIndex = process.argv.indexOf('--github-output')
  const githubOutput = githubOutputIndex >= 0 ? process.argv[githubOutputIndex + 1] : undefined
  const inputs = await eventInputs()
  const classification = inputs.error
    ? result(false, inputs.error)
    : classifyBetaReleasePrepFromGit(inputs)

  console.log(`beta release preparation: ${classification.betaReleasePrep}`)
  console.log(`reason: ${classification.reason}`)
  if (githubOutput) {
    await appendFile(
      githubOutput,
      `beta_release_prep=${classification.betaReleasePrep}\nreason=${classification.reason.replace(/[\r\n]/g, ' ')}\n`,
    )
  } else {
    console.log(JSON.stringify(classification))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
