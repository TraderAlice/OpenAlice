# Managed Desktop Runtime, Companion, and Demo Mode

This guide owns the packaged Electron desktop application (`apps/desktop/`):
bundled runtime payloads (managed Pi, PortableGit, `fd`/`ripgrep`), `asar`
packaging invariants, the Desktop Companion floating window, and isolated
Electron/browser Demo Mode. Project/home selection belongs to
[[docs/alice-project.md]]; AI credential and model projection belong to
[[docs/alice-harness.md]].

---

## 1. Packaged Desktop Runtime Contract

A packaged OpenAlice desktop app opens a Workspace on a fresh macOS or Windows
machine without requiring the user to pre-install Node, npm, Git, Bash, or an
agent CLI:

- **Bundled payloads (`scripts/vendor-managed-runtime.mjs`)**: Checksum-verified
  and pinned in `vendor/manifest.json`:
  - `vendor/pi/`: isolated `npm ci --omit=dev` Pi installation launched via
    `[OPENALICE_MANAGED_PI_NODE_PATH, OPENALICE_MANAGED_PI_PATH, ...args]` with
    `ELECTRON_RUN_AS_NODE=1` (never exposed as a global `pi` binary on `PATH`).
  - `vendor/tools/<platform>-<arch>/bin`: `fd` and `ripgrep` so Pi never
    downloads per-Workspace tools.
  - `vendor/git/<platform>-<arch>/` (Windows): PortableGit (`git`, `bash`, `sh`,
    and POSIX utilities) injected onto Workspace child `PATH`. Windows shell
    preference lives in `~/.openalice/state/workspace-shell.json` (`Auto` uses
    packaged PortableGit; `Custom` requires an explicit valid `bash.exe` and
    never silently falls back).
- **Windows shim safety**: npm/pnpm `.cmd` agent shims reduce to their JS
  entrypoint on Node or native `.exe`/`.com` with `shell: false`; batch-only
  shims fail with `unsupported_windows_batch_shim`. Workspace CLIs (`alice`,
  `traderhub`, `alice-uta`) run `openalice-cli.cjs` via Electron's Node mode.
- **Pi trust & theme boundary**: Before TUI/Web launch, the Pi adapter marks
  undecided OpenAlice-managed Workspaces trusted in Pi's trust store without
  overriding explicit user allow/deny choices. Packaged headless runs pass
  `--approve`; interactive runs do not. Provider overrides stay Workspace-local
  (`.pi/extensions/openalice-provider.ts` + `.pi/settings.json`) and never write
  to the user's global `~/.pi/` directory.

### Packaging invariants (`pnpm electron:pack`)

- `asar` is enabled; JS entrypoints live inside `app.asar` while `extraResources`
  places `vendor/`, CLI shims, templates, and UI assets under physical
  `Resources/runtime` (`OPENALICE_APP_HOME`). Never resolve backend JS
  entrypoints from `OPENALICE_APP_HOME`.
- `asarUnpack` unpacks `node-pty` and `dugite` (macOS uses embedded dugite Git;
  Windows excludes `node_modules/dugite/git/**` anchored by a positive
  `package.json` pattern and routes through PortableGit).
- `openalice-update-attempt.json` and `desktop.log` live in machine-local
  Electron `userData`, never inside `OPENALICE_HOME`.

---

## 2. AI Credential Setup UI Contract

**Settings → AI Provider** validates account → region/endpoint → compatible
Workspace Agent runtimes → model ID via a live probe before saving:

- Google Gemini uses the native `google-generative-ai` wire (`x-goog-api-key`),
  never Google's OpenAI-compatibility Bearer endpoint.
- Anthropic-wire credentials distinguish first-party `x-api-key` from gateway
  `Authorization: Bearer` (never sending both).
- Claude Code global onboarding/trust booleans are read-only advisories (never
  written by OpenAlice; unknown state fails open).

---

## 3. Desktop Companion (Floating Pet Window)

`apps/desktop/src/app-window.ts` starts one floating companion window sharing
the Electron main process (no extra Guardian/Alice/UTA process;
`OPENALICE_DISABLE_COMPANION=1` disables it):

- **Window & lifecycle**: Closing the main window hides it while tray,
  companion, and services stay running; only explicit Quit stops services and
  destroys the companion. Position, size (in DIPs across monitor work areas),
  and visibility persist in Electron `userData/companion.json`; click audio
  settings (≤10s, ≤2 MB local WAV/MP3/OGG data URL) persist in
  `userData/companion-sound.json`.
- **Security**: Dedicated narrow preload, sender/frame-checked IPC, context
  isolation, `connect-src 'none'`, and no renderer Node APIs.
- **Activity notifications (`userData/activity-notifications.json`)**: One
  main-process controller polls the Product Activity Journal every 4s. Visible
  main windows use top-right Sonner toasts (up to 3); hidden/minimized windows
  route to an already-visible companion bubble (1 bubble, brief mode by
  default). Clicking a notification validates the active display token and opens
  only Office, Inbox, or News routes.

---

## 4. Demo Mode (Browser and Native Electron)

Demo mode previews populated frontend states (`ui/src/demo/handlers/` and
`ui/src/demo/fixtures/`) without configuring AI credentials, brokers, or agent
CLIs:

```bash
pnpm -F open-alice-ui dev:demo     # browser Demo Mode (MSW Service Worker)
pnpm electron:demo                 # native Electron Demo Mode (child IPC MSW)
pnpm electron:smoke:demo           # automated native Electron demo smoke
```

- **Process & credential isolation**: Native `pnpm electron:demo` builds
  `ui/dist-demo/` and `dist/demo/`, seeds an isolated temporary
  `openalice-demo-*` home for real file IPC reads, disables updates, analytics,
  and data-home switching, and exits cleanly when the window closes. It never
  starts production Guardian, Alice, UTA, Connector, or agent processes, never
  passes provider credentials to the fixture child, and fails unmocked `/api/*`
  requests explicitly with HTTP `501`.
- Demo query parameters exercise recovery states without real mutations:
  `?workspaceSetup=failed|preparing|read-error`,
  `/settings/machines?machineScenario=probe-error|blocked|apply-error`, and
  `/settings?updates=ready`.

---

## 5. Verification

```bash
pnpm vitest run src/core/runtime-profile.spec.ts \
  src/workspaces/agent-detect.spec.ts src/workspaces/spawn-env.spec.ts \
  scripts/vendor-managed-runtime.spec.mjs scripts/assert-desktop-package.spec.ts
pnpm electron:tsc
pnpm test:owner:desktop
pnpm electron:smoke:workspace      # packaged PTY + scheduled Pi headless smoke
pnpm electron:smoke:demo           # native demo smoke
```
