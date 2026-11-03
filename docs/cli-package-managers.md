# CLI Package-manager Channels

This guide owns npm, Bun, Homebrew, and Arch/AUR distribution of the native
OpenAlice CLI. The accepted native archive and direct installer remain owned
by [[docs/cli-installer.md]]; runtime lifecycle by [[docs/cli-supervisor.md]]
and [[docs/local-runtime.md]]. Native targets: macOS, glibc Linux, and
Windows on arm64/x64. The seven-package stable npm channel (meta package
declaring all six platform dependencies, including Windows) is active;
Windows packages have completed first publication and Trusted Publisher
enrollment. Homebrew is activated via `TraderAlice/homebrew-tap`; AUR still
requires separate external activation.

## User commands

```bash
npm install -g openalice --allow-scripts=openalice
bun add -g --trust openalice
brew install traderalice/tap/openalice
paru -S openalice-bin
```

npm 12 requires explicit installation-script approval (`--allow-scripts`
scopes it to this package's materialization step); Bun's `--trust`
authorizes the meta package to select its already-published platform
package. Neither grants permission to install an Agent Runtime or system
dependency. After install, `openalice` is the accepted native executable —
not a JS wrapper, and it needs no Node/Bun/npm in `PATH` at Runtime.

Dependency coordination: new releases declare `dependencyPolicy: system` and
contain no Git/Bash or Agent Runtimes. First local startup continues the
shared Git/Bash setup (working installs reused; missing ones need explicit
consent; noninteractive startup reports how to finish). `openalice setup`
retries; `--check` only inspects. Homebrew declares `git`/`bash`; AUR
declares `glibc`/`git`/`bash`. Agent Runtimes are never implicit
dependencies.

## One accepted artifact set

The release build produces six archives
(`openalice-cli-<version>-<darwin|linux|win32>-<arm64|x64>.tar.gz`). Every
channel consumes those exact bytes and SHA-256 values; package-manager
generation validates archive name, sidecar checksum, layout, `release.json`,
target, version, pinned Bun version, and content identity first. Homebrew
and AUR reference the GitHub Release archives directly; npm platform packages
contain the exact extracted payload without rebuilding.

## npm and Bun topology

`openalice` (meta) plus six optional platform packages
(`openalice-{darwin,linux,windows}-{arm64,x64}`). The meta package's
JavaScript postinstall (npm's Node, or pinned Bun 1.4 without host Node)
selects the host package, hard-links/copies the executable (materialized as
`bin/openalice.exe` on every host so npm's Windows shim needs neither Node
nor shell; the placeholder has no shebang because npm creates shims before
postinstall; Windows resources use a junction without admin rights), links
immutable resources, records provenance, and verifies `--version`. No
network or package-manager fallback: a missing platform package is an
installation failure. Publish order is strict — all six platform packages
before the meta package. Package-manager channels are stable-only: a beta
release accepts direct npm/Bun mechanics but generates no
registry/Tap/AUR publication inputs.

## Homebrew and AUR topology

The public tap's `Sync stable formula` workflow checks hourly (minute 23) or
by manual dispatch, waits for matching GitHub/CDN stable versions, verifies
the formula asset digest and all archive hashes/sidecars, then commits only
the formula with the tap's own `GITHUB_TOKEN`; an unchanged version commits
nothing. It never builds the product and needs no cross-repository token
(GitHub may disable schedules after 60 idle days — maintainers can re-run
it). Keep `OPENALICE_PUBLISH_HOMEBREW` disabled in OpenAlice: the push-based
writer is an alternative, not a second active writer. Stable release
acceptance should include the tap sync receipt. Beta/dev never update the
formula. The generated `openalice-bin` `PKGBUILD`/`.SRCINFO` select the
Linux archive for `aarch64`/`x86_64` and install under `/usr/bin` and
`/usr/share/openalice` (`paru` is an AUR client; OpenAlice does not manage
it).

## Public channel activation

For every non-prerelease, the release workflow downloads all six archives
anonymously from their final public URLs, verifies bytes and sidecars
against the channel manifest, then compares the public formula, `PKGBUILD`,
`openalice-bin.SRCINFO` (the public asset is the byte-for-byte copy
installed as `.SRCINFO`), and npm publish order against preserved inputs. A
30-day verification receipt is retained; npm, Tap, and AUR publication all
depend on it — none can publish from a private artifact alone.

External channels are explicit switches:

| Channel | Repository variable | Required authority |
|---|---|---|
| npm + Bun | `OPENALICE_PUBLISH_NPM=true` | npm Trusted Publishing (OIDC) for all seven names, bound to `TraderAlice/OpenAlice` / `release.yml` |
| Homebrew (alternative push writer; disabled for our tap) | `OPENALICE_PUBLISH_HOMEBREW=true` | `HOMEBREW_TAP_TOKEN` with push access to the tap |
| AUR / paru | `OPENALICE_PUBLISH_AUR=true` | dedicated `AUR_SSH_PRIVATE_KEY` plus manually verified `AUR_KNOWN_HOSTS` |

Preflight runs before a stable GitHub Release can be created: npm exchanges
a GitHub OIDC identity for short-lived package-scoped credentials per name
(missing or mismatched trusted publishers fail; no token fallback); the
Homebrew token must have push authority; the AUR key plus pinned known-hosts
must read the `openalice-bin` Git repository. Disabled channels perform no
authority checks — missing credentials become release-planning failures,
not post-publication surprises. The `Public CLI Channel Authority` workflow
rehearses Homebrew/AUR without publishing; npm rehearsal is
`gh workflow run release.yml --ref dev -f operation=verify-npm` (must run in
`release.yml` because npm validates that workflow identity; it proves the
OIDC exchange, not upload acceptance).

Writers are idempotent: npm verifies each tarball against the publish
manifest, skips an already-public identical version, and keeps the meta
package last (a partial first publication is safe to retry); Tap and AUR
commit nothing when verified metadata is already active; AUR never learns
its host key from the publishing connection. Creating registry packages, the
Tap, and the AUR key enrollment remain deliberate maintainer actions. First
npm publication or retry without rebuilding: dispatch `Release` with
`operation=publish-npm`, `channel=stable`, the current stable tag (accepts
only GitHub's non-prerelease latest whose tag is on `master` and whose
manifests agree; no build/signing/version/CDN/Homebrew/AUR job runs).

Trusted Publisher configuration per package name: org `TraderAlice`,
repository `OpenAlice`, workflow filename `release.yml` (not its path),
allow `npm publish`, environment empty. Publication runs on GitHub-hosted
Ubuntu with `id-token: write` and pinned npm in an isolated runner prefix
(do not globally replace the executing npm tree); no `NPM_TOKEN`/
`NODE_AUTH_TOKEN` is configured. Packages must retain the
`TraderAlice/OpenAlice` repository URL; provenance is not itself proof of
OIDC authentication. Adding future platform packages requires first
publication and their own trusted-publisher connections. See
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

## Update and uninstall ownership

The installer that owns the visible command owns later file mutation:

| Method | Update | Uninstall |
|---|---|---|
| npm | `npm install -g openalice@latest --allow-scripts=openalice` | `npm uninstall -g openalice` |
| Bun | `bun add -g --trust openalice@latest` | `bun remove -g openalice` |
| Homebrew | `brew upgrade traderalice/tap/openalice` | `brew uninstall traderalice/tap/openalice` |
| AUR | `paru -S openalice-bin` | `paru -Rns openalice-bin` |

`openalice update`, Doctor, and `openalice uninstall` read schema 3
provenance, report the owning-manager command, and never overwrite or remove
manager-owned files; the Supervisor TUI cannot apply a direct installer over
a package-manager prefix (channel switching requires an explicit direct
install). Stop the Runtime (`openalice down`) before changing versions; a
running Guardian keeps its mapped executable. If the manager replaces the
package while an older Guardian runs, `status`/`up` report the new version
as pending activation; OpenAlice never rolls back manager files. Uninstall
removes installation files only — data, AliceProjects, credentials, and
user-owned Agent Runtimes stay. Known Windows Bun limitation: removal can
leave a global `openalice.exe` entry (OpenAlice #1347 / Bun #11970);
acceptance reports the residue explicitly rather than deleting Bun-owned
files.

## Release acceptance

```bash
pnpm exec vitest run \
  tests/integration/cli-release-artifacts/cli-release-fixture.spec.mjs \
  tests/integration/cli-release-artifacts/build-cli-package-channels.spec.mjs \
  scripts/pack-cli-npm-packages.spec.mjs \
  scripts/release-workflow.spec.ts \
  packages/cli/src/package-manager.spec.mjs
```

A `dev` push stays on the preview lane (six artifacts, sidecar/metadata
validation, live channel smoke); Windows install/update/rollback and
command-shim acceptance is separately replayable and mandatory for stable.
Stable acceptance installs the formula on native macOS arm64/Intel and Linux
arm64/x64 Homebrew images, and builds/installs `openalice-bin` on native
Linux x64 plus arm64 (pinned official Arch image; arm64 uses a pinned
Arch Linux ARM image built from signature-checked upstream repos). Each
smoke uses an isolated home, exercises a stopped upgrade/removal, then
replaces a synthetic prior candidate through the manager while Guardian is
active — the new command must report pending activation, preserve it through
idempotent `up`, route Doctor/update/uninstall back to the manager, and
activate only after `down` plus fresh `up`. Fixtures rewrite only isolated
copies of an accepted candidate (never publication inputs) with isolated
state and no broker credentials. Homebrew/AUR fixture generation uses
`--system-only` (four POSIX archives, no npm payload); full public channel
generation stays six-platform. The release job derives every channel only
after all native candidates pass and publishes the npm meta package last.
