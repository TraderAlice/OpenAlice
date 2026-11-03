# CLI Installer, Package Managers, Updates, and Signing

This guide owns the native OpenAlice CLI installer, package-manager channels
(npm, Bun, Homebrew, AUR), the shared update-lifecycle planner and coordinator,
and release artifact signing (macOS ad-hoc CLI signing and Windows SignPath
onboarding). Local runtime behavior belongs to [[docs/alice-project.md]];
Electron packaging to [[docs/managed-workspace-runtime.md]].

---

## 1. Direct CLI Installer (`install` & `install.ps1`)

```bash
curl -fsSL https://openalice.ai/install | bash                     # stable
curl -fsSL https://openalice.ai/install | bash -s -- --channel beta
curl -fsSL https://openalice.ai/install | bash -s -- --channel dev
```

Windows uses `https://download.openalice.ai/install.ps1` (PowerShell 5.1,
system `tar.exe`, no elevation, `cli/current.txt` pointer resolved by `bin/*.cmd`
shims).

### Artifact and layout contract

- Six native archives (`openalice-cli-<version>-<darwin|linux|win32>-<arm64|x64>.tar.gz`)
  with `<archive>.sha256` sidecars, built with the exact `.bun-version` compiler.
- `contentIdentity` digests the complete payload manifest (`bin/openalice`,
  `share/openalice/` UI/defaults/templates/adapters, file modes, symlink targets;
  `release.json` excluded). macOS executables receive an ad-hoc `codesign`
  (`scripts/sign-cli-macos.mjs`) before hashes and `release.json` are generated;
  `scripts/verify-cli-release.mjs` verifies the final archive.
- Default install root `~/.openalice` (independent of any AliceProject
  `OPENALICE_HOME`):
  ```text
  ~/.openalice/
  ├── bin/{openalice,alice,alice-workspace,alice-uta,traderhub}
  ├── cli/{current -> releases/<active>, activation.json, releases/<id>/, provenance/, staging/}
  └── data/ workspaces/ provider-keys.json sealing.key   # preserved across install/uninstall
  ```
- Releases declare `dependencyPolicy: "system"` (no bundled Node, Bun, Git,
  Bash, or Agent Runtimes). `openalice setup` checks/guides system Git/Bash
  installation with separate explicit consent (`--yes` on the installer never
  approves installing system packages).

### Atomic install, activation, rollback, and uninstall

1. Acquire `.cli-install.lock` → stage archive on the same filesystem → verify
   SHA-256 → validate `release.json` and `--version` → move to immutable
   `cli/releases/<id>/` → write schema-3 provenance → record pending activation
   in `cli/activation.json` and atomically swap `cli/current` → retain newest 3
   POSIX releases (never pruning the rollback target).
2. First successful Guardian + Alice HTTP readiness confirms
   `cli/activation.json`; a failed first start atomically rolls `cli/current`
   back to the previous retained release without touching user data.
3. `openalice rollback [--plan|--yes|--to <release>]` is local and download-free.
   `openalice uninstall [--plan|--yes]` removes `cli/`, the five launchers, and
   its PATH block while preserving all user data and AliceProjects.

---

## 2. Package-Manager Channels (npm, Bun, Homebrew, AUR)

```bash
npm install -g openalice --allow-scripts=openalice
bun add -g --trust openalice
brew install traderalice/tap/openalice
paru -S openalice-bin
```

All channels consume the exact accepted six-platform release archives without
rebuilding:

- **npm / Bun (stable-only)**: Meta package `openalice` plus six platform
  packages (`openalice-{darwin,linux,windows}-{arm64,x64}`). All six platform
  packages must publish before the meta package via GitHub OIDC Trusted
  Publishing (`OPENALICE_PUBLISH_NPM=true` in `release.yml`, no static npm
  token).
- **Homebrew (stable-only)**: `TraderAlice/homebrew-tap` runs its own scheduled/
  manual `Sync stable formula` workflow verifying public GitHub/CDN digests;
  keep push-based `OPENALICE_PUBLISH_HOMEBREW` disabled in this repo.
- **AUR (stable-only)**: `openalice-bin` (`OPENALICE_PUBLISH_AUR=true` with
  `AUR_SSH_PRIVATE_KEY` and pinned `AUR_KNOWN_HOSTS`).
- **Ownership rule**: The package manager that installed `openalice` owns all
  future updates and uninstalls. `openalice update`, `uninstall`, and Doctor
  read schema-3 provenance, print the owning manager's command, and refuse to
  overwrite manager-owned files. Replacing a package while Guardian is running
  reports `pending activation` until `openalice down && openalice up`.

---

## 3. Shared Update Lifecycle (`packages/update-lifecycle`)

`packages/update-lifecycle` provides the pure planner, SemVer/channel comparator,
`DiscoveryStore` single-flight cache, and `/node` atomic journals consumed by
the backend, CLI, Desktop, and Web UI (`useUpdateLifecycle`).

- **Update authority**: Derived from provenance + runtime profile—source
  checkouts use Git, packaged Electron uses `electron-updater`, direct CLI uses
  `openalice update` (`installer.versionedUrl` + `installer.sha256`), and
  package-manager installs defer to their manager. Service-managed, dev, pinned,
  and custom contexts never fetch public update manifests from the Web UI.
- **Three Settings Overview objects**: **App**, **Backend**, and **Alice
  Project** (which coordinates default Workspace template upgrades, AQ/AP source
  tag merges, Alice Harness Skill bundles, and installed Broker Packs).
- **Coordinated execution (`UpdateCoordinator` & `UpdateControlService`)**:
  `approveUpdate` freezes the exact target version and review digest before
  running any effect. `FileUpdateJournal` records in-flight stages under the
  Guardian lock and reconciles lost outcomes against owner receipts on restart
  without blindly replaying mutations or auto-resolving Workspace file conflicts.
- **Remote SSH updates**: `planRuntimeUpdate` / `transitionRuntimeOperation`
  record stage receipts in `<remote-targets.json>.updates/` on the controlling
  client and validate remote schema-3 provenance before mutating a remote host.

---

## 4. Windows Code Signing (SignPath Onboarding)

- `signpath/windows-installer.xml` and `.github/workflows/signpath-test-windows.yml`
  own the SignPath Foundation self-signed test lane for the Windows NSIS
  installer (`OpenAlice.Setup.<version>.exe`).
- The test workflow builds and smoke-tests the unsigned installer, submits it
  under `SIGNPATH_TEST_POLICY_SLUG=test-signing` (when `SIGNPATH_TEST_ENABLED=true`),
  temporarily trusts the pinned `SIGNPATH_TEST_CERTIFICATE_THUMBPRINT` in
  `LocalMachine\Root` on the disposable runner to verify `Valid` Authenticode
  status, and removes trust in `finally`. It never publishes a release or
  updater feed.
- Production Windows releases remain unsigned until the production SignPath
  certificate is issued and integrated into
  `.github/workflows/release-desktop-platform.yml` ahead of blockmap and
  `electron:verify-update-assets` generation.

---

## 5. Verification

```bash
bash -n install
pnpm exec vitest run tests/e2e/cli-installer/install.spec.mjs \
  tests/integration/cli-release-artifacts/cli-release-fixture.spec.mjs \
  tests/integration/cli-release-artifacts/build-cli-package-channels.spec.mjs \
  scripts/pack-cli-npm-packages.spec.mjs \
  scripts/release-workflow.spec.ts \
  packages/cli/src/package-manager.spec.mjs
pnpm test:system:installer
```
