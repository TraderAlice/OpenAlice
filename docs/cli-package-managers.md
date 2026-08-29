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

## Homebrew and AUR topology

The generated Homebrew formula selects the accepted archive and SHA-256 for the
current macOS or Linux architecture. It installs the executable, immutable
resources, release metadata, notices, and Homebrew provenance without compiling
the repository.

The generated `openalice-bin` `PKGBUILD` and `.SRCINFO` select the accepted
Linux archive for `aarch64` or `x86_64`, verify its checksum, and install the
same payload under `/usr/bin` and `/usr/share/openalice`. `paru` is an AUR
client; OpenAlice does not ship or manage it.

The GitHub Release contains the generated formula, AUR metadata, npm tarballs,
and their publication manifest. Activating the public Homebrew and AUR commands
still requires the TraderAlice tap and AUR package repositories to publish
those generated files after the referenced GitHub Release assets are public.

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
command and never overwrite or remove manager-owned files. Stop a running
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
  scripts/build-cli-package-channels.spec.mjs \
  scripts/pack-cli-npm-packages.spec.mjs \
  packages/cli/src/package-manager.spec.mjs
```

The PR workflow builds native macOS and Linux candidates and installs each
through npm and Bun. The formal release matrix repeats npm/Bun acceptance on all
four targets, installs the formula on native arm64 and Intel macOS runners, and
builds plus installs the x64 `openalice-bin` in a pinned clean Arch container.
The official `archlinux:base-devel` image currently has no arm64 manifest, so
arm64 AUR metadata is generated and checksum-bound but still needs a native
Arch Linux ARM acceptance host. Each smoke uses an isolated home, exercises
`up`, Doctor, `down`, manager-owned uninstall guidance, and actual manager
removal without broker credentials or live trading.

The release job derives every channel only after all native candidates pass,
attaches the generated publication inputs to the GitHub Release, and publishes
the npm meta package last. Tap/AUR publication must likewise happen only after
the referenced release URLs and checksums are public.
