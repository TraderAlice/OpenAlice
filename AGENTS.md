# OpenAlice

OpenAlice is a local trading workspace for native coding-agent CLIs. The main
process is a Workspace launcher and trading-context injector; broker credentials,
connections, and trading state belong to the separate UTA process. Persisted
state is file-backed rather than database-backed.

Keep this file short. It contains rules that apply to every task. Detailed
architecture and operating procedures live in the owner guides linked below.
Current code, tests, rendered behavior, and GitHub state override stale prose.

## Start Here

```bash
pnpm install              # full local install, including Electron
pnpm dev                  # Guardian -> UTA + Alice + Vite
pnpm dev --takeover       # replace the recorded local Guardian owner tree
pnpm build                # packages + UI + UTA + Alice
pnpm test                 # monorepo Vitest suite
pnpm test:e2e             # non-trading product/integration E2E
```

Before changing files:

1. Run `git fetch origin`, `git status -sb`, and inspect the current diff.
2. Preserve unrelated user changes. Do not reset, overwrite, stash, or commit
   them merely to obtain a clean tree.
3. Routine work starts from current `dev` on a focused feature branch. If the
   checkout is on `master`, a merged branch, or a surprising historical branch,
   stop and establish the intended base before editing.
4. Start from the real surface: reproduce UI/runtime behavior, inspect the
   relevant current code, and read the applicable owner guide before designing.

## Product and Architecture Boundaries

- `src/` is Alice: Workspace lifecycle, tools, data domains, HTTP/IPC surfaces,
  file-backed state, and the UTA client boundary.
- `services/uta/` owns broker implementations, accounts, approvals, snapshots,
  FX, and every trading write. Do not move broker state back into Alice.
- The model loop runs in native CLIs (`claude`, `codex`, `opencode`, `pi`).
  Alice owns credentials and injection, not an in-process chat-agent loop.
- New agent-facing capabilities normally ship as Workspace templates, skills,
  or satellite repositories. Do not grow a parallel workflow engine in `src/`.
- UTA is optional for non-trading use. Startup, onboarding, and Chat must remain
  usable in lite/read-only mode when no broker carrier is available.
- Chat workspaces are durable and reusable by default. Auto-Quant workspaces are
  isolated/ephemeral by design; do not apply one lifecycle policy to both.
- `OPENALICE_HOME` is the user-state root. Changes to persisted state must use
  the migration framework; never hide one-off cleanup in startup code.
- Secrets never belong in tracked files, logs, fixtures, PR bodies, or agent
  instructions. Treat account, auth, provider, and sealing paths as sensitive.

See [[docs/project-structure.md]] ([Project structure](docs/project-structure.md))
for current ownership and entry points.

## Delivery and Branch Policy

- `dev` is the integration lane. Routine PRs target `dev`.
- `master` is the stable/user-facing lane. Only human-directed promotions from
  `dev` and explicit emergency hotfixes target `master`.
- Do not commit directly to `master`. Avoid direct commits to `dev` unless the
  maintainer explicitly requests integration work.
- Never force-push or delete `master` or `dev`.
- Feature branches are disposable execution lanes. Keep them while work is
  unmerged; delete them after GitHub records a successful merge.
- Prefer merge commits for ordinary PRs so intentional commit history survives.
  Squash only when the user asks or the branch history is genuinely disposable.
- The remote `local` branch is a legacy collaboration lane, not the default
  workflow. Do not use or delete it without first auditing its unmerged state.

Choose delivery authority before implementation:

| Mode | Trigger | Delivery to `dev` |
|---|---|---|
| Serial / interactive | Default: the user is actively requesting and steering concrete work | After proportional local verification, open and merge the PR without waiting for pending remote CI; delete the feature branch and return to updated `dev` unless the user says to pause |
| Parallel / contribution | Explicit `/goal` or direct request to autonomously find and contribute improvements | Leave each PR open for later review, return to `dev`, and continue from a fresh branch |

A later interactive message does not retroactively authorize merging a parallel
PR queue. Parallel work is already non-blocking because opening a PR does not
pause the next contribution. In serial work the PR exists to durably integrate
each completed increment into `dev`, so pending CI must not turn it into a
synchronous lock. Before publishing the next serial increment, inspect the
previous increment's PR checks and post-merge `dev` run. A known failure blocks
further stacking until repaired; a still-pending run does not by itself block
serial work. `master` promotions, releases, explicit review pauses, and
untrusted contributions keep their full synchronous gates. Detailed branch,
PR, promotion, hotfix, and external-contribution procedures live in
[[docs/development-workflow.md]]
([Development workflow](docs/development-workflow.md)).

## Verification

For code changes, always run:

```bash
npx tsc --noEmit
pnpm test
```

Add checks according to the touched surface:

| Surface | Required extra verification |
|---|---|
| `ui/` | `cd ui && npx tsc -b`; verify the real route in browser/dev |
| UI `/api/*` contract or demo surface | Update `ui/src/demo/` handlers and walk `pnpm -F open-alice-ui dev:demo` |
| `packages/<name>/` | `pnpm -F @traderalice/<name> typecheck` |
| UTA state machine, ledger, staging, or sync logic | `pnpm test:e2e` for the MockBroker lifecycle, plus the targeted unit specs listed in [UTA live testing](docs/uta-live-testing.md) |
| Broker adapter, order writes, or UTA permissions | Choose the smallest live-paper scenario from [UTA live testing](docs/uta-live-testing.md); verify the configured account is demo/paper first and leave it flat |
| Workspace issues, schedules, headless dispatch | Follow [Workspace issues and scheduling](docs/workspace-issues-and-scheduling.md) |
| Guardian locks, process ownership, takeover | `pnpm test:guardian-recovery`; exercise the real launcher path |
| Desktop, IPC, PTY, managed Pi, shell, packaging | Follow [Managed Workspace runtime](docs/managed-workspace-runtime.md) and run the matching Electron/package smoke |
| Root installer or distributed CLI payload | Follow [CLI installer](docs/cli-installer.md) and run `pnpm test:install:docker`; manually walk the interactive playground before release |
| Docker/server image, Compose, remote deployment | Follow [Docker deployment](docs/docker-deployment.md) and run `pnpm docker:smoke`; before release, opt into the credentialed agent/CLI check documented there |
| Persisted data shape | Add an idempotent migration + spec, register it, then run `pnpm build:migration-index` |
| Onboarding/first run/auth | Use isolated data; exercise dev and packaged onboarding paths where relevant |

`pnpm test:e2e` is non-trading: it must never load configured broker accounts
or submit orders. Live-paper acceptance is a separate, explicit lane:
`OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper`. Never run that lane as
routine CI or against real-money accounts. Inspect the account mode and the
pre-test positions/orders before acknowledging it, then verify the account is
flat after the run even when a test fails. Do not call a change verified when
the surface-specific path was skipped; state the remaining gap.

For local package verification, prefer `pnpm electron:smoke:workspace`: it owns
an isolated package output and removes that large expanded app after the smoke
exits. Use `pnpm electron:pack` only when a persistent artifact is actually
needed. A package passed through `--skip-pack` is externally owned and must
never be deleted by the smoke runner; use `--keep-package` to preserve a
temporary smoke package for investigation.

Code signing and notarization are release gates, not routine development
checks. Serial/parallel `dev` work, ordinary PR package smokes, and local
packaged-runtime debugging must build unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
and must not read release signing secrets. Run a real signed/notarized build
only for a versioned release candidate, an explicit release rehearsal, or a
change whose subject is the signing/notarization/update chain. State that
release-only residual risk instead of making every development iteration pay
the signing cost.

When optimizing CI/CD, preserve the lane boundaries above. First remove
duplicate jobs, cancel superseded runs, narrow path triggers, reuse caches and
unsigned build artifacts, and measure the slow step before considering larger
runners. Do not trade away the full `master` promotion/release gates merely to
make routine `dev` feedback look faster.

## Deferred Work and Issues

Use GitHub issues for concrete deferred findings. Do not create repo TODO files
or route new work to Linear.

An actionable issue includes:

- symptom and reproduction evidence;
- suspected files or subsystem;
- why it is deferred;
- related PRs, commits, logs, or screenshots.

Handle in-scope findings in the current PR instead of filing an issue for work
the same change already owns. Product-roadmap ideas still belong to the user's
planning surface rather than being silently converted into engineering tasks.

## Owner Guides

Read the relevant guide before editing its subsystem:

- [[docs/README.md]] — [Owner-guide index](docs/README.md) and maintenance rules.
- [[docs/project-structure.md]] — [Project structure](docs/project-structure.md): process boundaries,
  directories, state roots, and architectural ownership.
- [[docs/development-workflow.md]] — [Development workflow](docs/development-workflow.md): branches, PRs,
  delivery modes, promotions, external contributions, and risk gates.
- [[docs/managed-workspace-runtime.md]] — [Managed Workspace runtime](docs/managed-workspace-runtime.md): Electron
  packaging, managed Pi, PortableGit/Bash, runtime profiles, and Workspace PATH.
- [[docs/broker-packs.md]] — [Broker Packs](docs/broker-packs.md): optional broker SDK
  packaging, UI installation, activation, runtime loading, and release assets.
- [[docs/cli-installer.md]] — [CLI installer](docs/cli-installer.md): consent, installed layout,
  atomic updates, PATH integration, installer tests, and release checks.
- [[docs/local-runtime.md]] — [Local Runtime and CLI bootstrap](docs/local-runtime.md): source-backed
  localhost startup, dependency bootstrap, Runtime ownership, and the headless bundle boundary.
- [[docs/data-locations.md]] — [Data locations](docs/data-locations.md): complete-home selection,
  desktop launcher preferences, concurrent instances, and directory safety.
- [[docs/docker-deployment.md]] — [Docker deployment](docs/docker-deployment.md): server image topology,
  remote-host safety, persistence, health, and container acceptance.
- [[docs/remote-access.md]] — [Remote access](docs/remote-access.md): SSH tunnel experiment,
  local/remote ownership, and staged remote-control boundaries.
- [[docs/connector-service.md]] — [Connector Service](docs/connector-service.md): optional external Inbox
  notification adapters, sealed credentials, health, and Guardian lifecycle.
- [[docs/ui-interaction-and-motion.md]] — [UI interaction and motion](docs/ui-interaction-and-motion.md):
  clickable affordances, shared motion primitives, and reduced-motion policy.
- [[docs/workspace-agent-guidance.md]] — [Workspace agent guidance](docs/workspace-agent-guidance.md): prompt
  layers, skill ownership, live CLI authority, and guidance versioning.
- [[docs/workspace-lifecycle.md]] — [Workspace and Session lifecycle](docs/workspace-lifecycle.md): offboarding,
  departed desks, handoff, restore/purge, and resumeId retirement.
- [[docs/workspace-template-upgrade.md]] — [Workspace Template Upgrade](docs/workspace-template-upgrade.md):
  managed-asset baselines, three-way review, safe apply, recovery, and the future Merge/Absorb boundary.
- [[docs/workspace-absorb.md]] — [Workspace Absorb](docs/workspace-absorb.md): directional
  Workspace consolidation, file collisions, archived source identity, and recovery.
- [[docs/uta-live-testing.md]] — [UTA live testing](docs/uta-live-testing.md): broker/trading acceptance loops.
- [[docs/workspace-issues-and-scheduling.md]] — [Workspace issues and scheduling](docs/workspace-issues-and-scheduling.md): Issue board, schedules, headless runs, and Inbox delivery.
- [[docs/conversation-provenance.md]] — [Workspace Session and artifact provenance](docs/conversation-provenance.md): `resumeId` identity, artifact trails, Issue responsibility, and the provenance-before-collaboration delivery order.
- [[docs/event-system.md]] — [Event-system retirement note](docs/event-system.md): removed Alice event-bus scheduler; UTA journal utility only.
- [[docs/market-data-architecture.md]] — [Market data architecture](docs/market-data-architecture.md): TraderHub, K-line providers, and the private compatibility package.
- `src/migrations/INDEX.md` — generated migration inventory and affected paths.

`README.md` is public product positioning. After a genuinely large product
shift, identify stale sections, but ask the user for framing before rewriting
the tagline, pillars, or other marketing copy.

## Code Conventions

- ESM only; include `.js` extensions in TypeScript imports.
- Strict TypeScript, ES2023 target.
- Zod for config schemas; TypeBox for tool parameter schemas.
- `decimal.js` for financial arithmetic.
- Prefer structured Workspace launcher logs; the main process currently uses
  `console` and does not have a universal pino sink.
