#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  areaSuiteNames,
  areaSuites,
  areasForTestFile,
  assertLivePaperAcknowledgement,
  collectWorkspacePackages,
  laneSuiteNames,
  laneSuites,
  lanesForTestFile,
  ownerSuiteNames,
  ownerSuites,
  ownersForTestFile,
  selectTestFiles,
  systemCommandSuites,
} from './test-lanes.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

function fail(message) {
  console.error(`[test-select] ${message}`)
  process.exit(2)
}

function addValues(target, value, option) {
  if (!value) fail(`${option} requires a value`)
  const values = value.split(',').map((part) => part.trim()).filter(Boolean)
  if (values.length === 0) fail(`${option} requires a value`)
  target.push(...values)
}

function takeValue(argv, index, option) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) fail(`${option} requires a value`)
  return value
}

function parseArgs(argv) {
  const options = {
    lanes: [],
    owners: [],
    areas: [],
    packages: [],
    paths: [],
    changed: null,
    list: false,
    explain: false,
    json: false,
    help: false,
    forward: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      options.forward.push(...argv.slice(index + 1))
      break
    }
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--list') options.list = true
    else if (arg === '--explain') options.explain = true
    else if (arg === '--json') options.json = true
    else if (arg === '--changed') {
      const next = argv[index + 1]
      if (next && !next.startsWith('--')) {
        options.changed = next
        index += 1
      } else {
        options.changed = 'origin/dev'
      }
    } else if (arg.startsWith('--changed=')) {
      options.changed = arg.slice('--changed='.length) || 'origin/dev'
    } else if (arg.startsWith('--lane=')) addValues(options.lanes, arg.slice('--lane='.length), '--lane')
    else if (arg === '--lane') {
      addValues(options.lanes, takeValue(argv, index, arg), arg)
      index += 1
    } else if (arg.startsWith('--owner=')) addValues(options.owners, arg.slice('--owner='.length), '--owner')
    else if (arg === '--owner') {
      addValues(options.owners, takeValue(argv, index, arg), arg)
      index += 1
    } else if (arg.startsWith('--area=')) addValues(options.areas, arg.slice('--area='.length), '--area')
    else if (arg === '--area') {
      addValues(options.areas, takeValue(argv, index, arg), arg)
      index += 1
    } else if (arg.startsWith('--package=')) addValues(options.packages, arg.slice('--package='.length), '--package')
    else if (arg === '--package') {
      addValues(options.packages, takeValue(argv, index, arg), arg)
      index += 1
    } else if (arg.startsWith('--path=')) addValues(options.paths, arg.slice('--path='.length), '--path')
    else if (arg === '--path') {
      addValues(options.paths, takeValue(argv, index, arg), arg)
      index += 1
    } else {
      fail(`unknown option: ${arg}`)
    }
  }

  if (options.lanes.length === 0) options.lanes.push('hermetic')
  for (const key of ['lanes', 'owners', 'areas', 'packages', 'paths']) {
    options[key] = [...new Set(options[key])]
  }
  return options
}

function printHelp() {
  console.log(`OpenAlice test selector

Usage:
  pnpm test:select [selectors] [mode] [-- <vitest args>]

Selectors (repeatable; comma-separated values also work):
  --lane <name>       ${laneSuiteNames.join(', ')}
  --owner <name>      ${ownerSuiteNames.join(', ')}
  --area <name>       ${areaSuiteNames.join(', ')}
  --package <name>    workspace package name
  --path <path|glob>  repo-relative test path, directory, or glob
  --changed [base]    intersect through Vitest's changed import graph (default: origin/dev)

Values in one dimension are ORed; different dimensions are ANDed. The default
lane is hermetic. Empty selections fail closed.

Modes (selection only; test modules, credentials, and prerequisites are not probed):
  --list              print candidate files
  --explain           print selection, side effects, prerequisites, and invocation plan
  --json              print the same dry-run plan as JSON

Lane boundaries:`)
  for (const [name, lane] of Object.entries(laneSuites)) {
    console.log(`  ${name.padEnd(18)} ${lane.description}`)
    console.log(`  ${''.padEnd(18)} side effects: ${lane.sideEffects}`)
    for (const prerequisite of lane.prerequisites) {
      console.log(`  ${''.padEnd(18)} prerequisite: ${prerequisite}`)
    }
  }

  console.log('\nDedicated system commands (not executed by the generic Vitest selector):')
  for (const [name, suite] of Object.entries(systemCommandSuites)) {
    console.log(`  pnpm test:system:${name}`)
    console.log(`    side effects: ${suite.sideEffects}`)
    for (const prerequisite of suite.prerequisites) console.log(`    prerequisite: ${prerequisite}`)
  }

  console.log('\nWorkspace packages:')
  for (const entry of collectWorkspacePackages(repoRoot)) console.log(`  ${entry.name} (${entry.root})`)

  console.log(`
Examples:
  pnpm test:select --owner ui
  pnpm test:select --owner uta --package @traderalice/uta-service
  pnpm test:select --lane integration --area workspace
  pnpm test:select --lane external-readonly --area market-data --explain
  pnpm test:select --owner alice --owner ui --changed origin/dev

Deploy and publish operations are intentionally outside the test selector.`)
}

function sameFiles(left, right) {
  return left.length === right.length && left.every((file, index) => file === right[index])
}

function invocation(lane, project, files, changed, forward) {
  const args = ['run', '--config', laneSuites[lane].config]
  if (project) args.push('--project', project)
  if (changed) args.push('--changed', changed)
  args.push(...files, ...forward)
  return {
    lane,
    project,
    files,
    args,
    argumentCharacters: args.reduce((total, value) => total + value.length + 1, 0),
  }
}

function createInvocations(options, files) {
  const invocations = []
  for (const lane of options.lanes) {
    const profile = laneSuites[lane]
    if (!profile) fail(`unknown test lane: ${lane}`)
    const laneFiles = files.filter((file) => lanesForTestFile(file).includes(lane))
    if (laneFiles.length === 0) continue
    if (!profile.runnable) continue

    const allLaneFiles = selectTestFiles(repoRoot, { lanes: [lane] })
    if (sameFiles(laneFiles, allLaneFiles)) {
      invocations.push(invocation(lane, null, [], options.changed, options.forward))
      continue
    }

    if (lane !== 'hermetic') {
      invocations.push(invocation(lane, null, laneFiles, options.changed, options.forward))
      continue
    }

    for (const project of ['node', 'ui']) {
      const projectFiles = laneFiles.filter((file) => {
        const owners = ownersForTestFile(file)
        return owners.length === 1 && ownerSuites[owners[0]].project === project
      })
      if (projectFiles.length === 0) continue
      const allProjectFiles = allLaneFiles.filter((file) => {
        const owners = ownersForTestFile(file)
        return owners.length === 1 && ownerSuites[owners[0]].project === project
      })
      invocations.push(invocation(
        lane,
        project,
        sameFiles(projectFiles, allProjectFiles) ? [] : projectFiles,
        options.changed,
        options.forward,
      ))
    }
  }
  return invocations
}

function createPlan(options, files) {
  const selectedLanes = options.lanes.map((name) => ({ name, ...laneSuites[name] }))
  const executionBlockers = []
  if (options.lanes.includes('system')) {
    executionBlockers.push('the system lane is inventory-only; use a dedicated test:system:* command')
  }
  const bybitDiagnostic = 'services/uta/src/domain/trading/__test__/e2e/ccxt-raw-diagnostic.e2e.spec.ts'
  if (files.includes(bybitDiagnostic) && !options.areas.includes('bybit-diagnostic')) {
    executionBlockers.push(
      'the market-buy diagnostic must be selected explicitly with --area bybit-diagnostic',
    )
  }
  return {
    executed: false,
    selectors: {
      lanes: options.lanes,
      owners: options.owners,
      areas: options.areas,
      packages: options.packages,
      paths: options.paths,
      changed: options.changed,
      changedSemantics: options.changed
        ? 'candidate files are intersected at execution by Vitest static import analysis'
        : null,
    },
    candidateCount: files.length,
    lanes: selectedLanes,
    files: files.map((path) => ({
      path,
      lane: lanesForTestFile(path),
      owner: ownersForTestFile(path),
      areas: areasForTestFile(path),
    })),
    invocations: createInvocations(options, files),
    executionBlockers,
    note: 'Dry-run only: no tests ran and no credentials or prerequisites were probed.',
  }
}

function printExplanation(plan) {
  console.log('[test-select] dry-run: no tests ran; credentials and prerequisites were not probed')
  console.log(`[test-select] ${plan.candidateCount} candidate file(s)`)
  for (const lane of plan.lanes) {
    console.log(`\n${lane.name}: ${lane.description}`)
    console.log(`  side effects if run: ${lane.sideEffects}`)
    for (const prerequisite of lane.prerequisites) console.log(`  prerequisite: ${prerequisite}`)
  }
  if (plan.selectors.changed) {
    console.log(`\nchanged since ${plan.selectors.changed}: ${plan.selectors.changedSemantics}`)
  }
  for (const blocker of plan.executionBlockers) {
    console.log(`\nexecution blocker: ${blocker}`)
  }
  for (const candidate of plan.invocations) {
    const project = candidate.project ? ` project=${candidate.project}` : ''
    console.log(`\nwould run lane=${candidate.lane}${project}`)
    console.log(`  vitest ${candidate.args.join(' ')}`)
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  let files
  try {
    files = selectTestFiles(repoRoot, options)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  if (files.length === 0) fail('selection matched zero catalogued tests')

  const ambiguous = files.filter((file) => (
    lanesForTestFile(file).length !== 1 || ownersForTestFile(file).length !== 1
  ))
  if (ambiguous.length > 0) {
    fail(`catalog ownership/lane invariant failed for: ${ambiguous.join(', ')}`)
  }

  const plan = createPlan(options, files)
  if (options.json) {
    console.log(JSON.stringify(plan, null, 2))
    return
  }
  if (options.explain) {
    printExplanation(plan)
    return
  }
  if (options.list) {
    console.log('[test-select] dry-run: no tests ran; credentials and prerequisites were not probed')
    for (const lane of plan.lanes) {
      console.log(`[test-select] ${lane.name} side effects if run: ${lane.sideEffects}`)
    }
    for (const file of plan.files) {
      console.log(`${file.path}\t${file.lane[0]}\t${file.owner[0]}`)
    }
    return
  }

  if (plan.executionBlockers.length > 0) fail(plan.executionBlockers.join('\n'))
  if (options.lanes.includes('live-paper')) {
    try {
      assertLivePaperAcknowledgement()
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  }

  const vitest = resolve(repoRoot, 'node_modules/vitest/vitest.mjs')
  for (const candidate of plan.invocations) {
    const result = spawnSync(process.execPath, [vitest, ...candidate.args], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

main()
