# SSH Remote Boundary

**Status:** Active

**Related issues:** None

**Owner guides:** [[docs/remote-access.md]], [[docs/remote-quickstart.md]],
[[docs/docker-deployment.md]], [[docs/cli-installer.md]],
[[docs/local-runtime.md]]

## Objective

Make `openalice remote` a provider-neutral SSH product. The user supplies a
machine that ordinary OpenSSH can reach; OpenAlice may inspect that machine,
install or upgrade OpenAlice there with explicit consent, start or reuse its
Runtime, transfer an AliceProject, and open the local tunnel. OpenAlice does not
provision the host or own the cloud provider, container, service, Volume,
network, or deployment lifecycle that made SSH possible.

This follows the useful boundary in Herdr's remote attach: accept a normal SSH
target, prefer a compatible remote binary, install a matching binary only after
interactive consent, then start or attach the remote server. It deliberately
does not copy Herdr's terminal protocol or turn a provider into product state.

## Scope

- Preserve the existing native SSH probe, plan/apply, release installation,
  Runtime start/reuse, tunnel, Machine registry, and AliceProject transfer.
- Remove Railway-specific product branches, environment contracts, Runtime
  capabilities, lifecycle fencing, image/entrypoint scripts, tests, and docs.
- Restore Guardian, server control, update, rollback, uninstall, version
  identity, and child-environment handling to provider-neutral behavior.
- Keep the generic Docker/server image as a supported way for users to compose
  their own host, without claiming ownership of their orchestrator.
- Update the active distribution and fleet plans so their remaining work does
  not depend on a Railway deployment adapter.
- Update the affected release/runtime skill guidance after repository truth is
  accepted.

## Non-goals

- Creating a VM, cloud service, container, Volume, domain, firewall rule, SSH
  account, key, or provider project.
- Detecting a cloud vendor or changing provider configuration through its API
  or CLI.
- Installing Agent Runtime CLIs; they remain user-owned executables discovered
  from the remote host's `PATH`.
- Background polling, hot deployment, or provider-triggered update automation.
- Preserving an unreleased Railway-specific compatibility profile. Ordinary
  released OpenAlice state and SSH-managed Runtime ownership remain supported.

## Product Contract

1. `ssh <target>` must work before `openalice remote <target>` can do anything.
2. Probe and plan are read-only. An install, upgrade, start, takeover, stop, or
   Project transfer requires its existing explicit authority.
3. A compatible installed OpenAlice Runtime is reused. A missing or mismatched
   Runtime is installed from the invoking CLI's accepted release identity and
   checksum-bound manifest; OpenAlice does not bootstrap Node, Bun, a checkout,
   or an Agent Runtime.
4. Remote files and processes belong to the remote machine and its selected
   `OPENALICE_HOME`. Guardian remains the single-writer authority there.
5. OpenAlice neither knows nor records how the user obtained that machine. A
   bare-metal host, VM, container, or provider instance has the same SSH-facing
   contract.
6. Disconnecting the local tunnel leaves a detached remote Runtime running.
   Provider restarts and persistence are the user's infrastructure concern.

## Ordered Work

- [ ] Record the provider-neutral SSH boundary in the remote and deployment
  owner guides and refresh the Herdr comparison to current public behavior.
- [ ] Delete the Railway image, entrypoint, shell wrapper, preflight utility,
  dedicated Vitest config, and Railway-only system lane.
- [ ] Remove Railway deployment authority from remote probe/plan/apply while
  retaining ordinary managed SSH installation and Runtime lifecycle.
- [ ] Remove Railway service-manager guards from update, rollback, uninstall,
  version identity, and CLI capability reporting.
- [ ] Remove the inherited Railway fence protocol from Guardian, CLI lifecycle,
  server control, production launcher, service entrypoints, and Workspace child
  environment handling without weakening normal same-machine ownership.
- [ ] Delete or rewrite Railway-only tests; retain focused coverage for normal
  Runtime ownership, SSH planning, installer identity, and hostile environment
  stripping.
- [ ] Reconcile active plans, test-lane documentation, workflow contracts, and
  local release/runtime skill guidance with the new boundary.
- [ ] Run the full verification matrix and inspect the resulting Draft PR as one
  coherent provider-boundary change.

## Verification

```bash
npx tsc --noEmit
pnpm -F @traderalice/cli typecheck
pnpm -F @traderalice/guardian-runtime typecheck
pnpm test
pnpm test:system:remote
pnpm test:system:installer
pnpm docker:smoke
bash ~/.codex/skills/openalice-guardian-recovery/scripts/run-checks.sh "$PWD" full
pnpm build
rg -n -i 'railway' --glob '!plans/ssh-remote-boundary.md' .
```

The final search must find no active product code, test, workflow, image,
script, documentation, or skill contract that treats Railway as an OpenAlice
deployment mode. Historical Git commits and external issue/PR records are not
rewritten.

## Completion Criteria

- `openalice remote` works only from ordinary SSH facts and still installs,
  upgrades, starts/reuses, and tunnels a compatible native remote Runtime.
- No OpenAlice-owned cloud-provider or Railway lifecycle abstraction remains.
- Guardian's ordinary lease, takeover, stale-owner, and process-tree recovery
  matrix still passes.
- The generic Docker image and SSH smoke demonstrate a user-composed remote
  host without provider-specific behavior.
- Documentation and local skills state the same ownership boundary.
- The focused branch is published as one labeled Draft PR to `dev` for
  maintainer acceptance; it is not autonomously merged.
