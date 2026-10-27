# News-source management experiment

Status: real-browser management experiment passed under Bun; no commit, push, PR, release, or maintainer approval. Node/TSX source startup and the broad repository test gate are not passing.

## Outcome

Prove editing direct RSS feeds and RSSHub routes from the existing Settings page, one shared RSSHub instance address, and applying saved source changes to the running collector. Use actual RSSHub on Node 23 and the actual Alice HTTP/API/UI, not fake responses. Keep runtime/config/article data under a separate temporary OPENALICE_HOME.

Owner guides: [[docs/project-structure.md]], [[docs/ui-interaction-and-motion.md]], [[docs/local-runtime.md]]. No issue has been published for this experiment.

## Contract

- User config remains the current source list; the server preset catalog is only an explicit add menu. Loading catalog never rewrites subscriptions.
- RSSHub-backed subscriptions store a relative route and use the shared instance URL at collection time. Direct RSS uses its full URL.
- HTTP(S) URLs without credentials; RSSHub base excludes query/fragment; routes cannot change origin. RSSHub fetch rejects redirects in this experiment.
- Source edits, enable/disable, interval, and instance URL apply without restart; prior pass completes before a queued configuration is installed. Memory/retention settings still require restart.
- New/edited subscriptions receive IDs. Legacy feeds remain readable; formal persisted-config migration is not established by this experiment.
- Health state is process-local for this experiment and is reset when the effective URL changes. Durable health is not claimed.

## Work ownership

Parent: schema/resolver, collector/state/config application, runtime composition, isolation and final real-browser acceptance.
UI worker: existing page and domain API client/types.
Test worker: bounded deterministic collector reconfiguration regressions.
Read-only worker: safe isolated source-runtime launch.

## Checklist

- [x] Inspect current UI/config/collector and prior live RSSHub proof.
- [x] Define source, endpoint, save, and in-memory health contracts.
- [x] Integrate actual source editing UI and backend.
- [x] Run bounded deterministic collector regressions and applicable typechecks.
- [x] Launch isolated actual Alice source under Bun, Vite, and Node 23 RSSHub.
- [x] In a real browser, add the Chinese presets, edit a source, change the shared endpoint, collect, observe per-source status and saved articles.
- [x] Stop owned processes, free test ports, keep previous Node selection, and retain exact run instructions/evidence.

## Scope limits

No automatic RSSHub installation, production pack/distribution, hosted data service, permanent health schema, account/broker connection, or formal rollout migration. These are not implemented or proven by this management experiment. No commit, push, PR, merge, or changes to unrelated PR branches. Demo endpoint emulation was not expanded for the new experimental collector APIs. See the safety disclosure below for one failed startup probe.

## Observed evidence

- Schema/URL smoke: 31 presets; direct URL unchanged; shared path-prefix resolution and malformed route/base rejection passed.
- `pnpm exec tsc --noEmit`: passed after rebuilding stale `@traderalice/update-lifecycle` declarations.
- Final targeted `pnpm exec vitest run ui/src/pages/NewsCollectorPage.spec.tsx src/domain/news/collector/rss-config.spec.ts src/domain/news/collector/rss-parser.spec.ts`: 27/27 passed in 3 files. Final `pnpm --filter open-alice-ui exec tsc -b`: exit 0. No existing lint/formatter config was found; no new tool was installed.
- Independent real config-store/Hono/collector probe: catalog GET did not rewrite config; disabled collection returned 409 without upstream requests; enabled direct/route ingestion and base changes persisted and took effect. Receipt: `D:/temp/newspack-logs/news-route-probe-esm.log`. This does not exercise browser/auth integration.
- Root `pnpm test`: failed; 883 passed / 10 failed / 9 skipped files, 7540 passed / 55 failed / 151 skipped tests. Failures are outside the changed news backend; no pre-change comparison exists, so they are not all declared baseline. Receipt: `D:/temp/newspack-logs/pnpm-test.log`.
- Actual source Guardian/Node/TSX startup failed before Vite: no Alice output/listener within 20 seconds; a direct TSX-watch diagnostic also failed to become ready. The lower-level cause remains unknown. Actual `bun --conditions=openalice-source src/main.ts` started successfully, and standalone Vite drove the real WebPlugin/config routes/collector/store. This proves the management flow under Bun, not a repaired Node/TSX dev launcher.

## Runtime isolation

Scratch root: `D:/temp/openalice-news-39244562-4979-4b0b-8327-f6f68f617b69`. Redirect app home, global provider-key root, Supervisor registry, and workspace root here; force lite mode, disable UTA and Connector, bind loopback, keep authentication enabled. An owned loopback 503 listener quarantines the otherwise unconditional Connector poll. It is unrelated-service isolation, not a fake news response. A cold stock Alice can still make a read-only SEC/OpenBB symbol-index request.

The browser route is `/settings/news-collector`, not `/settings/news`. The accepted experiment used actual `src/main.ts` under Bun at 47331 and actual standalone Vite at 5173. Guardian relay startup was not proven.

RSSHub uses the already-built `D:/temp/rsshub/dist/index.mjs`, invoked directly with `C:/Users/Administrator/AppData/Local/nvm/v23.11.1/node.exe`, `--max-http-header-size=32768`, `PORT=1210` (second instance 1211), `LISTEN_INADDR_ANY=0`, `NODE_ENV=production`, `NO_RANDOM_UA=true`. Global Node selection was never changed and remained v26.3.1 after shutdown.

## Real-browser acceptance

- Added CLS/Gelonghui/Jin10 from the server menu; each collected 20/15/21 real RSSHub items. Stored route feeds still carried their old serialized 1200 URL, but every actual status/request used shared base 1210.
- Added a direct CLS feed at `http://127.0.0.1:1210/cls/telegraph`. Edited the first source name, description, categories and route to `cls/telegraph?limit=5`; its ID stayed stable and the next collection returned 5 items.
- Changed the shared base through the settings input to 1211: all three routes used 1211 and returned 5/15/21 items; the direct feed remained on 1210 and returned 20. Alice listener PID was 56116 before and after the switch.
- An absolute external route was rejected by the editor without changing persisted config. An actual nonexistent RSSHub route returned 404 and displayed Error, not Healthy. Restoring the real route recovered.
- Individual source disable produced Disabled. Master disable made all four Disabled and Check now displayed the backend refusal. Re-enabling and collecting recovered all four Healthy.
- Browser reload preserved base, edited name/route/categories/description and stable source ID. The real news API reported 59 stored items; scratch JSONL contained records through seq 59. Repeat checks returned new=0 for the same feed items.
- Evidence: scratch `acceptance.json`, `home/data/config/news.json`, `home/data/news-collector/news.jsonl`; final healthy screenshot `C:/Users/Administrator/AppData/Local/Temp/omp-sshots-159972e36acaf728.webp`, preceding 404 screenshot `C:/Users/Administrator/AppData/Local/Temp/omp-sshots-1599724c00caf727.webp`. Logs: `pi-unified-exec-88-469cdf1f.log` (Alice), `pi-unified-exec-89-0d68f714.log` (Vite), `pi-unified-exec-82-0977b5fe.log` and `pi-unified-exec-91-09645fc3.log` (RSSHub), under the host temp directory.
- Cleanup receipt `pi-unified-exec-96-6f9f97be.log`: no listeners on 1210/1211/47331/47332/5173/57027; Node v26.3.1. Owned browser tab and five runtime sessions were stopped; scratch config/articles/evidence were retained.

## Accepted launch commands

Use separate foreground terminals and only the scratch roots above. The isolation listener prints its dynamically bound port; copy that actual port into the Alice connector URL before launching. 57027 was the port in the accepted run. Do not reuse the real Connector default.

```powershell
# Repository working directory: F:/projects/OpenAlice. Start isolation first.
$root = 'D:/temp/openalice-news-39244562-4979-4b0b-8327-f6f68f617b69'
node "$root/connector-isolation.mjs"
```

```powershell
# RSSHub working directory: D:/temp/rsshub. Second terminal: PORT=1211.
$env:PORT = '1210'
$env:LISTEN_INADDR_ANY = '0'
$env:NODE_ENV = 'production'
$env:NO_RANDOM_UA = 'true'
& 'C:/Users/Administrator/AppData/Local/nvm/v23.11.1/node.exe' --max-http-header-size=32768 dist/index.mjs
```

```powershell
# Alice working directory: F:/projects/OpenAlice. Clear inherited overrides first.
$ErrorActionPreference = 'Stop'
foreach ($name in @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { $_ -like 'OPENALICE_*' -or $_ -eq 'AQ_LAUNCHER_ROOT' })) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
$root = 'D:/temp/openalice-news-39244562-4979-4b0b-8327-f6f68f617b69'
$env:OPENALICE_HOME = "$root/home"
$env:OPENALICE_GLOBAL_DIR = "$root/home/global"
$env:OPENALICE_SUPERVISOR_HOME = "$root/supervisor"
$env:AQ_LAUNCHER_ROOT = "$root/home/workspaces"
$env:OPENALICE_APP_HOME = 'F:/projects/OpenAlice'
$env:OPENALICE_BIND_HOST = '127.0.0.1'
$env:OPENALICE_TRADING_MODE = 'lite'
$env:OPENALICE_LITE_MODE = '1'
$env:OPENALICE_UTA_DISABLED = '1'
$env:OPENALICE_LAUNCHER = 'dev'
$env:OPENALICE_CONNECTOR_URL = 'http://127.0.0.1:57027' # use the actual isolation port printed above
$env:OPENALICE_DISABLE_AUTH = '0'
$env:OPENALICE_TRUSTED_PROXIES = ''
$env:OPENALICE_CSRF_TRUSTED_ORIGINS = ''
$env:OPENALICE_WEB_TRANSPORT = 'http'
$env:OPENALICE_WEB_PORT = '47331'
$env:OPENALICE_MCP_PORT = '47332'
$env:OPENALICE_UI_PORT = '5173'
bun --conditions=openalice-source src/main.ts
```

```powershell
# Vite working directory: F:/projects/OpenAlice. Open http://127.0.0.1:5173/settings/news-collector.
$env:OPENALICE_BACKEND_PORT = '47331'
$env:OPENALICE_UI_PORT = '5173'
$env:NPM_CONFIG_USERCONFIG = 'D:/temp/rsshub-logs/empty-user.npmrc'
& "$env:APPDATA/npm/pnpm.cmd" --filter open-alice-ui dev
```

## Startup-probe safety disclosure

The diagnostic worker first used PowerShell variable `$home`, which collides with the read-only `$HOME` automatic variable. Its assignment failed and that owned process briefly inherited `C:/Users/Administrator` as its app home. The worker terminated it immediately. Subsequent metadata checks found no OpenAlice data/config, state/runtime lock, workspace state/runtime lock, global directory or provider-key file there; the existing `workspaces` directory had pre-probe timestamps and was not inspected/modified. No persisted production-state write was found. The subsequent accepted run used explicit scratch paths and `$ErrorActionPreference='Stop'`.
