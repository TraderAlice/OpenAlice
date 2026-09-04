# CLI Package-manager Channels

This guide owns npm, Bun, Homebrew, and Arch/AUR distribution of the native
OpenAlice CLI. The accepted native archive and direct Bash installer remain
owned by [[docs/cli-installer.md]]. Runtime lifecycle after installation remains
owned by [[docs/cli-supervisor.md]] and [[docs/local-runtime.md]].

The native target set is macOS, glibc Linux, and Windows on arm64 and x64.
Windows direct installation lives in [[docs/cli-installer.md]]. Generated Windows
packages are not public npm packages: first publication and Trusted Publisher
enrollment remain required external activation steps.

Public npm activation: `openalice` and its four platform packages were first
published as `0.90.2` on 2026-09-04 under maintainer `jiaran258`. The registry
integrities and a fresh npm 12 installation/start/stop were independently
verified after [publication](https://github.com/TraderAlice/OpenAlice/actions/runs/33860369715).
Homebrew was activated at `0.90.2` on 2026-09-04 in
[`TraderAlice/homebrew-tap`](https://github.com/TraderAlice/homebrew-tap).
The first [sync](https://github.com/TraderAlice/homebrew-tap/actions/runs/33889442153)
verified all four public archives and committed the unchanged formula using
the tap's built-in token. A fresh public macOS ARM64 Homebrew installation and
isolated Runtime startup/stop/removal passed; no new product version was made.
AUR still requires separate external activation. Package metadata in a GitHub
Release alone does not make a channel available.

## User commands

Stable package-manager installs use:

```bash
npm install -g openalice --allow-scripts=openalice
bun add -g --trust openalice
brew install traderalice/tap/openalice
paru -S openalice-bin
```

npm 12 requires explicit installation-script approval; `--allow-scripts=openalice`
allows only this package's materialization step. Bun likewise does not run
dependency lifecycle scripts by default. `--trust` is the
explicit Bun authorization that lets the small `openalice` meta package select
and materialize its already-published native platform package. It does not give
OpenAlice permission to install an Agent Runtime or another system dependency.

After npm or Bun installation, `openalice` is the accepted native executable.
It is not a JavaScript forwarding wrapper and does not require Node.js, Bun, npm,
or the installing package manager in `PATH` at Runtime.

## One accepted artifact set

The release build produces six archives:

```text
openalice-cli-<version>-darwin-arm64.tar.gz
openalice-cli-<version>-darwin-x64.tar.gz
openalice-cli-<version>-linux-arm64.tar.gz
openalice-cli-<version>-linux-x64.tar.gz
openalice-cli-<version>-win32-arm64.tar.gz
openalice-cli-<version>-win32-x64.tar.gz
```

Every channel consumes those exact accepted archive bytes and SHA-256 values.
Package-manager generation validates the archive name, sidecar checksum, safe
top-level layout, `release.json`, target, version, pinned Bun version, and
content identity before producing channel metadata. Homebrew and AUR reference
the GitHub Release archives directly. npm platform packages contain the exact
extracted release payload without rebuilding or modifying the executable.

## npm and Bun topology

The registry topology follows the platform-package pattern used by native CLIs:

```text
openalice
├── optional openalice-darwin-arm64
├── optional openalice-darwin-x64
├── optional openalice-linux-arm64
├── optional openalice-linux-x64
├── optional openalice-win32-arm64
└── optional openalice-win32-x64
```

The meta package exposes the `openalice` command. Its postinstall step selects
the package matching the host OS and CPU, hard-links or copies the native
executable, links immutable resources, records provenance, and verifies
`openalice --version`. It has no network or package-manager fallback. A missing
platform package is an installation failure, not permission to download
unreviewed bytes.

The meta package uses a JavaScript postinstall entry: npm uses its Node, while
pinned Bun 1.4 also executes it without a host Node. The private materialized
binary is `bin/openalice.exe` on every host so npm's Windows command shim needs
neither Node nor Shell at runtime. POSIX links still expose `openalice`. The
placeholder must have no interpreter shebang: npm creates Windows shims before
postinstall. Windows resources use a directory junction without admin rights.
Homebrew and AUR exclude Windows targets.

Release packaging records a strict publish order. All six platform packages
must publish successfully before the `openalice` meta package is published.
Stable npm publication is disabled unless the repository explicitly enables
`OPENALICE_PUBLISH_NPM` and provides npm publishing authority.

Package-manager channels are stable-only in this release model. A beta release
still accepts direct npm/Bun installation mechanics against its candidate
archives, but it does not generate or attach registry/Tap/AUR publication
inputs and cannot mutate any of those public package channels.

## Homebrew and AUR topology

The public `TraderAlice/homebrew-tap` consumes the unchanged `openalice.rb`
asset from the current stable release. Its small `Sync stable formula` workflow
checks hourly (minute 23) or by manual dispatch, waits for matching GitHub/CDN
stable versions, verifies the formula asset digest and all four Homebrew archive
hashes/sidecars, then commits only the formula with the tap's own `GITHUB_TOKEN`.
An unchanged version performs no archive downloads or commits. It never builds
the product and needs no cross-repository token. GitHub can delay schedules and
disable them after 60 days without repository activity; maintainers can
re-enable/run the tap workflow in Actions.

Keep `OPENALICE_PUBLISH_HOMEBREW` disabled in OpenAlice: the older push-based
writer below is an alternative, not a second active writer. New stable release
acceptance should include the tap sync receipt (manual dispatch is available
without waiting for the hourly schedule). Beta/dev never update the formula.

The generated Homebrew formula selects the accepted archive and SHA-256 for the
current macOS or Linux architecture. It installs the executable, immutable
resources, release metadata, notices, and Homebrew provenance without compiling
the repository. The formula treats Homebrew's extracted build directory as the
archive release root and copies release metadata to both the keg root and the
Runtime resource tree; it does not guess at an extra directory level.

The generated `openalice-bin` `PKGBUILD` and `.SRCINFO` select the accepted
Linux archive for `aarch64` or `x86_64`, verify its checksum, and install the
same payload under `/usr/bin` and `/usr/share/openalice`. `paru` is an AUR
client; OpenAlice does not ship or manage it.

A stable GitHub Release contains the generated formula, AUR metadata, npm
tarballs, and their publication manifest. Activating the public Homebrew and
AUR commands still requires the TraderAlice tap and AUR package repositories to
publish those generated files after the referenced GitHub Release assets are
public.

## Public channel activation

For every non-prerelease, the release workflow first downloads all six
archives anonymously from their final public GitHub Release URLs and verifies
their bytes plus public SHA-256 sidecars against the accepted channel manifest.
It then downloads the public formula, `PKGBUILD`, `openalice-bin.SRCINFO`, and
npm publish order and compares them byte-for-byte with the preserved publication
inputs. GitHub Release assets cannot retain a leading-dot filename, so the
public `openalice-bin.SRCINFO` asset is the exact byte-for-byte copy that is
installed as `.SRCINFO` in the AUR repository. A 30-day verification receipt is
retained. npm, Tap, and AUR publication all depend on that receipt; none can
publish from a private Actions artifact alone.

External channels are explicit release switches:

| Channel | Repository variable | Required authority |
|---|---|---|
| npm + Bun | `OPENALICE_PUBLISH_NPM=true` | npm Trusted Publishing for all seven names, bound to `TraderAlice/OpenAlice` / `release.yml` |
| Homebrew (alternative push writer; disabled for our tap) | `OPENALICE_PUBLISH_HOMEBREW=true` | `HOMEBREW_TAP_TOKEN` with write access to `TraderAlice/homebrew-tap` |
| AUR / paru | `OPENALICE_PUBLISH_AUR=true` | dedicated `AUR_SSH_PRIVATE_KEY` plus manually verified `AUR_KNOWN_HOSTS` |

Before a stable GitHub Release can be created, the release workflow preflights
every enabled switch. npm exchanges a GitHub OIDC identity for a short-lived,
package-scoped credential for each expected package name. Missing packages
or missing/mismatched trusted publishers fail the check; there is no token
fallback or automatic name reservation. Credentials stay in memory and are
discarded without publishing. The
Homebrew token must see `TraderAlice/homebrew-tap` with push authority; and the
AUR key plus pinned known-hosts entry must be able to read the `openalice-bin`
Git repository. Disabled channels perform no external authority checks. This
makes missing credentials or conflicting ownership a release-planning failure
instead of discovering it after the accepted assets are already public.

The `Public CLI Channel Authority` workflow rehearses Homebrew and/or AUR
authority without publishing. npm uses `Release` with `operation=verify-npm`
from integrated `dev` or `master` (no tag required). The rehearsal must run in
`release.yml` because npm validates that exact workflow identity. It exchanges
credentials for the complete package set but does not upload, build, sign, change a
version, or create a release. Use it before enabling the npm switch.

The npm, Tap, and AUR writers are idempotent. npm verifies each local tarball
against the accepted publish manifest, skips an already-public version only
when registry integrity is identical, and keeps the meta package last. This
makes a partially successful first publication safe to retry. Tap and AUR make
no commit when the verified metadata is already active. AUR never learns its
SSH host key from the same untrusted connection used to publish; the
maintainer supplies the verified known-hosts entry as a secret. Creating
registry packages, creating the Tap, and enrolling the AUR key remain
deliberate maintainer actions. Enabling a switch without its external
repository or authority is a release failure, not permission to invent another
channel or silently skip publication.

### First npm publication or retry without rebuilding

Dispatch the existing `Release` workflow with `operation=publish-npm`,
`channel=stable`, and the current published stable tag. This explicit operation
authorizes only that npm publication; it does not enable the persistent
`OPENALICE_PUBLISH_NPM` switch. It can run from integrated `dev` tooling or
`master`, but accepts only GitHub's current non-draft, non-prerelease latest
release, whose tag is on `master` and whose two product manifests agree.

The single job checks npm authority, downloads the release-owned npm tarballs
and manifests, verifies every tarball before any upload, verifies the public
native archives, then uses the same platform-first publisher as a new stable
release. No build, signing, version change, tag creation, CDN mutation,
Homebrew, or AUR job runs. After upload, verify an actual registry install.
This operation uses OIDC too; an already-published identical version is skipped.
That skip alone is not proof of OIDC authorization.

### npm Trusted Publishing (OIDC)

Activated on 2026-09-04: all five package connections were saved and
[real OIDC exchanges passed](https://github.com/TraderAlice/OpenAlice/actions/runs/33871780397)
from integrated `dev` tooling in a single 15-second job. The temporary
`openalice-first-publish` token was then revoked and the repository's
`NPM_TOKEN` secret deleted. This did not publish a new version or enable the
persistent npm publication switch. A
[second exchange rehearsal](https://github.com/TraderAlice/OpenAlice/actions/runs/33872141409)
passed after both credentials were removed. Carry the workflow to `master` through
normal promotion before the next stable release; do not restore the old token
to operate historical tooling.

For each of `openalice`, `openalice-darwin-arm64`, `openalice-darwin-x64`,
`openalice-linux-arm64`, `openalice-linux-x64`, `openalice-win32-arm64`, and
`openalice-win32-x64`, configure npm Package Settings
→ Trusted Publisher → GitHub Actions:

- Organization/user: `TraderAlice`; repository: `OpenAlice`.
- Workflow filename: `release.yml` (not its directory path).
- Allow `npm publish`; leave environment empty because these jobs do not use a
  GitHub environment. Access to changing/running the trusted workflow is a
  publishing security boundary.

Publication runs on GitHub-hosted Ubuntu with `id-token: write`, Node 22.22.2,
and pinned npm 12.0.2. npm handles its own short-lived credential exchange when
publishing; neither `NPM_TOKEN` nor `NODE_AUTH_TOKEN` is configured. The generated
packages must retain the matching `TraderAlice/OpenAlice` repository URL.
Provenance is not itself proof of OIDC authentication.

After adding all seven connections, run:

```bash
gh workflow run release.yml --ref dev -f operation=verify-npm
```

A successful exchange proves npm accepted the workflow identity for each
package; it does not exercise upload/provenance acceptance for a new version.
Record that last boundary at the next authorized stable publication, rather
than inventing a release to test authentication. After verification, revoke
the temporary first-publication token and remove the repository's `NPM_TOKEN`
secret. npm's restrictive 2FA/token policy is compatible with OIDC.

See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and
the [registry OIDC exchange API](https://api-docs.npmjs.com/). Adding future
platform packages (including Windows) requires first publication and their own
trusted-publisher connections. The historical receipts above cover only the
original five names. `openalice-win32-arm64` and `openalice-win32-x64` must be
enrolled before seven-package publication. Do not restore the revoked bootstrap
token or count the old receipt as Windows publishing authority.

## Update and uninstall ownership

The installer that owns the visible command also owns later file mutation:

| Method | Update | Uninstall |
|---|---|---|
| npm | `npm install -g openalice@latest --allow-scripts=openalice` | `npm uninstall -g openalice` |
| Bun | `bun add -g --trust openalice@latest` | `bun remove -g openalice` |
| Homebrew | `brew upgrade traderalice/tap/openalice` | `brew uninstall traderalice/tap/openalice` |
| AUR | `paru -S openalice-bin` | `paru -Rns openalice-bin` |

`openalice update`, Doctor, and `openalice uninstall` read schema 3 install
provenance. For a package-manager install they report the exact owning-manager
command and never overwrite or remove manager-owned files. The Supervisor TUI
may probe stable, beta, or dev, but it cannot apply a direct installer over a
package-manager prefix; switching channels requires an explicit direct install.
Stop a running
Runtime with `openalice down` before changing the installed version; a running
Guardian keeps its already-mapped executable until stopped.

Known Windows Bun limitation: native acceptance reproduced successful package
removal with a leftover global `openalice.exe` entry. This is tracked in
[OpenAlice #1347](https://github.com/TraderAlice/OpenAlice/issues/1347) and
[Bun #11970](https://github.com/oven-sh/bun/issues/11970). Acceptance verifies
the package is gone and reports the residue explicitly; OpenAlice does not
delete Bun-owned files to hide it. Do not call this a completely clean uninstall.

If the manager replaces the installed package while an older Guardian remains
active, `openalice status` and `openalice up` compare content identities and
report the new product version as pending activation. OpenAlice never rolls
back npm, Bun, Homebrew, or AUR files: the owning manager remains the only
writer. Stopping and starting the Runtime activates the installed package.

Package-manager uninstall removes installation files only. OpenAlice data,
AliceProjects, credentials, broker state, and user-owned Agent Runtimes remain
outside the package manager's payload.

## Release acceptance

For channel changes run:

```bash
pnpm exec vitest run \
  scripts/cli-release-fixture.spec.mjs \
  scripts/build-cli-package-channels.spec.mjs \
  scripts/pack-cli-npm-packages.spec.mjs \
  scripts/release-workflow.spec.ts \
  packages/cli/src/package-manager.spec.mjs
```

The PR workflow samples native macOS arm64 and Linux x64 candidates through npm
and Bun. A `dev` push stays on the preview packaging lane: it builds the six
native artifacts, validates their sidecars and metadata, publishes them, and
runs the live channel smoke without waiting for package-manager or historical
upgrade gates. Windows dev/beta artifacts cross-build on Linux using the shared
server inputs. Native Windows install/update/rollback and npm/Bun command-shim
acceptance is separately replayable and mandatory for stable, not every dev
commit. Beta remains a direct-install channel, not npm publication.
Stable release acceptance
also installs the formula on native arm64 and Intel macOS runners, repeats the
full formula lifecycle on native Linux arm64/x64 runners inside pinned official
Homebrew images, and builds plus installs
`openalice-bin` on native Linux x64 and arm64 runners. The x64 AUR lane uses the
pinned official Arch image; because that image has no arm64 manifest, the arm64
lane uses a pinned Arch Linux ARM image built from signature-checked upstream
repositories. Each smoke uses an isolated home, exercises
an actual stopped upgrade and removal, then starts a synthetic prior candidate
and replaces it through the manager while Guardian is active. The new command
must report the older running content as pending activation, preserve that
result through idempotent `up`, route Doctor/update/uninstall back to the
manager, and activate only after `down` plus a fresh `up`. The fixture rewrites
only an isolated copy of an already accepted native candidate, refreshes its
version/content hashes, and uses ad-hoc signing on macOS; it is never a
publication input. Every Runtime uses isolated state without broker credentials
or live trading.

The npm/Bun smoke operates on generated platform packages. The Homebrew/AUR
smoke first derives the same isolated prior archive set from the accepted
candidate, then lets a local Git-backed tap or real `pacman -U` perform both
version transitions. Lifecycle assertions stay shared while file mutation
remains owned by the manager under test.

For a stable release, the release job derives every package-manager channel only
after all native candidates pass, attaches the generated publication inputs to
the GitHub Release, verifies the GitHub bytes and completed stable CDN mirror,
and publishes the npm meta package last. Opted-in Tap and AUR jobs commit only
the byte-identical metadata covered by that receipt.
