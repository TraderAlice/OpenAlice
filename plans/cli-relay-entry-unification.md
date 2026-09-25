# CLI Web Relay Entry Unification

Status: Implemented and verified. This work consolidates CLI-launched browser sessions on the
client-owned WebRelay. It does not change Electron's integrated IPC mode or
backend ownership of AliceProjects.

Owner guides: [[docs/cli-supervisor.md]], [[docs/remote-access.md]],
[[docs/remote-quickstart.md]], [[docs/cli-installer.md]], and [[docs/testing.md]].

## Decisions

- Bare `openalice` already starts a local WebRelay inside its TUI process. Keep
  that path and its one selected Machine/AliceProject as the canonical CLI GUI.
- A CLI browser must use a client-owned relay origin. Backend HTTP and SSH
  tunnels remain implementation transports, never a second GUI entry model.
- Machine registration is the only path from an arbitrary SSH target to the
  connectable list. `machine add` probes health, prepares the remote Runtime,
  then saves its profile. The relay never connects to an unregistered target.
- Browserless Runtime controls remain available. The former public direct
  browser shortcuts (`start`, `open`, `up --open`, and `--remote` attach) retire;
  bare `openalice` owns TUI plus WebRelay, and `openalice relay` is the same Web
  controller without TUI.
- Switching the relay target leaves the prior AliceProject Runtime running.
  Stop/restart remains a separate, explicitly reviewed lifecycle operation.
- The GUI keeps the existing Settings location chooser. It needs no new visual
  control; its loading, focus, keyboard, and responsive behavior stay in the
  shared chooser primitive.

## Work

1. [x] Inventory every CLI path that opens a browser or prints a browser URL,
   including foreground start, detached lifecycle, managed SSH, TUI, and help.
2. [x] Retire direct local browser commands. Keep foreground/background Runtime
   controls browserless and use the relay origin for TUI and headless Web GUI.
3. [x] Require registration before remote selection. Keep remote planning and
   control, but remove arbitrary-target browser attach and its URL fragment.
4. [x] Remove frontend direct-tunnel state and obsolete recovery copy after no
   supported CLI path emits it; keep relay and Electron transport distinctions.
5. [x] Update user and owner docs, root help, and acceptance scripts to show
   one GUI route. Keep explicit remote control and shell automation documented.
6. [x] Verify CLI/UI typechecks, hermetic owner and integration tests, local
   source CLI journey, real browser switch, and disposable SSH remote smoke.

Completion: no supported CLI browser entry opens a Runtime HTTP port directly;
local-to-remote-to-local switching occurs on one relay origin without replacing
either Runtime; the documented commands and tested process lifetimes agree.

Verification: CLI and UI builds/typechecks; `pnpm test:changed` (370 passing),
`pnpm test` (7,301 passing), an isolated real WebRelay browser route, and
`pnpm test:system:remote` (registered SSH Machine, relay selection, reconnect,
remote stop, and project transfer). The packaged native CLI acceptance now
opens and checks the WebRelay origin.
