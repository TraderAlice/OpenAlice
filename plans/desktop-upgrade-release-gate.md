# Desktop Upgrade Release Gate

Status: Complete

Related issues: none

Owner guides:

- [[../docs/managed-workspace-runtime.md]]
- [[../docs/development-workflow.md]]

## Scope

Turn desktop upgrade compatibility into a release-blocking journey instead of
inferring it from fresh-package startup. The gate uses the previous public
desktop release to create isolated real state, opens that same state with the
candidate, verifies preserved identity and new writes, restarts the candidate,
and records a structured receipt on macOS Apple Silicon, macOS Intel, and
Windows.

The release lane additionally runs the journey from the final candidate
ZIP/EXE and verifies that update metadata names real assets whose size and
SHA-512 match. It does not publish a temporary feed or mutate the public CDN.

## Decisions

- N-1 means the newest published tag whose product version differs from the
  checked-out candidate; release jobs pass their already-resolved previous tag
  explicitly.
- Previous apps and candidate apps share only an isolated `OPENALICE_HOME`,
  Workspace root, global provider root, and Electron user-data directory.
  Tests never read the maintainer's normal data.
- The previous renderer is driven through a loopback DevTools port to create a
  real Chat Workspace and browser-state sentinel without adding a permanent
  production-only smoke API.
- PR package smoke reuses the unpacked candidate for fast forward-compatibility
  evidence. Release smoke uses the final macOS ZIP or Windows NSIS installer so
  publication is blocked on the shipped bytes.
- Windows installs N-1 and the candidate into the same isolated installation
  directory. macOS expands the immutable N-1 and candidate ZIPs separately;
  native ShipIt replacement remains covered by updater contract tests and the
  signed release rehearsal boundary.
- Update metadata validation is offline and byte-exact: version, referenced
  file, declared size, SHA-512, and blockmap must all agree before upload.

## Work

- [x] Add the cross-platform N-1 desktop upgrade runner and focused tests.
- [x] Add byte-exact candidate update-metadata verification and tests.
- [x] Wire upgrade receipts into Desktop Package Smoke on all native hosts.
- [x] Make final-artifact upgrade and feed verification block release
  publication.
- [x] Document the PR, release, isolation, and residual native-handoff gates.
- [x] Run TypeScript, unit, package, and local macOS N-1 upgrade verification.

## Verification

- `npx tsc --noEmit`
- `pnpm test`
- targeted upgrade-planner, DevTools, and update-asset specs
- `pnpm electron:smoke:upgrade -- --from v0.87.0-beta --candidate-package-root <isolated-package>`
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

The current host can prove the Apple Silicon journey locally. Intel macOS,
Windows NSIS, signing, and notarization remain native CI/release gates.

Completed locally with 3,868 passing monorepo tests, both TypeScript checks, an
unsigned packaged Workspace acceptance, and a real `v0.87.0-beta` to
`0.88.0-beta` Apple Silicon journey whose eleven receipt checks all passed.

## Completion

The plan is complete when every desktop package job preserves a structured N-1
upgrade receipt, every release platform repeats the journey against final
candidate bytes, invalid updater metadata blocks publication, owner guides
describe the confidence boundary, and proportional local verification passes.
