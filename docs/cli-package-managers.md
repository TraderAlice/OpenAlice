# CLI Package-manager Channels

This guide owns npm, Bun, Homebrew, and Arch/AUR distribution of the native
OpenAlice CLI. The accepted native archive and direct Bash installer remain
owned by [[docs/cli-installer.md]]. Runtime lifecycle after installation remains
owned by [[docs/cli-supervisor.md]] and [[docs/local-runtime.md]].

Native Windows package-manager and PowerShell channels are deferred. This guide
covers macOS and glibc Linux on arm64 and x64.

## User commands

Stable package-manager installs use:

```bash
npm install -g openalice
bun add -g --trust openalice
brew install traderalice/tap/openalice
paru -S openalice-bin
```

Bun does not run dependency lifecycle scripts by default. `--trust` is the
explicit Bun authorization that lets the small `openalice` meta package select
and materialize its already-published native platform package. It does not give
OpenAlice permission to install an Agent Runtime or another system dependency.

After npm or Bun installation, `openalice` is the accepted native executable.
It is not a JavaScript forwarding wrapper and does not require Node.js, Bun, npm,
or the installing package manager in `PATH` at Runtime.

## One accepted artifact set

The release build produces four archives:

```text
openalice-cli-<version>-darwin-arm64.tar.gz
openalice-cli-<version>-darwin-x64.tar.gz
openalice-cli-<version>-linux-arm64.tar.gz
openalice-cli-<version>-linux-x64.tar.gz
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
└── optional openalice-linux-x64
```

The meta package exposes the `openalice` command. Its postinstall step selects
the package matching the host OS and CPU, hard-links or copies the native
executable, links immutable resources, records provenance, and verifies
`openalice --version`. It has no network or package-manager fallback. A missing
platform package is an installation failure, not permission to download
unreviewed bytes.

Release packaging records a strict publish order. All four platform packages
must publish successfully before the `openalice` meta package is published.
Stable npm publication is disabled unless the repository explicitly enables
`OPENALICE_PUBLISH_NPM` and provides npm publishing authority.

Package-manager channels are stable-only in this release model. A beta release
still accepts direct npm/Bun installation mechanics against its candidate
archives, but it does not generate or attach registry/Tap/AUR publication
inputs and cannot mutate any of those public package channels.

## Homebrew and AUR topology

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

For every non-prerelease, the release workflow first downloads all four
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
| npm + Bun | `OPENALICE_PUBLISH_NPM=true` | `NPM_TOKEN` for all five public package names |
| Homebrew | `OPENALICE_PUBLISH_HOMEBREW=true` | `HOMEBREW_TAP_TOKEN` with write access to `TraderAlice/homebrew-tap` |
| AUR / paru | `OPENALICE_PUBLISH_AUR=true` | dedicated `AUR_SSH_PRIVATE_KEY` plus manually verified `AUR_KNOWN_HOSTS` |

Before a stable GitHub Release can be created, the release workflow preflights
every enabled switch. npm must identify the token owner and confirm that all
five package names already list that identity as a maintainer; the Homebrew
token must see `TraderAlice/homebrew-tap` with push authority; and the AUR key
plus pinned known-hosts entry must be able to read the `openalice-bin` Git
repository. Disabled channels perform no external authority checks. This makes
missing setup a release-planning failure instead of discovering it after the
accepted assets are already public.

The `Public CLI Channel Authority` workflow exposes the same checks as a manual
read-only rehearsal. Select npm, Homebrew, AUR, or any combination before a
stable promotion; the run uses repository secrets but cannot publish packages,
push metadata, or create a GitHub Release. Use it after reserving names and
installing credentials, before enabling the corresponding release switch.

The Tap and AUR writers are idempotent: if the verified metadata is already
active, they make no commit. AUR never learns its SSH host key from the same
untrusted connection used to publish; the maintainer supplies the verified
known-hosts entry as a secret. Creating registry packages, creating the Tap,
and enrolling the AUR key remain deliberate maintainer actions. Enabling a
switch without its external repository or authority is a release failure, not
permission to invent another channel or silently skip publication.

## Update and uninstall ownership

The installer that owns the visible command also owns later file mutation:

| Method | Update | Uninstall |
|---|---|---|
| npm | `npm install -g openalice@latest` | `npm uninstall -g openalice` |
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
and Bun. A `dev` push stays on the preview packaging lane: it builds the four
native artifacts, validates their sidecars and metadata, publishes them, and
runs the live channel smoke without waiting for package-manager or historical
upgrade gates. The formal beta/stable release matrix repeats npm/Bun mechanics
on all four targets before preserving the candidate. Stable release acceptance
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
