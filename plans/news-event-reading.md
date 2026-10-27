# News event reading and unified acquisition

Current readiness delivery (2026-10-28): the maintainer authorized fixing the
existing News readiness gaps and PR delivery under repository rules. New official
feeds, company/commodity-report acquisition, X/FMP and wider-region or WeChat
channels are deferred. Existing Draft review/acceptance and rejected fixture
cleanup remain separate.

The candidate is isolated on `fix/news-readiness-20261028` in managed worktree
`b3f6`, based on PR #1767 head `129fb4203`, with current upstream dev
`006fffd59` merged as `132e899dd`. Source was frozen at `b49e45eae16b149114a254054d25b59475b4bc68`.
The final recording change only updates this plan and its index. Delivery uses
the existing [Draft PR #1767](https://github.com/TraderAlice/OpenAlice/pull/1767)
to `dev`; no duplicate PR, merge or release. The original shared checkout and
its unrelated work remain in place. Code Intel failed once (missing DAG
capability registry); bounded direct reads supplied code evidence.

Implemented: source URL/tab/remount/history persistence, including category and
relationship transitions; RSS full-content precedence and empty/entity-only
fallback; declared feed-content/summary labels; raw publication wording and
unknown-timezone handling; AE/QA/IL/HT/SV identities already present in collected
events. Chat guidance is 1.8.13. No subscription was added. Original evidence,
human marks and cross-event assignment validation remain intact. X/FMP prototype
artifacts and their acquisition-only suite are excluded from this candidate.

Verification on the clean frozen source: complete default suite exit 0,
947 files / 7978 passed / 0 failed / 152 skipped. Critical-local exit 0,
15/15 required assertions passed (18 actual assertions across two lanes).
Root/tests/UI typechecks and backend/worker/UI builds exit 0. Independent
read-only review identified two P2 defects; both had observed RED/GREEN and
66 focused checks passed after repair. The earlier full-run failures were
reproduced and fixed as Windows environment/fixture issues, without relaxing
production validation. Final receipts supersede that earlier failing run.

Actual built UI `index-BIULOqvM.js` at preview port 47359: source selection
survives 1440px -> 375px -> 1440px, category/Hot/relationship transitions,
Clear/back and refresh. Both document widths match their viewport. Newly
collected real reports render Feed summary. No browser errors were recorded.
Runtime PID 80500 uses this candidate and the existing isolated home; twelve
sources collect every minute and the ordinary native Issue runs every five
minutes. A post-restart native batch completed. Only the two owned News Workspace
reference copies were updated after exact-byte guards and backup; three personal
Workspaces were not changed. The original 736988 archive bytes, configuration,
human reading state and protected historical files were checked unchanged;
new legitimate records append. Passive observer PID 80384 remains running.

Two real continuing events were independently read: Qinghai automatic 4.6/formal
4.9 measurement and Qatar/Russia arrival/meeting. Every inspected association
digest and excerpt matched an original. This is a two-case audit, not a general
accuracy claim. Old Qatar unresolved state remains until native reassessment;
adding a supported code does not silently rewrite old evidence or infer a ticker.

Still open: #17's historical shared-original fixture conflict (prior cleanup
automatic approval rejected with `blocked by policy`; no retry), completion of
the passive 24-hour window (maintenance around 20:58-21:00 UTC excluded),
broader semantic evaluation, and final-current-head compiled CLI, standard
Electron/literal tray and isolated remote acceptance. Prior artifact receipts
do not certify this head; standard Spectre/toolchain and remote conditions remain
unsatisfied. Keep the PR Draft. Missing publisher bodies are visible, not fetched
or reconstructed by this change.

Local evidence: `F:/temp/openalice-news-readiness-20261028/delivery-receipt.json`,
`full-suite-final.json`, `critical-final.json`, `live-event-audit.json`, browser
assertion outputs and desktop/narrow/provenance screenshots. #16 has a source
fix and real acceptance ready for the existing PR; it is not closed before merge.

The sections below are historical increments; later decisions above supersede
their old no-push/iteration-hold status statements.

Current PR-routing increment (2026-10-28): the maintainer asked whether the
remaining work is bounded and can be assigned to project PRs. Recovered the
actual existing upstream Draft PR and fork issues before writing. The reviewed
task list is now at
https://github.com/TraderAlice/OpenAlice/pull/1767#issuecomment-6451394842 .
Its exact remote body and author were verified; the PR remains OPEN / Draft at
`129fb42031e00cfd8fab135d56d522d592f6290a`, with its original body unchanged.

The first usable release still needs five bounded P0 outcomes: body/time
quality; real continuing-event and review closure (including the existing #17
ownership defect); entity/relationship quality and human-checked samples;
stability and filter-state preservation (existing #16); and verification bound
to the actual final integration head and required delivery surfaces. The older
local passing receipts do not establish those final gates.

PR routing: #1767 retains the News Modules/RSSHub foundation contract; the local
reading/automatic-preparation work, authoritative-source batches, and X/FMP
account integration have separate proposed follow-up PR scopes. None of those
new PRs was created. Broader regional media, WeChat, generic web/JSON and push
intake remain later expansion rather than extra homepage components.

The existing fork issues #16/#17 were re-read and remain OPEN with their existing
assignees. No duplicate issues were created. The issue-graph preflight found no
required type/domain labels or repository-linked designated Project, so routing
uses the existing PR checklist without inventing labels or selecting an unrelated
board. The authenticated upstream role has pull access and no push/triage access;
this task records PR work rather than claiming new assignee/Project mutations.

Receipts: `F:/temp/openalice-news-pr-routing-20261028/receipt.json`, exact comment
readback and the original PR snapshot. The current configuration now contains
twelve enabled feeds (including jrj-us), still at one minute; the latest source
observation has body gaps and no final 24-hour result. This turn changed tracking
and these records only; no source commit/push, new PR, merge, release, paid-source
activation or fixture cleanup. The source iteration hold remains active.

Current source-classification increment (2026-10-28): organize the existing
signal-source directory by coverage country/region and market/topic. Keep the
current News/settings surface and source subscription behavior.

- [x] Add catalog-only coverage metadata to all 49 server-owned presets; leave
  saved feed schema, article categories and collection identity unchanged.
- [x] Combine region, market and keyword filters; search translated coverage
  labels, show result counts and reuse labels on matching subscribed feeds.
- [x] Exclude directory metadata when adding a subscription; preserve custom
  feeds as unclassified when their coverage is unknown.
- [x] Regenerate the owner catalog and verify the actual backend/UI, including
  the existing source pipeline after an owned preview restart between runs.

Acceptance: three focused files pass 31 assertions after observed RED failures
for missing classifications/filters and metadata leaking into saved feed input.
Root and UI typechecks and both builds pass. The actual API returns all 49
classified presets. At 1440px, United States + Macro returns four sources;
at 375px, Global + Forex returns three, with no document overflow or page errors.
Browsing did not change the saved News configuration bytes or the existing
archive prefix. The eleven active feeds and five-minute native preparation Issue
continue; a native run completed after the preview restart.

Evidence: `F:/temp/openalice-news-source-classification-20261028/acceptance.json`,
`tests.json`, browser proof JSON/screenshots, scoped baselines and the assert-based
`verify-classification.mts`. Runtime ownership now lives in that directory's
`runtime-process.json`; the original 24-hour observer continues unchanged.
Coverage is a directory focus, not publisher domicile or established event
impact. All 49 endpoints were not revalidated, the complete monorepo/packaged
desktop/physical mobile gates were not run, and the existing responsive shell
remount can reset local filters (#16). The feature-branch iteration hold remains:
no source commit/push/PR/merge/release.

Current preparation increment (2026-10-28): the maintainer authorized starting
automatic organization after reliable intake. Extend the existing native Issue
contract to assess source comparisons and publish/recover separate entity
associations, using a bounded recent-publication queue and retaining the default
oldest queue. New and backfill evidence share a twenty-original run budget.
Missing bodies and uncertain facts stay reviewable. Reuse an ordinary dedicated
Workspace and the already logged-in native Codex runtime; do not add an
in-process model loop, a new scheduler or paid X/FMP sources. Full publisher-page
retrieval is not implemented by silently treating feed excerpts as full bodies.

- [x] Reproduce recent-queue ordering and add the compatible bounded query.
- [x] Extend known managed-prompt upgrade tests for the comparison/association
  contract, preserving customized prompts and existing human ownership.
- [x] Verify owning checks, deploy the current backend and prepare the ordinary
  native Workspace/Issue without changing existing personal Workspaces.
- [x] Run real bounded scheduled batches; inspect actual publications, review
  holds, missing-field recovery, source evidence and the real News reader.

Local preparation acceptance: a dedicated ordinary Chat-template Workspace
`chat-open-bamboo-river` (tag `news`, display name 新闻整理) uses the existing
native Codex login and one visible `news-event-preparation` Issue. Its operator
schedule is every five minutes, with a fifteen-minute watchdog and a configured
twenty-original evidence budget. The settings factory still defaults to fifteen
minutes; the actual Issue owns cadence. All three pre-existing Workspaces retain
their identities and paths. X/FMP, provider credentials and UTA remain inactive.

| Conclusion | Actual verification | Result and limits |
| --- | --- | --- |
| The pipeline actually runs native batches | Existing Issue run history, native Session identities and publication `preparedBy` | Seven completed native runs were independently inspected (one initial operator fire and subsequent scanner fires). They produced sixteen new stored events representing forty originals, plus two eligible historical event revisions. No completed runs overlap. `exitCode:0` is not treated as proof every requested repair succeeded. |
| New assessments are persisted and evidence-bound | Every new completed event and its separate association API readback; exact archive excerpt/digest checks | All sixteen have importance, explicit transmission assessment, reviewed comparison arrays and current native association snapshots matching the event revision. Every cited relationship excerpt and UTF-8 SHA-256 matches its event-owned archived original. Unknown security/country identities remain unresolved; no supported barId is fabricated. |
| Backfill works alongside incoming work | Canada tariff and Hormuz tanker artifacts changed from revision 4 to 5 while preserving every original development assignment | Both now have reviewed comparison arrays and current relationship snapshots. The newer native reference skips shared-original candidates before choosing another eligible repair; it was explicitly applied only to the newly created News Workspace's two untouched skill copies, with backup and byte verification. The first-party Chat template version is now 1.8.12; personal Workspaces were not silently upgraded. |
| Contradictions and incomplete relations remain reviewable | Current processing state and native run summaries cross-checked against stored fields | Review count was twelve at acceptance, including the original three unchanged holds. Four new records differed by a factor of one hundred in reported oil quantities; five meeting reports remained held for ownership/date/location gaps. No original was deleted to clear pending work. |
| Original evidence and human state survive processing | Byte-prefix comparison against the 431-record activation baseline; original development membership, human flags/read progress and review-state comparisons | Acceptance snapshot: 491 archive records, no duplicate dedup keys; original bytes unchanged. Existing follow/bookmark/importance/lock/read fields and old review holds remain unchanged. The retained test fixture is byte-identical. |
| Software and actual reader checks | Recent-queue RED/GREEN, five News files, generated CLI contract suite, root/tests typechecks, backend build, actual 1440px/375px reading | 58 News cases plus 15 CLI cases pass; both typechecks and backend build exit 0. The real inline policy card shows United States / directly involved, Energy XLE / conditional analysis and separate source evidence. Document widths fit both viewports; page errors were empty. |

Receipts and assert-based acceptance are at
`F:/temp/openalice-news-preparation-live-20261028/final-acceptance.json`, with
baseline, `issue-current.json`, `published-evidence.json`, `reference-update.json`
and desktop/narrow screenshots in the same directory. The source runtime now
uses `runtime-entry.mjs` from that directory; process ownership is recorded in
`runtime-process.json`. The original passive 24-hour source observer continues.

Two historical content repairs remain blocked because the retained notification
fixture references originals 3273/3277/3278 already owned by the Iran/Anthropic
events. Real later meeting reports were identified but could not be appended to
that conflicted history, and remain held; successful real follow-up publication
through that path is not claimed. New-event publication and eligible backfill
continue. [#17](https://github.com/2233admin/OpenAlice/issues/17) records the
reproduction and explicit deferral; its exact remote body was verified. The
earlier cleanup was rejected by automatic approval with only `blocked by policy`;
this task did not retry cleanup or weaken ownership validation. One native run
also described Anthropic comparisons as assessed, while the persisted artifact
still lacks them; the receipt follows stored fields rather than that summary.

Full publisher-page retrieval/translation, a complete financial quality gold
set, all-archive completion, broader entity catalog coverage and the final
24-hour observation remain open. This increment enables bounded ongoing native
preparation from retained source material; it is not a complete-body or general
semantic-accuracy claim. Work remains on the held branch without source
commit/push/PR/merge/release.

Current increment (2026-10-28): the maintainer authorized prioritizing reliable
public feeds and Chinese flash news, with X/FMP account integration later. Reuse
the existing collector, configuration UI and archive. A separately operated,
loopback-only RSSHub container is pinned to inspected upstream commit
`1d73c7c6158e0fe2bfab06300f41b040716127ab`; real CLS, Gelonghui, Jin10 and
Wallstreetcn routes have returned dated content. This does not add RSSHub hosting
to Alice or activate paid providers/native preparation. Keep the source-lane
iteration hold.

- [x] Verify the four Chinese flash routes through the production collector.
- [x] Enable the verified public/Chinese selection in the existing local News
  runtime after preserving configuration and original evidence.
- [x] Verify scheduled arrivals, isolated source failure/recovery, restart
  deduplication and the affected real News/source-status surfaces.
- [x] Record actual elapsed observation and remaining operational limits.
- [ ] Complete the passive 24-hour observation; host boot recovery is a
  separate unverified operational condition.

Current acceptance: the existing preview at `http://127.0.0.1:47359/market/news`
now collects every minute from seven public feeds (Fed, ECB, MarketWatch, WSJ
Markets, CNBC Economy, SCMP and CoinDesk) and four Chinese flash feeds (CLS,
Gelonghui, Jin10 and Wallstreetcn). Configuration was backed up before the
existing configuration API explicitly enabled those eleven subscriptions.
Nikkei was not selected because its feed supplied neither dates nor bodies.
No X/FMP module, paid credential, native preparation Issue or trading connection
was enabled. The independently operated RSSHub service is bound to loopback
port 1200, uses a pinned image and has `unless-stopped` restart policy; Alice
does not install, start or supervise it.

| Conclusion | Actual verification | Result and limits |
| --- | --- | --- |
| Scheduled multi-source intake | 120 passive API/archive samples over 601359 ms; no manual collection requests | The observation archive grew from 220 to 383 unique records. After the first all-healthy sample, later Chinese arrivals were CLS +1, Gelonghui +1, Jin10 +2 and Wallstreetcn +1; these are not the initial historical batch. |
| Source outage isolation and automatic recovery | During RSSHub absence, the seven public feeds kept refreshing while four Chinese rows reported errors; after restoring the service the unchanged backend's next ordinary cycle recovered them | First all-healthy sample at 2026-10-27T16:19:58.943Z. This window includes a source outage and a controlled backend interruption; it is not a zero-failure uptime or SLA claim. |
| Actual backend restart and durable evidence | Verified PID, executable, entry and both listeners; stopped the task-owned old preview only after all feeds were idle/healthy; restarted without deleting ownership files | New preview PID 103472 recovered 379 dedup keys and resumed all eleven subscriptions. Later API reads and repeated post-restart polling succeeded. The final acceptance snapshot had 400 unique records; both the original 12-record archive and the entire pre-restart archive remain unchanged byte prefixes. |
| Human/event state | Byte comparison of seven original event/association files, and semantic comparison of all reading/follow/bookmark/processing fields excluding derived heat history | Unchanged. The previously labelled notification fixture remains untouched. New collection appends originals; it does not publish event analyses. |
| Late-report cache eviction | Two failing regression cases before the one-line store fix, followed by five owning test files, root typecheck and current backend build | Before the fix, a late old report displaced the newest publication both on ingest and after lowering the memory limit. The cache now stays ordered by publication time; all 62 cases, typecheck and build pass. Archive and stable IDs are unchanged. |
| Affected real UI | Native browser at 1440px and 375px; source filter, original report expansion, live source-status settings | Chinese reports, publisher labels and publication times render in the existing News panel. Both document widths fit the viewport; all eleven source cards show successful collection. Page errors were empty. Responsive remount resets the local source filter: separately recorded in [#16](https://github.com/2233admin/OpenAlice/issues/16), assigned 2233admin, with exact remote body re-read. |

Receipts, source/runtime ownership, original-state backup, assert-based probes
and screenshots are under `F:/temp/openalice-news-stability-20261028`; the scope
receipt is `final-acceptance.json`. The cache-fix source diff is one sorting line
plus two behavioural regression cases. The generated source guide explains the
publication-time memory policy.

A passive 24-hour observer started at 2026-10-27T16:33:02Z, samples once per
minute and records to `longrun.jsonl`, `longrun-latest.json` and eventually
`longrun-result.json`; ownership is in `longrun-process.json`. It does not
collect, dispatch native models or change configuration. Its completion is
pending. RSSHub requires Docker Desktop to remain running; Windows host boot
and Docker auto-start have not been accepted. During Docker Desktop startup an
earlier image/container disappeared from the selected engine; the underlying
cause was not established. The pinned service was recreated under explicit
`desktop-linux` context and its current container/engine identity remained
stable through the subsequent observation. Some ECB/Jin10 records lack bodies,
and Jin10 often omits individual links; those gaps remain explicit.

Status (2026-10-27): the eight approved News/analytics tickets #8–#15 have local
acceptance, including following/notifications, source comparison, evidence-bound
country/industry/asset relationships and three analytics boards. The latest
batch passed 64 Node and 94 UI cases plus owning typechecks/builds and actual
desktop/narrow reading. Two real events have native-published associations;
unknown assets remain unresolved. Global Macro now opens structured country
filters for catalogued identities, with keyword fallback for uncatalogued ones.

This does not complete AIHOT absorption or sustained automatic operation. The
earlier real scheduled preparation batch accounted for 12 originals as nine
reports in four events and three explicit review holds. Source modules and
recurring native preparation exist, but paid X/FMP live acceptance, continuous
incoming/follow-up acceptance, editions and broad association coverage remain
open. In the isolated preview, collection is disabled and no preparation Issue
is scheduled. The current managed prompt explicitly backfills importance and
transmission, not every new comparison/association field. Read/write capability
and sample publication are not automatic coverage of the archive.

Work stays on the held news branch. The labelled notification test fixture
remains because automatic approval rejected its cleanup. Original archive/four
event bytes and original human/read state are preserved. The detailed receipts
and remaining operational boundaries are recorded below.
Existing Draft PR #1767 remains held: no merge or release. Preserve unrelated
uncommitted plans and the pending News Modules acceptance contract.

## Current AIHOT capability gaps (2026-10-27)

Purpose: answer which upstream capabilities still improve this financial News
module after the eight local tickets. This is an inventory/recommendation, not
authorization to enable providers, run paid models or start another code batch.
Upstream was pinned to `aa8e5b1bc4895267f98abe59c87dfed8a22bf35f`
(main, committed 2026-10-26T21:19:15Z). Earlier acceptance receipts are adopted;
current source and explicit preview state were checked separately. The old
opening status incorrectly described structured relationships as unimplemented;
it is corrected above against the accepted source and native publication receipts.

| Area | Current OpenAlice evidence and remaining gap | Suggested priority |
| --- | --- | --- |
| Multi-source intake | RSS/RSSHub, trusted modules and X/FMP producer artifacts exist. Eight public feeds have since been exercised through real collection/repeat/restart; default MarketWatch/WSJ endpoints were corrected, while Nikkei still lacks dates/bodies (see the verification below). X/FMP actual service acceptance is still open. General configurable web/JSON readers, a dedicated WeChat path and external push intake are not an equivalent ready-to-use six-family product. | First: finish the required financial sources and their time/body quality, without treating all six types as a release prerequisite. |
| Original body and translation | Feed bodies/provider summaries are retained and missing bodies are explicit. A shared missing-body extraction/retry pipeline and reader-facing full original/translated-text flow are not established. Chinese event summaries are already possible through native preparation. | First: improve evidence completeness and publication-time quality. |
| Continuous preparation and new-field backfill | Existing Issues run bounded native batches and durable pending/review/failed states exist. Sustained intake/follow-up acceptance remains open. `NEWS_PREPARATION_WHAT` only explicitly backfills importance/transmission; comparisons and association snapshots have tools/guidance but are not guaranteed per-event scheduled outputs. | First: wire and accept generation, review and missing-field backfill using the existing native runner. |
| Candidate recall and correction | Native instructions distinguish same occurrence, follow-up, unrelated and roundup. Current reading relations match exact stored labels/codes. There is no equivalent dedicated embedding/lexical candidate-recall service or complete reader-facing merge/split/reassignment correction workflow in the inspected News surface. | After the data path: bounded retrieval and supported corrections, not a second model loop. |
| Financial quality evaluation | Software regression tests establish schemas/state/navigation, not model accuracy. No equivalent financial gold-set evaluation for importance, event relations and comparative event digests was found in the inspected News owners. Upstream double scoring and SelectBench are references; two model calls are not an approved financial requirement. | Build labelled financial cases and measure missed/false-important/false-merge/fabrication cases. |
| Editions | No dedicated News daily/weekly/monthly edition product or its event-level inclusion/continuation rules. Existing Issues/Inbox can host the eventual schedule/delivery. | Later: start with a useful market morning brief. |
| News operations and cost | Source health, retry, processing holds and execution history already exist. The collection cadence is global/fixed. No equivalent news-provider paid-request ledger, outcome reuse or per-window budget circuit breaker; SDD explicitly records this limit. | Before sustained paid intake: receipts/budgets; then source cadence and actionable alerts. |
| Secondary reader/output features | Topic filters, keyword/original search, bookmarks and internal API/MCP/CLI already exist. Rich curated topic archives, semantic retrieval, a dedicated bookmark/settings import-export UI and outbound News RSS/Agent Markdown endpoints remain broader product gaps. | Lower priority; retain the existing News panel. |

Upstream primary references: [sources](https://github.com/KKKKhazix/AIHOT/blob/aa8e5b1bc4895267f98abe59c87dfed8a22bf35f/docs/sources.md),
[selection and editions](https://github.com/KKKKhazix/AIHOT/blob/aa8e5b1bc4895267f98abe59c87dfed8a22bf35f/docs/selection.md),
[grouping](https://github.com/KKKKhazix/AIHOT/blob/aa8e5b1bc4895267f98abe59c87dfed8a22bf35f/docs/grouping.md),
[digest comparison](https://github.com/KKKKhazix/AIHOT/blob/aa8e5b1bc4895267f98abe59c87dfed8a22bf35f/docs/story-digest-evaluation.md),
[architecture](https://github.com/KKKKhazix/AIHOT/blob/aa8e5b1bc4895267f98abe59c87dfed8a22bf35f/docs/architecture.md).
Grouping and request-receipt source, the WeChat adapter and selected documented
failure/empty-body/unknown-outcome conditions were also inspected. This is
source/document evidence, not an upstream deployment or paid-service run.

Local anchors: `docs/news-reading.md`, `docs/news-modules/sdd.md`,
`src/domain/news/{reading-contract.ts,relations.ts,stories.ts}`, the collector
`rss.ts`, managed `src/webui/routes/news-automation.ts` prompt and the native
`default/skills/alice/references/news-events.md`. The preview GET automation
response had an empty automation list; its selected-home configuration had
`enabled:false`. No collector, external message or model call was started.
Raw upstream snapshots are outside the repo at
`F:/temp/openalice-aihot-gap-20261027`; the initial guessed pipeline/digest URLs
were not sources, and cache-missed pinned pages were verified with direct
commit-pinned raw reads instead.

Recommendation, not a newly approved implementation plan: reliable required
sources/body completeness → sustained preparation including new-field backfill
→ financial quality cases/corrections → morning brief. Keep all financial
originals: importance affects prioritization, not original retention. Upstream
model boards, Codex reset monitoring and topic milestones are explicitly named
as non-open-source online features in its README, not code to promise to port.

## Public financial intake verification (2026-10-27)

The existing collector was exercised against real public feeds in a new isolated
home; no collector timer, preparation Issue, native model, credentialed producer
or UTA was started. Multi-source RSS intake already works. The remaining work is
source-specific quality and sustained operation, rather than a technical blocker
on implementing the feature.

| Conclusion | Actual verification | Result and limits |
| --- | --- | --- |
| Public multi-source collection and durable recovery | Production `NewsCollector` / `NewsCollectorStore`; initial fetch, repeat and a newly initialized store | Fed, ECB, WSJ Markets, CNBC Economy, Nikkei Asia, SCMP Business and CoinDesk initially archived 210 distinct records; repeat and restart each added zero. Initial MarketWatch HTTP requests timed out without stopping the other feeds. |
| MarketWatch default repaired | Real HTTP timeout versus HTTPS 200 followed by production collection, repeat and restart | The default/catalog now uses HTTPS; ten records archived, then zero additional records in both repeat checks. |
| WSJ Markets default repaired | The old feed's latest publication was 2025-01-27; the publisher's current Dow Jones feed was fetched, parsed and collected | The new default returned 61 records including recent publications; 57 were new to the isolated archive. Both repeat/restart checks added zero. Existing stored custom URLs remain unchanged. |
| Original evidence and time quality remain explicit | All archived identities checked; earlier bytes checked as an unchanged prefix; per-source publication/body counts inspected | Final isolated archive has 277 unique records across eight source labels. Nikkei supplies neither publication dates nor bodies for all 50 items; ECB supplies no bodies for its 15 items. These sources must not be counted as complete financial evidence or all presented as newly published news. Low-frequency official announcements are not judged failed by age alone. |
| Regression and catalog consistency | Four owning test files; latest configuration test repeated after the second URL change; regenerate source catalog | 54 tests passed, then all 11 configuration tests passed against both corrected URLs. Generated documentation differs from its pre-task snapshot only in those two source rows. |
| Owning typecheck and patch hygiene | Root `tsc -p tsconfig.json --noEmit --pretty false`; scoped `git diff --check` | Both exited 0. Original preview archive SHA-256 remains `8918387C526EB07168588A1F9521A75F0AD0C35D046FA52E6574C92377B4C9C4`; its collector configuration remains disabled. |

Only the two default/catalog URLs changed in production code; no schema,
persisted configuration, historical archive, reader UI or second scheduler was
added. User-selected feed URLs are not silently migrated. The existing preview
remains collection-disabled with its original data; this receipt is isolated
collector verification, not an enabled desktop/app deployment or a 24/7 claim.

Raw receipts and rerunnable assert-based probes are under
`F:/temp/openalice-news-intake-live-20261027`: `receipt.json` records the initial
seven successes and HTTP failure; `marketwatch-receipt.json` and
`wsj-markets-receipt.json` record the corrected live sources and recovery. The
final archive SHA-256 is
`bf4abf73ea51a103483477b333db7b22dd794027093755047edb5dc175d13a84`.
Source health is still process-local. Sustained arrivals/availability, Chinese
RSSHub instance/routes, X/FMP account acceptance and missing-body retrieval
remain open; these do not block the public sources already verified here.

## Maintainer's urgent scope (2026-10-24)

The maintainer prioritizes four capability groups for the financial news
module: hot events / heat trends / new-event markers; topics / search /
bookmarks; automatic grouping / continuing follow-ups / review; and multi-source
collection. These are the next delivery scope, not an assertion that the full
upstream feature set must ship together. The coverage matrix below remains a
record of the wider gaps.

Deliver the collection and continuous-preparation foundation first, then the
reader discovery features over those same events. All four groups belong to
this requested increment; editions, double scoring, full translation, outbound
RSS and preference backup are outside its immediate critical path.

| Order | Requested capability | Minimum useful result and acceptance |
| --- | --- | --- |
| 1 | Reliable multi-source intake | Keep the working RSS/RSSHub path and original evidence. Show each source's latest successful collection and failures. Verify any additional JSON/web/X/FMP adapter with its actual configured provider before counting it as connected; complete coverage of all six upstream source families is not a prerequisite for the first usable release. |
| 2 | Automatic grouping, continuing tracking and review | Newly arriving originals enter an explicitly configured recurring native Issue/Session; same occurrence joins an existing development, a direct follow-up adds a development, and unrelated events stay separate. Pending, failed and uncertain work remains visible and recoverable after restart. Existing events and human corrections survive retries; every result links to originals. Reuse the existing scheduler and native model loop. |
| 3 | Hot events, trends and new-event markers | Rank deduplicated independent participants with publication-time decay. Distinguish a newly observed event from a later development or another report of an old event. Persist comparable observations for rising/falling trends; show insufficient history/coverage instead of inventing a direction. Explain the heat basis and keep it separate from financial-impact analysis. |
| 4 | Topics, search and bookmarks | Navigate prepared event topics, find events and their original evidence beyond the current screen, and save/remove stable event bookmarks that survive restart within the same AliceProject. Existing keyword/category filters are the starting point, not proof that all discovery work is finished. |

Verification must include incoming material through the enabled recurring path,
an actual follow-up, an unrelated same-topic item, a retry/restart and review of
an uncertain relation. Reader checks must cover heat de-duplication, missing
trend history, new event versus new development, search of older evidence and
bookmark persistence. Fixed-batch preparation and screenshots alone do not
satisfy this increment.

- [ ] Connect and verify the recurring preparation/review path and its durable
  pending/failure handling.
- [ ] Verify the additional providers actually configured for this deployment;
  retain explicit unverified status for X/FMP until live acceptance exists.
- [x] Deliver heat/trend/new markers from the same prepared events.
- [x] Deliver topic navigation, search and persistent event bookmarks.

The implementation evidence below supports the checked items. Recurring
preparation has one real scheduled batch and recovery tests; sustained incoming
collection/follow-up acceptance remains open. The held branch and existing
paid-provider/task activation boundaries still apply.

## Three compact News widgets (2026-10-25)

The maintainer asks to deliver the next three proposed widgets: an economic
calendar preview, a compact event timeline and event-linked asset prices.
Keep these inside existing News surfaces, with inline interaction and the
accepted theme/density. The current branch/PR hold and no-publishing boundary
continue. Collection and native preparation remain paused.

Ruling: expose the already implemented economy-client calendar through the
first-party reference service/API and native board tool. Reuse its existing
provider, cache, credential path and hub fallback; no new collection engine or
provider activation. Missing access is an explicit unavailable state. Keep real
zero values; don't guess a timezone or countdown for naive/date-only timestamps.

Ruling: timelines show only actual stored developments and exact report links.
They do not manufacture milestones or classify reposts as new facts. Asset
cards use only explicit supported codes already in the event; no company/topic
inference, default stock list or causal price claim. Reuse existing daily bars
and charts, loading only inside the opened event to bound requests. Unsupported
or absent codes remain visible as unavailable rather than silently rewritten.

- [x] Economic calendar contract, existing FMP zero-value correction, service /
  route / native-tool / UI / demo integration, time/value/error regressions.
- [x] Compact progress timeline with exact evidence actions and event asset
  cards using the existing quote/chart UI; preserve inline reading and focus.
- [x] Owning tests/types/build, one scoped independent review and actual
  desktop/375px acceptance; record unverified calendar/asset data explicitly.

Evidence and exact baseline: `F:/temp/openalice-news-widgets-20261025`.

Local component acceptance: **22/22** backend/provider/native-tool tests and
**61/61** UI tests pass. Backend RED reproduced two missing behaviors, including
zero values becoming null. UI RED reached four failing timeline/asset assertions;
the initial calendar worker failed to start, so it is not calendar feature RED.
Root, registered-test, UI and provider-package typechecks pass; provider-package,
backend and UI builds pass. Initial UI GREEN exposed two title-query ambiguities
from the new timeline and two calendar preview text queries plus retry; semantic
query scopes and separate preview text nodes now verify the intended behavior.
The final UI build keeps old unused hashed assets for this preview, not release.

One fresh read-only `news_widgets_review` found no actionable P1/P2 in the
owned delta. Another session edited the shared advanced-filter UI, locale keys
and page tests during this increment. The overlap was inspected under
`orchestrated-collaboration`; those changes were retained and excluded from
our feature claims. No competing Run or implementer was started. Shared files
were held read-only after widget integration. A final owning UI typecheck,
**30/30** composed page/navigation rerun and UI rebuild pass with before/after
hashes proving the shared source stayed stable during those checks. This rerun
overlaps the 61 tests; it is not an additional 30 distinct assertions.

Actual isolated preview: `http://127.0.0.1:47359/market/news?view=important`,
foreground exec session 85564, no detached-start retry after the earlier policy
denial. The first request ran before listeners were ready and is not data
evidence; subsequent readiness and HTTP checks pass. The four real copied
events retain revision 4 and the original archive SHA-256. Each currently has
one recorded development and no supported asset code. Real keyboard timeline
activation opens all three originals for that particular development and
focuses their H4; it does not substitute the transmission's two citations.
Desktop/375px real-reading checks have no document overflow or dialog.

Calendar access remains **unverified**: this isolated home intentionally has
no copied market-data credentials. The API returns a sanitized 502 and the real
UI exposes unavailable/retry. The actual native `traderhub board get --help`
advertises `economic-calendar`; executing it reaches the same explicit
unavailable result (exit 1), not a successful live-calendar read. This does not
prove whether the user's other AliceProject has provider access. An optional
question asks for the existing provider name, without requesting a secret.

Separate browser-only fixtures, prominently labeled non-real news/non-real
calendar, verify three calendar value rows (including zeros), three development
nodes and supported-asset display. AAPL daily bars and the opened chart were
read from the existing yfinance-backed price service; that does not establish
a real event/AAPL link. Desktop and 375px show a real chart curve with no
document overflow, and closing it returns focus to the AAPL control. Mock
routes were removed and the browser returned to real copied events. No fixture
news/calendar was written to the archive, and no reader flags were changed.

Collection/preparation remain paused, UTA disabled, no provider or credential
activation, no commit/push/PR update/merge/release. The other four proposed
overview/heat/distribution/freshness widgets remain outside this three-widget
increment. Actual calendar data and verified event/asset identity stay explicit
data-acceptance gaps rather than being filled with examples.

## Readable event data increment (2026-10-25)

The maintainer accepts making each existing News row explain latest changes,
possible transmission and evidence at first glance. Preserve the accepted panel,
inline details, theme and navigation; the preceding importance presentation is
visually accepted. Work remains on the held branch without GitHub publishing.

Ruling: add a bounded, evidence-linked `transmission` analysis to the existing
unreleased event artifact, not a second entity/relationship database. A path
contains 2–5 short steps, a concrete condition and distinct report IDs from the
event, or explicit null when no defensible path exists. Native preparation
reassesses it on each revision. This is conditional analysis, not a verified
country/industry/asset identity, an observed market response or a ticker guess.
The broader financial-relationship design below remains incomplete.

Ruling: count identifiable publishers across the event's stored evidence,
separately from 48-hour heat participants and collection-channel labels. Official
source metadata indicates source type, never independent factual confirmation.
Keep raw heat, source-channel names and full overview inside inline details.

- [x] Validate native transmission publication, legacy reads, exact references,
  bounded backfill and known managed-prompt upgrades; preserve human overrides.
- [x] Show latest change, conditional path and clear evidence counts in each
  row; expose exact originals in place, with four locales and demo parity.
- [x] Verify focused backend/UI regressions, types/build, one scoped review and
  actual desktop/375px display using copied originals in an isolated preview.

Evidence/baseline: `F:/temp/openalice-news-scan-20261025`. Collection and native
scheduling remain paused. Existing originals and unrelated dirty work survive.

Local acceptance: **34/34** backend/native tests and **61/61** UI/navigation tests
pass; the final demo projection rerun passes **14/14**, and the final managed
prompt rerun passes **13/13**. These reruns overlap the preceding totals. The
backend RED reproduced three missing behaviors. Initial UI thread workers failed
to start before assertions; a fork run reached the tests, and the completed
five-file fork selection exits zero. The four intermediate UI failures were
one nested-list selector and three expectations superseded by the approved
hierarchy; assertions now check latest facts and open details before inspecting
source labels/unknown heat history. No timeout/dependency/config changes.
Root, registered-test and UI TypeScript checks pass; the initial UI check caught
undefined metadata in the demo adapter, corrected to its existing null contract.
UI/backend builds pass; preview UI build retains prior unused hashed assets.

One scoped read-only reviewer found outdated custom-prompt recovery copy. All
four locales now explain both required assessments, including explicit null
when no supported transmission exists; the reviewer found no remaining P1/P2.
This increment does not claim full repository, release or entity-graph acceptance.

Real native publication updates the four copied events to revision 4: two have
conditional, evidence-linked paths and two explicitly have no supported path.
The original source home stays at revision 2. Real first-screen inspection also
exposed archive IDs/raw timestamp strings inside old development summaries;
the current native turn prepared concise factual summaries, and the native
prompt/reference now instruct future preparation to keep operational metadata
in evidence fields. Existing reader importance/bookmark overrides survive:
the current Important list includes two automatic judgments and one existing
human designation, not three automatic importance claims. Source archive hash
still matches the copied archive and the preceding acceptance record.

Desktop and 375px browser checks confirm wrapping paths, full conditions,
no document overflow, keyword search of a path, and keyboard evidence activation
that opens exactly the two cited originals and focuses their H4 without a
dialog. No reader flags were changed for acceptance. New isolated preview is
`http://127.0.0.1:47357/market/news?view=important`. Automatic review rejected
hidden detached startup with only “blocked by policy”; the safer foreground
preview is tracked by exec session and may stop when the session ends. No
workaround detached process was launched. Running bundle differs from final
bundle only by the final prompt copy about concise summaries; assessment/store
behavior is the same. Zero native schedules, collection disabled and UTA disabled.
No commit, push, PR update, merge or release.

## Automatic importance correction (2026-10-25)

The maintainer challenges the manual-only default and cannot currently inspect
the preview. This supersedes the previous exclusion of AI importance assessment.
Implement within existing native event preparation, without a second model
loop, paid-provider activation, scheduler activation or a new UI workbench.
Retain the held branch and all earlier changes; no publishing to GitHub.

Builder choices: a versioned event can carry an optional `importance` assessment
with `important`, `normal` or `uncertain`, a brief conditional reason and exact
supporting report IDs. Legacy events remain unassessed. Every automatic native
publication must include this assessment and reevaluate on each revision.
An explicit reader override wins; otherwise source importance or an important
automatic assessment qualifies for the existing list. Heat/selected/tickers
do not stand in for assessment. Normal and uncertain events stay readable.

- [x] RED/GREEN assessment validation, native-publication requirement, discovery
  projection and preservation of human overrides; update native prompt/skill and
  continuous-publication fixtures.
- [x] Show the automatic assessment and its exact evidence inside existing
  event details, with four locales and demo parity; preserve inline reading.
- [x] Verify relevant tests/types/build, one fresh scoped review and actual
  archive-backed preparation/display. Restore a durable detached preview using
  an isolated home; port 47355 stopped after the earlier foreground run ended.

Baseline/evidence directory: `F:/temp/openalice-news-auto-importance-20261025`.
Ongoing collection/preparation stays disabled pending separate activation;
current native coding-agent analysis can prepare the bounded local evidence.

Local acceptance: **41/41** backend/native integration tests, **62/62** UI and
navigation tests, and **24/24** owning Issue-mutation regressions pass. Root,
registered-test and UI TypeScript checks and UI/backend bundles pass. Backend
assessment RED had three expected failures; the managed-prompt upgrade also
had a failing regression before its fix. Initial UI fork-worker startup failed
before feature tests ran; the final pinned installed Vitest run uses threads
and exits zero. No timeout, dependency or test configuration changed. The
preview-only UI build retains old unused hashed assets; it is not a release
artifact or a full repository gate.

One fresh scoped reviewer found the existing paused Issue still retained its
older managed What. Enabling now upgrades that exact known prompt, preserves
custom text with an actionable review error, and compares the previously read
What again at mutation. Custom pause/resume, known-prompt upgrade and conflict
tests pass. This check does not add cross-process locking.

Real acceptance published four evidence-backed revision-2 assessments through
the native `publishNewsStory` CLI gateway: two important, one normal and one
uncertain. These are the current coding-agent's judgments against the copied
RSS originals, not a scheduled unattended run or full publisher-page research.
No manual importance override was used. Actual desktop/375px browser checks
confirm the two headlines, inline assessment, exact cited originals and focus,
with no browser errors or horizontal overflow. The detached isolated preview
at port 47355 is restored; zero preparation tasks are active, collection and
UTA remain disabled. Original archive SHA-256 is unchanged and matches the
preview copy (`8918387c526eb07168588a1f9521a75f0ad0c35d046fa52e6574c92377b4c9c4`).
The final backend bundle passes; the running preview predates only the internal
conflict-error detail/type correction, with the exercised assessment path
unchanged. Runtime/source hashes and individual receipts live in the evidence
directory. No commit, push, PR update, merge or release occurred.

During preview setup, a PowerShell `$home` collision created seven test copies
in a new host `data` directory. No existing files were overwritten. Exact-hash
deletion was rejected by automatic review; the verified new directory was
instead moved intact to `accidental-host-copy` in the evidence directory.
The host directory is absent, originals are unchanged, and all seven copies
remain recoverable. Corrected scripts use a task-specific variable, checked
F-drive paths and terminating errors. Recovery receipts record the boundary.

## Jin10 important events increment (2026-10-25)

Maintainer asks to keep Jin10 as a repository reference and add important events.
Scope: a compact three-headline block in the existing News panel, inline opening,
the complete Important view, explicit source importance and reversible reader
overrides. Builder default after optional classification clarification: source
tags plus manual designation, without heat/keyword/selected-based inference or
AI invocation. Reference: `docs/reference/jin10-news-reading.md`.

- [x] Persist the optional importance override in the existing unreleased v1
  reader sidecar; derive source importance from declared category tags, filter
  events and raw important reports before pagination/limits, validate API input.
- [x] Add the three-headline block, Important view, inline open/focus and event
  mark/unmark controls; preserve raw source-important material and four locales.
- [x] Verify persistence, override/filter boundaries, UI/routing, types/build,
  one fresh scoped review and real desktop/narrow preview. Preserve originals,
  disabled preparation, optional UTA and the held branch; no publishing.

Exact task baseline/evidence directory:
`C:/Users/Administrator/AppData/Local/Temp/openalice-jin10-important-20261025`.

Local acceptance: backend **20/20** and final UI **78/78** tests pass. Backend
RED had three expected failures before importance existed. Initial UI RED could
not start its worker (zero tests); that invocation is not feature evidence.
Subsequent runs exercised all eight UI files, including actual feed lifecycle,
API client, demo handlers and registered Router/tab navigation. Root and
registered-test TypeScript checks pass; the final owning UI TypeScript check
and UI/backend bundles pass. Final preview UI build retained prior unused
hashed assets with `--emptyOutDir false` to avoid repeated Windows cleanup;
this is local preview acceptance, not a release artifact or full repository gate.

One fresh read-only `jin10_important_review` found two P2 issues. Both were
accepted and fixed with regressions: keyword ordering RED (1/4 failed) → GREEN;
one-shot open/focus after filter change RED (one selected case failed) → GREEN.
Actual browser testing then exposed the real URL-adoption/query-load handoff:
the request could be consumed by the previous result before Important loaded.
The delayed-adoption/deferred-response regression reproduced that failure;
the feed now projects only results of its completed query, and only the
destination consumes the mount-time request. Final suite 78/78, followed by
actual successful inline open/focus and filter-focus receipts. The strip/list
also reject missing/false importance (RED 1/4 failed → GREEN), rather than
substituting `selected` or high-heat events.

**Original ruling (AI exclusion superseded by the correction above):** upstream classification quality, sustained acquisition and AI
importance scoring remain outside this increment. Explicit manual/source
designation is the builder default; no new native-model or ingestion work ran.
Existing unversioned legacy clients are not a release compatibility promise;
the sidecar is part of the same unreleased reading increment.

Runtime acceptance uses a new isolated preview at
`http://127.0.0.1:47355/market/news?view=events`, PID/home recorded in
`runtime/preview-process.json`. Automatic approval rejected replacing the old
preview process with only “blocked by policy”; it was left running. The safer
preview copied only the 12 news originals and four event artifacts into a fresh
test home, with collection disabled, no schedules and UTA disabled. No secrets,
broker configuration or production project state were copied. Old port 47351
has not received the updated backend; use 47355 for this increment.

Desktop 1440px and narrow 375px checks verify three marked headlines, reload
persistence, keyboard activation, matching inline evidence without a drawer,
focus on the opened heading, and stable source-filter focus after collapse.
The 375px document width remains 375px. Clearing the three temporary test
designations leaves zero important events and focus on the surviving list;
all four prepared events remain available. Empty-state/current-preview
screenshots, source/build hashes and receipts are in the evidence directory.
Browser errors: zero. Both original and copied archives retain SHA256
`8918387c526eb07168588a1f9521a75f0ad0c35d046fa52e6574c92377b4c9c4`.
HEAD remains `1b6684e734a6bfda5ba6edf31b5f82085891646e` on the held branch;
no commit, push, PR update, merge or release.

## Accepted native News display components (2026-10-25)

The maintainer accepts the recommendation to keep OpenAlice's own data and
build News Feed + a market strip + mini price charts after checking TradingView
widgets' data limitation (“可以”). This supersedes the earlier pending data
question. Implement in the existing News panel/style, with inline expansion and
no external Widget/script/iframe. Preserve the held branch and unrelated work;
no commit/push/PR update/merge/release, trading writes or paid-feed activation.

**Goal:** make the existing news stream easier to scan and pair it with useful,
honest market background in the same panel.
**Architecture:** native NewsMarketContext uses the existing useMarketBars /
barsApi boundary and configured vendor. Four compact daily-bar tickers load
independently; selecting one lazily opens an inline Recharts mini chart with
date/source and explicit loading/error/empty states. Keep original news queries
independent of market context. NewsStories gains source names, clickable topics
and source-heat rank for Hot while preserving summaries, evidence, bookmarks
and inline detail reading. No backend or persisted contract change.
**Tech stack:** existing React/TypeScript/Tailwind, Recharts/MeasuredChartFrame,
market formatters and vendor bars. No new dependency or service.
**Builder choices:** use up to four watchlist assets; when empty, show S&P 500,
Shanghai Composite, gold futures and BTC/USD. These are general market context,
not inferred story associations. Show each source's actual latest daily record;
compute the change versus the preceding daily record's close field, with zero-denominator and
missing-data handling. Do not imply a realtime quote or a causal news reaction.

- [x] Task 1 — RED/GREEN native market strip and mini chart. Add
  NewsMarketContext.tsx/spec; reuse useMarketBars for lifecycle/polling and keep
  news usable during all/partial market failure. Respect configured vendors and
  preserve source/date. Check default/watchlist selection, null/zero prices,
  daily change, lazy chart/range selection, retries, collapse and stale responses.
- [x] Task 2 — RED/GREEN News integration and reading hierarchy. Wire the strip
  into NewsPage; improve NewsStories with publisher labels, topic actions and
  real Hot rank offsets. Update adjacent specs and the existing navigation
  fixture so unrelated news routing tests do not fetch external bars. Source
  and topic data remain evidence metadata, not verified country/impact links.
- [x] Task 3 — four locales, owning guides, relevant UI/navigation checks,
  owning typecheck/build, one fresh scoped review and actual desktop/narrow
  preview. Preserve the original archive, paused preparation and optional UTA.

Evidence/baselines:
`C:/Users/Administrator/AppData/Local/Temp/openalice-news-display-20261025`.
Initial read-only existing API probes return real S&P 500 daily history and
Shanghai/gold latest daily bars through the configured yfinance vendor. This
does not prove realtime/exchange-wide coverage or connect new collection feeds.

Local execution/acceptance: the exact pre-task snapshots and test receipts are
in that evidence directory. The initial two integration assertions fail before
the new market region/rank exists. Final focused UI tests pass **49/49** across
NewsPage, NewsStories, NewsMarketContext, useMarketBars and real News navigation.
The UI build (including its owning TypeScript check), integration TypeScript
check and scoped whitespace check exit 0. Four locale key shapes compile.

Final review: one fresh read-only `news_display_review` checked only this task's
delta against its snapshots, preserving earlier held work. One P2 was accepted:
**Ruling:** provider daily records can still be in progress; “Daily close” would
overstate what the source establishes. Four locales now say “Daily record” (and
equivalents), without changing the source's close-field arithmetic.
Final: fixed daily-record label — regression RED (8 pass/1 fail) → GREEN;
final focused suite 49/49. Reviewer otherwise found no material issues.
**Ruling:** sustained collection, structured financial relationships and upstream
accuracy remain separate acceptance boundaries; these display components neither
implement nor establish them. No second reviewer or implementation delegation.

Actual built preview on `127.0.0.1:47351/market/news?view=hot`: desktop 1440px
and narrow 375px checked. Four named-source rows retain full summaries and Hot
ranks; topic action filters to the matching event. Opening/changing the market
chart preserves that topic/query; 1M/3M/1Y render 22/64/251 actual SPX observations.
Keyboard close returns focus to the originating ticker. The narrow strip scrolls
345px within a 375px viewport (720px strip content), without document overflow;
BTC chart remains available at the far end. Inline evidence opens three originals
and focuses their heading without a dialog. Final browser errors: zero.
Three historical ticker values/changes and all four source/dates match fresh
existing-API probes; BTC's in-progress daily value revised between snapshots,
consistent with the five-minute strip refresh rather than a realtime quote.
The archive SHA256 remains
`8918387c526eb07168588a1f9521a75f0ad0c35d046fa52e6574c92377b4c9c4`;
preparation is canceled/disabled and UTA remains optional/disabled in preview.
HEAD remains `1b6684e734a6bfda5ba6edf31b5f82085891646e` on the held feature
branch: no commit, push, PR update, merge or release. Final source/build hashes,
screenshots and browser receipts are recorded with the evidence directory.

## Accepted map reading components and News follow-up (2026-10-25)

The maintainer explicitly accepts country hover cards, a country indicator
history curve and an interactive legend: “可以 先做这三个出来看看”. Later steering
adds that News presentation is the main concern and supplies TradingView's widget
catalog. The three map components remain authorized; the later accepted native
News display increment above records the News choices, implementation and
acceptance separately from the map work.

**Goal:** complete those three map reading interactions in the existing panel.
**Architecture:** reuse the house Base UI Tooltip for an SVG country trigger,
existing Recharts/MeasuredChartFrame for actual supplied observations and a
five-range legend over the current comparable values. Keep the accepted China
geometry grouping, inline details and period/zoom state. No new data source,
endpoint, dependency, database, scheduling or model call.
**Spec:** the accepted three-component description in chat; keep existing style,
no drawer or separate workbench. A country click/keyboard selection remains the
primary interaction and reveals the same curve on touch devices.

- [x] Task 1 — RED/GREEN hover/focus card and interactive legend in
  GlobalMacroMap.tsx/spec. Card shows the selected metric's real value/date or
  explicit absence. Legend hover/focus highlights matching countries; tap pins
  a range, Escape clears it, metric/period changes reset it. Keep zero/negative
  values and constant/no-data ranges honest; preserve selection and Taiwan's
  shared China path.
- [x] Task 2 — RED/GREEN GlobalMacroHistory.tsx/spec and map wiring. Country
  selection shows the current indicator's actual finite series with the chosen
  period marked. Missing observations break the line, no history stays explicit,
  a single point is not turned into a trend. Reuse existing chart/theme tokens.
- [x] Task 3 — four locale sets, owner guide, relevant UI tests, owning
  typecheck/build, desktop/375px pointer/keyboard preview and one fresh scoped
  review. Preserve held branch, original archive and disabled preparation.

Evidence/before snapshots:
`C:/Users/Administrator/AppData/Local/Temp/openalice-macro-components-20261025`.
News follow-up inspection: existing Latest/Events/Hot/Bookmarks, topics, summary,
inline developments/originals and evidence links already work. Main presentation
gaps include rank hierarchy, readable source presentation and richer topic
discovery; structured country/industry/asset relationships are a data contract
gap. Do not count existing functionality as missing. TradingView's official
Widget data FAQ says its widgets cannot consume our own data; native imitation
versus an external TradingView feed is a material product choice. An async
question is pending; no external widgets have been embedded.

Current execution evidence:
- `map-red-final.json`: six original assertions pass, three expected failures
  identify the missing hover card, legend interaction and history figure before
  product edits.
- Initial `green.json`: 20 pass/three fail. History mounting in the map test
  needed the same measured-frame fixture boundary used by existing chart tests;
  the local tooltip needed an explicit `role=tooltip`. Both were corrected.
- The next broad focused invocation was interrupted after an extended shared
  module-load stall and reported only three completed history assertions in
  `green-final.json`; do not treat that partial receipt as full acceptance.
- Fresh scoped `macro_components_review` found a P2: isolated observations
  disappeared when dots were disabled for multi-point histories. Added a real
  Recharts separated-points regression; `dots-red.json` passes three and fails
  that new assertion with zero dots instead of two. Retain small dots on actual
  observations, leaving null gaps intact. Same reviewer rechecked the fix and
  found no remaining material static issue.
- Final relevant run `focused-final.json` executes four files/24 assertions,
  all pass, exit 0. Dedicated history tests render actual Recharts; only the
  frame's physical dimensions are supplied by a fixture.
- The initial UI build caught missing plural-count translation keys in three
  locale sets. Added the required keys; final owning UI typecheck/build exits 0
  in `build-final.*`. No test timeout, dependency or project configuration edits.
- Temporary source preview on 47353 was not accepted as browser evidence: its
  initial dependency optimization left a blank page during inspection. The
  owned dev session was stopped, the port is closed, and the pinned browser is
  restored to the normal built preview on 47351. Final browser acceptance waits
  for the built UI in that initial probe; no DOM/style patch was used.

Final built-preview acceptance is complete. `final-acceptance.json` binds all
six product-source hashes (unchanged since before the final build started), the
built UI index, four files/24 passing focused assertions, build exit 0 and eleven
actual browser receipts. Desktop hover and keyboard focus show the country card
with the source metric/date; Enter selects Germany and loads its actual curve.
Legend hover dims nonmatching countries, click pins the range, Escape clears
it, and selecting another period resets it (`browser-legend-*`,
`browser-period-reset.log`). Every country's opacity is checked against the
actual API. China's path still includes Taiwan and remains one map control.
China's curve has exactly 60 real dots. US CPI 2025-10 explicitly has no selected
observation while retaining 59 actual history dots; Japan CPI shows no history,
not a manufactured series (`browser-history-gap.log`,
`browser-history-empty.log`). At 375px the range controls are usable, the full
curve renders and document width remains 375px (`browser-mobile.log`, inspected
`macro-components-mobile.png`). The inspected desktop card/curve and pinned
legend PNGs match the established panel. No recorded browser page errors.

Original archive hash is unchanged and preparation remains disabled. The owned
temporary dev server is stopped; normal preview is restored to 1440x1000,
Chinese, China selected. This completes the three accepted map components.
News presentation/provider-choice follow-up remains pending the maintainer's
answer; no News code, external widgets, providers, paid jobs or acquisition
settings were changed. No full UI-owner rerun, packaged/physical-mobile test,
commit, push, PR update, merge or release for this increment.

## China map selection correction (2026-10-25)

The maintainer requires Taiwan to share China's coloring and selection, with
no separate Taiwan label. The original source dataset has a separate TW path;
the renderer now appends that path to CN and renders one China hit/keyboard
target. The raw geometry and statistical records are unchanged; no separate
macro row or extra country count is created. Scope: map renderer, one regression
test, UI owner guide/source notice. Evidence and before snapshots live in
`C:/Users/Administrator/AppData/Local/Temp/openalice-china-map-20261025`.
Actual original-preview RED: China path lacks the Taiwan geometry, recorded in
`browser-red.log`. First isolated UI test invocation reported no executed
assertions and is not accepted as test RED; a retry and final checks follow.
The broader component inventory is deferred while this explicit correction is
handled. Preserve the held branch; no publishing.

Completed: `green.log` executes and passes both affected UI files, 15 assertions;
`build-exit.json` reports exit 0 for the owning UI typecheck/build. Two earlier
isolated invocations did not start a worker within the existing timeout and
executed no assertions; neither is relabeled successful. The actual browser RED
above remains the reproduction evidence. Built-preview `check-map.js` verifies
the China path contains the exact Taiwan subpath, its center hits the same China
control, both regions share fill/stroke/selection, and no separate Taiwan label
exists. Genuine desktop and 375px mouse clicks at the Taiwan position change
the country from US to China (`browser-after-click.json`,
`browser-mobile-click.json`); inspected desktop/mobile PNGs match. There are
175 rendered region groups over the unchanged 176 supplied source geometries;
data coverage counts are unchanged. `final-acceptance.json` binds source, raw
geometry and built-index hashes, checks and held branch/HEAD. Browser errors are
empty. Desktop is restored with China selected. No full-suite rerun, backend
change, commit, push, PR update, merge or release for this small correction.

## Accepted macro timeline increment (2026-10-25)

The maintainer explicitly confirms the missing bottom historical time scrubber
(“是的 我缺个这个”) after the full description: connect real history, add a
bottom timeline, and update map colors, values and dates together. Implement
that correction inline on the held branch; no further approval, publishing,
paid-provider activation, or unrelated changes.

**Goal:** scrub real macro observations inside the existing Global Macro panel.
**Architecture:** retain five years of observations already returned by the five
batched OECD calls, expose optional per-cell history in the existing board API,
and prefer a history-capable hub response or build the board locally. If local
history fails completely, preserve a usable hub snapshot with an explicit
history error. Never combine a hub snapshot with another source's history.
**Tech stack:** existing React/TypeScript, native range input and buttons; no new
package, persisted state, endpoint, source configuration or trading dependency.
**Spec:** the confirmed timeline description above. Five years is an
implementation choice; actual available observation periods define the steps.
Latest source revisions are observation history, not point-in-time vintage data.

- [x] Task 1 — RED/GREEN backend history retention and service resolution.
  Touch reference/global-macro.ts and service.ts plus adjacent specs. Preserve
  latest cells, finite zero/negative values, normalization, per-indicator errors,
  sorted unique valid dates, five batched requests and six-hour caching. Add
  optional cell history and board historyError to UI/backend contracts. Test
  history-capable hub, snapshot-only hub, local failure and invalid points.
- [x] Task 2 — RED/GREEN bottom timeline and historical value projection.
  Touch GlobalMacroMap.tsx/spec and MarketBoardPage.tsx/spec. Keep the current
  country selector, indicator, zoom and Map/Table state. A native range, previous,
  next and latest buttons share the period selector's state. Exact supplied
  periods only: no interpolation or carry-forward; missing months stay uncolored.
  Project inline country metrics and table cells into the same chosen period;
  snapshot-only responses remain readable with disabled history controls.
- [x] Task 3 — four locales, owner guides and verification. Relevant backend/UI
  tests, owning typechecks and UI/backend builds, actual read-only OECD feed and
  desktop/narrow preview with mouse/keyboard scrubbing. One fresh scoped review
  after implementation, using this increment's baseline snapshots rather than
  the unrelated dirty branch. Keep review/verification results here.

Evidence and before snapshots:
`C:/Users/Administrator/AppData/Local/Temp/openalice-macro-timeline-20261025`.
Initial external-readonly probe: all five existing OECD datasets returned HTTP
200 with multiple real monthly/quarterly observations. The hub still returns a
snapshot. No upstream request uses credentials or activates acquisition jobs.

Execution evidence:

| Result | Evidence | Limits |
| --- | --- | --- |
| Observed RED before product edits: backend history/source/error assertions fail; UI tests cannot find the missing timeline. | `red.json` / `.log`, `ui-red.json` / `.log`. | First combined run has no executed UI assertions; the separate UI run actually executed 14 assertions with two expected failures. |
| All reference unit specs pass: 35 assertions. Map/page UI specs pass: 14 assertions. | `node-green.json`, `ui-green.json`, corresponding logs/exit receipts. | Existing mocks outside these units are unchanged. Native keyboard behavior is checked in the actual browser as well. |
| Root typecheck, owning UI typecheck/build, registered-test typecheck and backend preview build exit 0. | `types-exit.json`, `ui-build-exit.json`, `test-types-exit.json`, `backend-build-exit.json`, corresponding logs. | Registered-test typecheck took over eight minutes under concurrent disk load. Existing bundle-size/direct-eval/proxy-port warnings remain warnings. No dependency/config/test-timeout changes. |
| Actual `/api/reference/global-macro` returns a local OECD board with seven countries and 1621 sorted, unique, finite historical points; latest cells match their final points. | `actual-board.json`, `api-acceptance.json`. | Five-year requested window, 2021-10 through available 2026 observations; several country/indicator periods are absent. Current source revisions only, not publication vintages. |
| Actual desktop mouse scrubbing moves CPI from 2026-09 to 2024-03; native Home/ArrowRight reach 2021-10/11. | `browser-drag.log`, `browser-keyboard-home.log`, `browser-keyboard-next.log`, inspected `timeline-desktop-dragged.png`. | Read-only checks compare every country fill/value/date and all five selected-country metrics with the actual API, with no DOM/UI patches. |
| Map/Table round-trip preserves the selected period; both views show the selected source dates. | `browser-preserved.log`, inspected `timeline-table.png`. | Switching the responsive shell breakpoint remounts the page, as before; this is not cross-device/session persistence. |
| At 375px, genuine mouse dragging reaches 2023-07, Latest restores 2026-09, all five indicator switches remain correct with no horizontal overflow. | `browser-mobile-drag.log`, `browser-mobile-latest.log`, `browser-quarterly.log`, `browser-shortRate.log`, `browser-cli.log`, `browser-sharePrice.log`, inspected `timeline-mobile.png`. | Chromium viewport test, no physical mobile device or packaged Electron certification. |
| Fresh scoped review found no material source/test/locale issue. One stale owner-guide paragraph was qualified as snapshot-only. | `macro_timeline_review` compared the exact before snapshots and current files. | Static review; root owns executed verification and preview evidence. |
| Existing news archive is unchanged after the owned preview backend restart and browser checks. | `preview-before.json`, `api-acceptance.json`, matching archive SHA256. | Same isolated home, UTA disabled, no new acquisition/provider/task activation. Browser Bridge profile access was disabled; actual checks reused the existing owned agent-browser session. |
| Final complete UI owner selection passes: 366 files, 2176 assertions; accepted:true, exit 0, zero unexecuted invocations. | `ui-owner-final.json` / `.log`, `ui-owner-final-exit.json`. | First run remains failed: 2173 pass, three unrelated Office PNG-reading assertions exceeded the existing five-second timeout while build/typecheck disk work overlapped. Exact unchanged files passed 16/16 in `asset-retry.*`, then this complete fresh run passed. No asset/test/config edits or timeout overrides. |

Current actual preview:
`http://127.0.0.1:47351/market/boards/global-macro`.
Desktop viewport is restored to 1440x1000, Chinese, US selected, CPI 2024-03.
The timeline, actual data acceptance and full UI owner rerun are complete.
`final-acceptance.json` binds current product-source hashes, built UI index,
test/build exit receipts and browser evidence. The held branch/HEAD remain
unchanged. No commit, push, PR update, merge or release. Autoplay, publication
vintages, additional countries and physical-mobile/packaged acceptance were
not part of this correction; missing source periods remain explicit.

## Accepted light map execution (2026-10-25)

This section records the initial snapshot-only map delivery. The accepted
timeline increment above supersedes its snapshot-only period semantics.

The maintainer now says “先做这些吧” after the concrete light-map description:
an existing Global Macro view with indicator switching, country shading, country
details/news entry and a table alternative. This authorizes implementation of
that described first version. Preserve the held branch and all unrelated dirty
work; no commit/push/PR update/merge/release or paid activation.

### Implementation plan and execution ledger

**Goal:** deliver the lightweight map and useful country lookup inside the
current Global Macro/News surfaces.
**Architecture:** render a checked-in Natural Earth SVG-path dataset with React
and native SVG. Consume the existing reference board unchanged. A country
selection shows actual cells/dates and opens an explicitly labeled country-name
News search through the existing singleton tab and URL binding.
**Tech stack:** existing React/TypeScript/Tailwind and native SVG; no project
dependency, backend protocol, archive or scheduler change.
**Spec:** the approved light-map description in chat and this execution scope;
the structured country-evidence project below remains a separate design.

Ruling: deliver a literal, editable country-name news search for this map first
version, not a claimed semantic country association. This uses existing archive
and prepared-event search; it neither certifies relevance nor implements the
new evidence/relationship publication contract. Keep its action named Search
news. The structured country-evidence design is not marked implemented.
Ruling: shade only finite values from the selected supplied observation period;
do not combine US 2024 CPI with other countries' 2025 CPI into one comparison.
The period selector covers supplied snapshot periods, not a historical replay.
Missing/undated/non-finite cells remain uncolored and explicit in details.
Ruling: vendor projected public-domain Natural Earth paths, generated with the
mature D3 geographic projection in a temporary tool directory. Native SVG renders
the supplied paths; no new runtime map engine or map-provider requests.
Ruling: use the existing held feature branch and inline execution. The current
explicit request to build authorizes routine implementation choices; do not
repeat design/plan approval questions. Keep this section as the only ledger,
with temporary evidence/baselines outside the repository.

Review focus: same-period/unknown data; country aliases and zero values;
keyboard and narrow-screen access; repeatable News searches and Back/reload;
preserving the existing table, filters, palette and singleton News identity.

- [x] Task 1 — snapshot touched dirty files; obtain/pin/check the world dataset.
  Keep source, digest, projection and public-domain notice beside the static
  asset. Runtime uses no remote geography or added package dependency.
- [x] Task 2 — RED/GREEN `GlobalMacroMap.spec.tsx`: metric/period switching,
  missing/zero values, supplied country aliases, accessible country selection
  and zoom. Implement `ui/src/components/market/GlobalMacroMap.tsx` and its
  static `world-map.json`/source notice. Only supplied macro countries are
  actionable; all other geography remains uncolored background.
- [x] Task 3 — RED/GREEN `MarketBoardPage.spec.tsx`: Map/Table switching,
  inline selected-country values/dates and Search news link. Update only Global
  Macro in `ui/src/pages/MarketBoardPage.tsx`; retain desktop/mobile table layout.
- [x] Task 4 — RED/GREEN `NewsPage.spec.tsx`, `tabs/UrlAdopter.spec.tsx` and
  registry URL checks: optional keyword parameter round-trips into the singleton
  News view; apply, clear and change it without losing category/view semantics.
  Touch NewsPage, tabs/types, registry and UrlAdopter. Search remains literal,
  language-dependent and editable, not the structured relationship filter.
- [x] Task 5 — four locale sets, owner guides and this ledger; owning UI tests,
  typecheck/build and actual desktop/mobile preview. Review the scoped dirty
  diff against the before snapshots; repair material findings and recheck.

Evidence/baselines:
`C:/Users/Administrator/AppData/Local/Temp/openalice-macro-map-implementation-20261025`.
Focused RED: `red.json` ran 89 assertions, with five expected failures for the
missing Map/Table controls and dropped News keyword (four files). The new map
file's separate `map-red.json` failed import resolution before assertions;
it is a missing-module result, not an executed-assertion claim. Focused GREEN:
`green.json` / `green-exit.json`, five files, 93 assertions passed, exit 0.
Final verification follows. Earlier date/coverage audit remains the baseline;
the map does not fix or certify the upstream series.

| Result | Evidence in this increment's temporary directory | Boundaries |
| --- | --- | --- |
| Final focused checks pass: six files, 95 assertions, exit 0. | `final-focused.json` / `.log`, `final-focused-exit.json`. | Includes the real Router/tab-store navigation test; later removal of unsupported Testing Library `exact` options changed only test typing, not product code. |
| Complete UI owner selection passes: 366 files, 2174 assertions; receipt `accepted:true`, zero unexecuted invocations. | `ui-owner-final.json`, `ui-owner-final-exit.json`, `.log`. | Repository root config, Node 24.21.0, isolated forks, two workers. The first owner run failed only an incomplete existing API mock; it remains recorded in `ui-owner.json`, not relabeled successful. The complete final run passed after that fixture correction. |
| UI typecheck/build and registered-test typecheck exit 0. | `ui-build-final2-exit.json` / `.log`, `test-types-final2-exit.json` / `.log`. | The initial attempts caught unsupported test-only matcher options; fixed, focused tests repeated, then both checks repeated. Existing local proxy-port and bundle-size warnings remain warnings. No backend change/full-monorepo gate or packaged Electron/CLI acceptance. |
| Country comparison uses exactly the supplied observation period. | `browser-map-default.log`, `browser-map-old-period.log`, `browser-map-rate.log`. | Actual built preview/API: CPI 2025 colors six of seven countries, CPI 2024 one, short rates 2026-09 six. Unknown/other-period cells stay uncolored. 176 geometry paths do not imply 176 countries with data. |
| Map/Table switching preserves indicator, period and zoom. | `review-red.json`, `review-green.json`, `browser-toggle.log`. | Independent review identified the remount reset; observed RED expected shortRate but got cpiYoy, then preserved the subtree via native hidden. The corrected component and actual browser both preserve comparison state. |
| Native keyboard country selection shows all five real cells and their source dates inline. | `browser-country.log`, `macro-desktop-selected.png`, `macro-desktop-table.png`. | US CPI still visibly says 2024-01-01; fetch time is not substituted. No drawer or fabricated fresh observation. |
| Country-name search reaches actual archived events and survives view change/reload/Back; Clear restores all four events. | `browser-news-search.log`, `browser-news-clear.log`, `browser-news-reload.log`, `browser-news-back.log`, `macro-news-search.png`. | Chinese US search finds the real tariff event. Text matching remains language-dependent and editable; it does not publish a semantic country association. |
| Desktop 1440x1000 and mobile 375x1000 work without horizontal page overflow; no recorded browser page errors. | `browser-map-mobile.log`, `browser-country-mobile.log`, `browser-table-mobile.log`, inspected desktop/mobile screenshots, `browser-errors-final.log`. | The existing responsive shell may remount at the breakpoint, so the mobile reader is opened after resizing. This is Chromium viewport acceptance, not hardware-mobile certification. |
| Independent scoped review has no remaining material findings. | `macro_map_code_review` compared before snapshots with current files, then rechecked the toggle fix and navigation fixture. | Source/test/locale and owner-guide review only; root owns executed tests and browser evidence. Structured relationships, upstream accuracy/coverage, geography policy and paid acquisition were explicitly outside this increment. |
| Existing news state remains intact and preparation paused. | `preview-before-browser.json`, `final-acceptance.json`. | 12 originals, four events and three held originals. Archive digest unchanged. No new provider/native-batch activation, trading write, backend rebuild or publishing. |

The actual preview is `http://127.0.0.1:47351/market/boards/global-macro`.
`final-acceptance.json` binds the dirty product-source hashes, built UI index,
check results and twelve browser receipts. The held branch and HEAD are
unchanged. No commit, push, PR update, merge or release. This completes the
authorized light-map increment; broader data freshness, country-evidence
publication and continuous financial-news acceptance remain open.

Temporary projection-tool setup discovered the host's parent workspace and
added its temporary importer to the host lock. No user/root package manifest
was modified and no lifecycle-build approval was granted. The scoped temporary
importer and unreferenced tool entries were removed, preserving the rest of the
host lock (808 characters removed, checked against its task backup). The tool
package file was renamed so it no longer participates in that workspace.
No repository package manifest, lockfile or runtime dependency was changed.

## Data before map — accepted direction (2026-10-25)

The maintainer accepts the order: establish useful data and evidence-linked
country/event relationships first, then add a lightweight map as an alternative
view in the existing Global Macro panel. Keep the current shell and visual style.
This accepts the order and purpose; it does not retroactively approve every
detail of the wider financial-relationship design below. No map, new provider,
paid activation or full causal graph belongs to this first delivery.

### First delivery design: observation dates and country evidence

Purpose: a user can see which period a country's macro number describes, then
open News for that country and inspect why each event is associated with it.
This is a bounded first slice of the existing data/relationship direction.
Broader company/industry/asset transmission and body recovery remain later slices.

Observed baseline, not a claim of economic-data accuracy:

- `GET /api/reference/global-macro` on the isolated real preview returned seven
  countries and 35 non-null cells, served by the hub with `meta.provider: fred`.
  It is not the local OECD fallback. The response's `meta.asOf` is
  `2026-10-24T13:40:20.639Z`; CPI observations are dated `2024-01-01` for the US
  and `2025-01-01` for the other six countries. Other metrics have different
  periods. Non-null values and a recent fetch do not establish current releases.
- `GlobalMacroBoard` returns a value and date per metric, without a historical
  series. The desktop currently hides those dates in title tooltips; mobile
  exposes them to assistive text but not as visible period labels.
- Four existing events have original evidence, topics and optional symbols;
  their v1 artifact has no country-association contract. A topic containing a
  country name does not establish the nature of the relationship.
- Read-only receipts: `C:/Users/Administrator/AppData/Local/Temp/openalice-macro-data-check-20261025/{board.json,board-audit.json,event-evidence.json}`.
  The read used the existing configured reference route. No source/configuration,
  archive, scheduled Issue or trading state was changed.

Agreed constraints and implementation choices for review:

1. **Macro dates.** Reuse the existing cells and panel. Display each supplied
   observation date beside/below its value on desktop and mobile. Keep the
   existing fetch timestamp separately labeled; never use it as the observation
   period. Preserve a supplied annual/monthly/quarterly label rather than infer
   precision or frequency from `YYYY-01-01`. Missing dates remain explicitly
   unknown. Missing/error cells remain missing. Do not invent a freshness
   threshold, silently hide old observations, substitute dates or claim a newer
   upstream release. A source-series correction is a separate verified change.
   Use compact labels and existing tokens, without a calculation banner.
2. **Country identity.** A country/region association uses a stable canonical
   code and display name shared with macro navigation. Reuse an existing
   authoritative country mapping if available; otherwise add a small explicit
   mapping for this proof: the existing seven macro countries plus Canada,
   Iran and Russia, which occur in the real event sample. This initial mapping
   is an implementation choice, not a global-coverage promise. An unmatched
   country stays unresolved; no event is discarded because of it. New aliases
   produce candidates rather than an automatic identity match.
3. **Meaning and evidence.** A country association is either `mentioned` or
   `directly-involved`, with a short explanation retaining attribution and
   conditional/future language. It is a source-backed statement of relevance,
   not an event-location claim, price direction or proof of market impact.
   Country of a quoted speaker and location of an incident are distinct.
   Never derive a country solely from a topic, publisher location, company
   domicile, stock code or a model's background knowledge. No automatic
   propagation to other countries, sectors or assets in this slice.
4. **Evidence record.** Each association binds the story ID/current revision,
   canonical country, relation kind, preparation identity/time and one or more
   current story report IDs. Each citation names the original `content` field,
   its UTF-8 SHA-256 and a non-empty exact excerpt. A title may be cited only
   when the original body is absent; mark that basis explicitly. Quote text
   must occur in the identified field and the digest must match. A missing,
   changed, held or unrelated report cannot validate a publication. Validation
   proves structural binding, not factual truth or that the country inference
   is semantically correct; uncertain or contradictory evidence stays in review.
5. **Persistence and updates.** Keep original JSONL and strict story v1 bytes
   unchanged. Store a separate versioned, project-owned record, using the
   existing story store's shared write queue and atomic-write conventions.
   Publication checks both current story and association revisions; stale
   writes fail. Keep correction/withdrawal history. A story update retains old
   evidence and marks its associations for review; stale/withdrawn associations
   do not enter ordinary country results. No association record means
   `unassessed`, not `unrelated`. Native publication respects existing event
   protection, report holds and explicit human corrections; changing a country
   or association ID cannot bypass them. Corrupt association state fails visibly
   for association reads/filtering while raw news remains available.
6. **One reading path.** Extend the existing HTTP/CLI/MCP story surface and
   native preparation guidance; no model call on reads or new scheduler.
   Country filtering runs before event pagination and combines with existing
   search/topic/bookmark filters. Expose only current non-withdrawn associations
   in results. An existing Global Macro country control opens the same News tab
   with a structured country filter; this is not a keyword search. Countries
   without macro cells can still have News. Within the accepted inline News
   reader, show country, relation kind, observation basis and cited originals.
   Keep a visible country filter/clear action and the established empty/error
   states. No drawer, new workbench, global navigation or map in this increment.
7. **Preparation and acceptance.** Software fixtures prove revision, quote,
   filter and protection behavior. Separately, prepare associations from the
   existing real originals in the isolated preview through the native-agent
   tools/operator path, without starting a paid model/provider or enabling
   recurring runs. Preserve unknown cases; no claimed continuous intake,
   causal accuracy or market-direction accuracy. Implementation file split,
   command names and indexing are builder choices within these invariants.

Minimum acceptance:

| Case | Required observed behavior |
| --- | --- |
| Current fetched snapshot containing 2024/2025 CPI periods | Every supplied observation period is visible on desktop/mobile and distinct from fetch time; missing dates and unavailable cells stay explicit. |
| Tariff reports 3269/3280 | US/Canada relevance has exact original evidence and retains who said it and the future/conditional wording. The association does not assert that a policy is already effective. The conflicting held original 3272 remains held. |
| Oil-tanker reports 3306/3322/3336 | A reference to Iran/the Iranian speaker is not turned into a confirmed Iranian incident location, a closed strait or a supply/price movement. Any supported association retains that limited meaning. |
| Anthropic event without an explicit country in its cited originals | It stays unassessed for country instead of receiving an assumed US association. |
| A country with News but no macro row | The country filter still works and does not manufacture a macro value. |
| Quote/hash mismatch, held report, conflicting revisions or protected event | Publication fails without losing prior valid data; human correction and review state survive retries/restart. |
| Event revision and country filtering | Old associations remain reviewable and are excluded from ordinary country results until checked against the new event; filtering precedes pagination and existing search/bookmarks still work. |
| Actual surface | Existing Global Macro and inline News work at desktop/mobile widths with keyboard-accessible country navigation and original citations. |

The broader data work still needs verified indicator definitions, frequency,
observation/release dating, comparable periods and source coverage before a
macro map can be considered ready. Making existing dates visible does not fix
an upstream series or certify data freshness. This slice delivers an honest
dated view and a country-to-evidence reading path, not complete global data.

Builder check: fresh read-only `macro_country_builder_check` reviewed only this
section and narrow current source/owner surfaces and returned “nothing important
left”. The root checked the live route receipt and original tariff/oil/Anthropic
texts against the examples above. No product code, native batch, fixture,
provider configuration, original archive or scheduled Issue was changed for this
design. No test/build or software-acceptance result is claimed.

Storage check during this work: F: free space fell to 883,646,464 bytes (about
0.82 GiB), below its earlier roughly 5 GB headroom. The preview previously hit
ENOSPC. Complete this design/read-only work; verify adequate writable headroom
before implementation builds or batch writes. Do not delete user files or
disable unrelated processes to recover space. The optional broad filename
lookup is not required evidence and must not block this bounded design.
The final volume/PSDrive recheck recovered to about 5.3 GB free, without any
cleanup by this task. Treat the short-lived pressure as a preflight concern,
not a continuing storage block. The final read-only evidence summary is
`.../openalice-macro-data-check-20261025/design-audit-receipt.json`.

Status: direction accepted; first-delivery design has passed its builder check
and awaits maintainer review. It is not implemented or fully approved.
Do not activate recurring preparation, change providers or lift the held branch.

## Urgent implementation and acceptance (2026-10-24)

The maintainer accepts the four urgent groups above. Implement on the existing
held branch, reusing the collector, file-backed story store, native CLI gateway,
normal Workspace Issues and the existing scheduler. No new dependency, database,
model loop or second scheduler is introduced.

- Implemented complete-archive pending/review/failed queues, bounded failure
  retries (5 and 10 minutes, human retry after the third failure), original
  reading and human retry notes. Publication acknowledges its report IDs;
  unfinished work remains pending after interruption/restart.
- Native publication now protects reviewed events, prior report/development
  assignments and other events' evidence. The reader can protect/unprotect an
  event and save/remove project-owned bookmarks.
- News settings creates a visible preparation Issue: 20 originals per batch,
  every 15 minutes, 15-minute timeout, inheriting the Workspace's headless
  Agent/model/credentials. Use `@new-each-run`; event/archive state carries
  continuity. Actual acceptance exposed that an initially failed CLI launch
  left an ineligible reusable Session, so the first `@new-then-resume` approach
  was replaced. Existing human-edited Issue ownership is preserved.
- Implemented source-coverage heat with independent identity deduplication,
  publication-time decay, coverage-aware historical trends, separate new-event
  and new-development markers, discovered topics, relevance ordering and
  persistent bookmark filtering. Heat is subscribed-source attention, not an
  all-internet popularity measure or a claim about price direction.

Actual native run: `run-eoZECt7X`, Codex 0.164.0, existing Issue scheduler,
`resume-sunny-amber-grove-8lhwgd`. The runtime uses an isolated AliceProject at
`F:/temp/openalice-news-continuous-20261024/verified-home`, UTA disabled and no
paid news-provider configuration. One prior attempt failed before native startup
because PATH chose a batch-only wrapper. The preview process now uses the
installed official npm CLI entry and existing system Git; global configuration
is unchanged. Future scheduled fires are paused after the bounded native run.

| Conclusion | Evidence | Result and limits |
| --- | --- | --- |
| A real scheduled native batch publishes grounded financial events | `automatic-verification.json`, `automatic-acceptance.json`, `automatic-progress.json` under the evidence root below | 4 events, 9 originals represented once, 3 unresolved originals explicitly held; all 12 accounted for with no unrelated gold-set merge. Non-selected events and events without tickers remain stored. This is one bounded batch, not a sustained-operation or general accuracy claim. |
| Contradictions are visible and originals survive preparation | Same verification receipt and full event/original HTTP readbacks | Tariff direction ambiguity and two title/body mismatches remain held with concrete reasons. Original JSONL SHA-256 is `8918387c526eb07168588a1f9521a75f0ad0c35d046fa52e6574c92377b4c9c4` before/after. Conditional financial transmission is separated from observed facts. |
| Durable queues, held/retry state, recovery, follow-ups, unrelated events, marker semantics, history, bookmarks and real HTTP configuration | `continuous-final.json`, `continuous-final.log` | 11 passed, 0 failed. Includes concurrent review/publication, committed-artifact acknowledgement after an interrupted receipt, a new development, duplicate later coverage and a same-topic unrelated event. The two new race/recovery checks first failed against the prior implementation (`review-race-red.json`); shared write serialization and committed-evidence acknowledgement fix them. Synthetic relation controls are not broad real-world quality evidence. |
| Windows file fixtures need measured timing budgets | `store-timing.json`, earlier failed reports and calibrated report | Cold directory 261 ms, ingest 716 ms, publish 6.45 s, first list 4.21 s. Five-second defaults failed. File-backed suites now have scoped Windows budgets; the longest continuous fixture passed in 54.4 s. Product timeouts are unchanged. Earlier empty/worker-start-failed reports are not counted as passing tests. |
| Actual saved-event reading persists across page reload and runtime recovery | `bookmark-persisted.png`, `restart-verification.json` | A native-generated event was bookmarked through the reader and remained visible after reload in Bookmarks. The final built runtime recovered all 4 events, the saved oil-tanker event and all 3 review holds. Original evidence retains the same SHA-256. |
| Held originals are readable in the real settings surface | `review-original.png` | All three held items, reasons, original bodies and optional feedback controls are visible. No held fact was silently accepted merely to clear the queue. |
| Human feedback and protection use the actual reader | `review-feedback-ui-final.json`, `protection-ui.json` | Submitted a review note, read it back in the pending queue and restored the original hold through the normal Workspace CLI gateway. Protected and unprotected the oil-tanker event through the detail sheet. A focus check exposed an attempt to focus a disabled queue button; the final build now retains focus on the persistent queue navigation after the submitted item disappears. |
| Chinese responsive reading | `final-hot-desktop.png`, `final-hot-mobile.png`, `final-mobile-layout.json` | Inspected 1440 by 1000 desktop and 375 by 1000 mobile screenshots. No horizontal document overflow; all 4 native-generated geopolitical, trade and AI events remain present. The final coverage-heat wording is verified. Trends show insufficient history. |
| Existing reading and gateway regressions | `regressions-calibrated.json`, `regressions-calibrated.log` | 57 passed, 0 failed across story, HTTP, preparation-tool and CLI-gateway checks. The later serialization/receipt change is additionally covered by the 11-test final continuous suite. |
| Current source, registered tests, UI and runtime compile | `final-build-checks.json`, `types-final.log`, `test-types-final.log`, `ui-build-final.log`, `runtime-build-final.log` | All four commands exited 0: root typecheck, registered-test typecheck, owning UI typecheck/build and runtime ESM/declarations. A prior complete build also passed; the final UI build took 9m23s in this Windows environment. Existing bundle-size/eval warnings are not new feature failures. |
| UI component verification has an infrastructure gap | `page-final.json`, `reader-final.json`, `reader-final.log` | NewsPage's separate run passed 21 tests. The final reader command passed NewsPreparation's 3 cases including review-note/focus assertions, but exited 1 because the NewsStories worker did not start within its bootstrap timeout. Do not count that invocation as green or the missing component cases as run. Actual reader/bookmark/protection/focus workflows were checked in the browser. |
| Storage pressure interrupted the prior preview | `runtime-stages.jsonl`, `preview-final-stage.json`, `restart-verification.json` | The old runtime exited after its ownership heartbeat failed with ENOSPC. Ownership validation found that PID already absent; no process was killed. With ports free, the final built candidate was staged and recovered under PID 74544. F: had 5,521,211,392 free bytes at final recovery. No unrelated files or unused junctions were deleted. Disk exhaustion remains an environment risk. |

Evidence root: `F:/temp/openalice-news-continuous-20261024`.
Current preview: `http://127.0.0.1:47351/market/news?view=hot`.
The preview now runs the final built candidate; its main bundle SHA-256 is
`5B7659C81076BF45B1759B8BEE9BD89AF291D80FD3CCDFF6E3A8E5DA360F15BF`.
Future scheduled fires remain paused. X/FMP live-provider, sustained incoming
collection/follow-up acceptance and the missing NewsStories unit run remain
open; do not call full AIHOT absorption complete. No commit, push, PR update,
merge or release is authorized by this implementation acceptance.

## Data and relationship gap audit (2026-10-24)

The maintainer asks specifically about usable data and the nature of the links,
not only reader features. Read-only inspection of the two separate acceptance
homes is recorded in `data-audit.json` under the evidence root above.

- The older collection archive has 3,471 records across 23 source tags, not 23
  independently verified publishers or currently healthy feeds. 1,050 records
  (30.3%) have an empty stored body. A nonempty body can still be a feed excerpt.
  OpenAI and Hugging Face account for 2,209 records (63.6%); this is not balanced
  financial-market coverage. Publication timestamps span 2015-12-11 through
  2026-10-23 UTC, so the archive count is not a count of fresh news.
- The final preview deliberately contains only 12 originals across four source
  tags for bounded native acceptance. Its collector is disabled with no feeds
  or module subscriptions, and its preparation Issue is paused. The older
  archive is in a different AliceProject; no full-home/state move is implied.
- The source catalog lists 49 choices. Provider-by-provider live availability,
  stable ongoing financial intake, source freshness, missing-body completion,
  original-source attribution and paid X/FMP acceptance remain open.
- Existing native instructions distinguish same occurrence, direct follow-up,
  unrelated material and roundups. Report/development/story membership and
  original references persist; the schema does not persist a typed relation
  decision, its specific evidence and uncertainty as an independent record.
- Financial transmission currently lives in free-text `reason`, with topics
  and optional qualified symbols. Unified entity identities/aliases and explicit
  event-to-event, event-to-company/industry/asset links, relation nature and
  direction, claim-versus-inference, supporting evidence and revision tracking
  are not implemented as queryable structured relations. Existing original
  citations are useful but do not establish those individual links as facts.
- Candidate inspection currently uses existing listing/search/paging. Scalable
  candidate recall, labeled relation accuracy/missed-link/false-merge evaluation,
  real cross-batch follow-up/roundup acceptance, financial-importance calibration
  and event-linked market-response validation remain incomplete.

The next useful order is dependable incoming data/body/provenance, then explicit
entity/relation records and candidate recall, followed by real multi-batch
relationship evaluation. This audit changes no provider settings, activates no
paid request or scheduler, and does not mark the wider acceptance complete.

## Data and financial relationships: design for review (2026-10-24)

Status: the maintainer accepts using Superpowers for the data/relationship
increment. The written design has completed its builder check and awaits full
design acceptance before implementation planning. This is not an
implementation-complete claim. Keep this as the single canonical initiative
document; repository instructions override the skill's default second spec path
and commit step. The existing branch/PR hold remains in force.

### Purpose and first deliverable

**界面范围纠正（主人反馈，2026-10-24）：** 主人指出独立工作台示意改动过多，
不符合现有面板风格。该示意只在临时目录生成，未改产品代码，也不作为已认可
设计。先前把“展示具体样子”扩张为新增左右分栏和导航，是本轮错误假设。
主人进一步明确：这些能力直接做在现有 **News 面板内部**，不是右侧推拉
抽屉。后续以 NewsPage 及其新闻条目内容区为承载，保留现有页面结构、导航、
字号、密度、主题 tokens 和配色；详情、原文、进展和关联在面板内展示/展开。
独立工作台与把新能力放进右侧 Sheet 的方案均被替代。此纠正约束承载位置和
视觉范围，不缩减原文、关系证据或持续跟踪的功能目标。

修正后的视觉证据位于临时 visual-companion 会话的
`news-existing-before.png`、`news-existing-relations-v2.png` 和
`news-existing-panel-v2.html`。直接在真实预览的现有 Sheet 中临时插入一段
关联说明，复用原有 typography/Button 类与 theme tokens；检查确认现有
Sheet 与导航位置/尺寸未变。`in-place-check.json` 保留该检查结果。
本次仅浏览器 DOM 显示示意及截图，产品源文件和真实关联数据均未修改。
独立工作台 v1 与右侧抽屉 v2 均已被主人反馈替代，不能作为已认可设计。
当前位置示意为 `news-panel-inline-v3.html` / `news-panel-inline-v3.png`：直接
在真实 News 面板的首条新闻内临时展开关联说明、原文材料及进展；原位展开/
收起检查通过，右侧 dialog 数为零。结果见临时目录的 `inline-panel-check.json`。
这仍是浏览器 DOM 示意，不是产品实现或关系判断验收。

让持续进入的金融新闻形成可核查的事件关联：关联谁、是什么性质、依据哪份
原文、哪些是报道陈述、哪些只是分析推断、哪些还需复核。沿用原生 CLI 的
推理、现有采集器和 Issue 调度；Alice 负责校验、持久化、检索和呈现。

主人已确定：全部题材均可影响金融，不按 AI 或股票代码筛掉事件；优先数据
有效性、关系与证据，然后用真实材料验证跨批次更新。下面的首批信源、时间
窗口及字段粒度是本轮设计建议，不写成主人已经逐项确定的业务规则。

首轮交付覆盖数据质量/补充原文、基础实体、金融关系记录和增量复核。现有
报道—进展—事件归组继续使用同一事实、直接后续、不相关、综合报道四种
判断。第一轮不扩展为任意事件间的完整因果图谱。

### Data scope, freshness and body recovery

- 首批验证使用已有财联社、金十、华尔街见闻频道及一个官方宏观来源
  Federal Reserve Press；以当时实际可访问为准。采集前验证对应 RSSHub
  实例或直连来源，失败明确保留；不能用科技旧文填充来冒充金融覆盖。
- 原始 JSONL 和已有证据 ID 不重写。保留来源、原始网址、发布时间依据和
  采集时间，来源标签数与独立发布者数量分开。转载不能自动当成独立确认。
- 新一轮自动准备优先最近 48 小时发布的材料；缺发布时间的来料显式标记
  时间未知并进入检查，不猜发生时间。更早材料仍保存在完整档案、可检索和
  显式回填，显示历史积压；不把 2015 年旧文按今天首次入库标为新事件。
  近期处理与历史回填共用现有队列查询和调度，不增加第二个执行引擎。
- 内容区分缺失、来源提供的文本/摘要、额外取得的页面文本。首版不提供由
  Agent 任意设定的“全文已核实”状态，完整性统一保留“未核实”；来源若
  自称提供全文，只能记录为有依据的来源声明。非空、字数、content:encoded
  或页面提取成功都不证明全文。完整简讯可以很短，逐条引文支持哪些陈述
  决定材料可用性，不以篇幅代替证据。
- 原文补充由已有原生 Agent 的 HTTP/shell 能力或明确获批的信源 producer
  定向取得，提交为带来源的补充材料；Alice 不增加通用后台爬虫或模型循环。
  每篇每轮最多一次获取、10 秒、1 MiB 文本上限，沿用现有每轮至多 20 项。
  只取该条原始发布网址或同发布站点的明确正文链接；不得发送登录凭据，
  不访问私网/本机/文件网址，不绕过登录、付费或反爬限制。重定向最多两次，
  每跳保留同样的目标限制。无法取得、受限或不完整时保留具体待补原因。
- 上述获取目标/跳转/超时规则是现有原生 Agent 的操作约束；不宣称限制了
  它的任意 shell/HTTP 权限。服务端强制限制提交体大小、材料引用范围、
  凭据形式、来源网址关联、摘要值和引文存在性，不根据提交记录认证获取
  过程受强制网络约束。真实获取过程通过本轮执行回执核对；如需独立受限
  获取工具或网络沙箱，应另定范围，不在首版暗中增加或假称已实现。
- 补充材料保存 reportId、请求/最终来源网址、取得时间、取得方式、文本及
  内容摘要值；保留各次版本，不覆盖原始记录。该来源轨迹是操作者/producer
  提交的获取记录，不伪称为服务端独立核实。新增补充不能悄悄替换旧证据。
- 短暂失败沿用已有有上限重试；永久受限或证据不足留待复核。待补原文仍可
  检索和阅读已有标题/摘要；缺少足够证据时不发布确定的金融影响关联。

### Entity identity and relation meaning

基础实体支持公司、组织、国家/地区、行业、商品和金融资产。实体具有稳定
的项目内 ID、类型、规范名称和有依据的别名；同名或别名命中只产生候选，
不能自动认定同一对象。股票/资产代码只有在原文明确提供或现有已核验标的
资料能支持身份时才绑定，并保留依据；未知时留空。已有实体 ID 不得静默
改指另一个对象，存在身份冲突时保留未决项。

每条金融关系从一个稳定事件指向一个实体，至少包含：

| 内容 | 首轮规则 |
| --- | --- |
| 关系性质 | 提及、直接涉及、间接传导。提及不表示有金融影响；直接涉及表示来源明确把该对象列入行动/政策/事故范围，不表示已经发生或已影响价格；间接传导是有条件的分析。 |
| 认识依据 | 原文陈述或分析推断。原文陈述保留谁声称、是否计划/条件性安排，不升级为事实认证。间接传导必须标推断并写出条件。 |
| 影响说明 | 描述相关业务/成本/供需/经营等传导。利好、利空、混合、未知只是带对象和条件的分析；默认未知，不自动推导涨跌幅或股票清单。 |
| 证据 | 引用 reportId、具体材料版本/内容摘要值和精确原文片段；原文/补充材料必须存在、片段必须实际出现。引用支持前提，不等于已证明分析结论。 |
| 未确定事项 | 保存缺口和复核状态；允许事件没有任何可靠金融关联，不能为清空队列硬配公司或资产。 |
| 生命周期 | 事件版本、关系自身版本、准备者和时间；更正/撤回保留记录，重新获取的页面不改写旧判断的证据。 |

关税例：来源说某类产品将获豁免，可记录来源陈述的直接涉及对象；税率生效、
企业利润、相关股票表现均不能从这句话直接确认为已经发生。航运例：保留
事故说法的归属，能源供给/保险成本是条件性传导，不能把说法升级成海峡关闭。

### Publication, retrieval, updates and human correction

- 实体/关系候选查询使用名称、别名、已核验代码、主题和时间进行有界召回；
  可以翻页找到旧事件。复用已有文件检索能力，不先引入向量数据库或图库。
  排名只提供候选，最终同一性/关系判断仍由原生 Agent 结合原文完成。
- 从现有 CLI/MCP 和 HTTP 读写同一份数据，并在已有事件阅读入口查看关联、
  依据和未决事项。只读操作不自动抓网页或调用模型。呈现严格在现有 News
  面板内完成，复用新闻条目、文字层级和分隔线，正文、原文、进展、关联可在
  面板内展开；不以右侧 Sheet 承载本轮新功能。保留 shell、页面布局、导航、
  宽度、主题、字体和密度，不能以这次功能新增为由重做面板。
- 同一个工作查询返回到期的原文准备、补原文和关联重核任务，合计每轮最多
  20 项。没有新报道时仍处理已发布报道的待补材料、事件更新后的待重核
  关联；只有全部工作都无到期项时 Issue 才结束。不能因原文已经归组而
  丢掉这些工作。只在现有文件状态中保存任务种类、目标及版本、原因、
  到期时间和有界重试，不增加第二个调度器；同目标版本重复发现应去重。
  已有人工复核持有或保护不自动解除，阻塞原因可见；历史回填默认不占用
  近期轮次，需显式选择。过期目标更新为最新待核版本，旧判断证据仍保留。
- 新记录采用独立、有版本的文件材料，沿用原子写入和共享写队列。原有事件
  v1 读取/发布与旧档案继续有效；已发布格式若需变化，使用正式迁移机制。
  模块清单/ABI 不是此次补充材料的旁路升级入口。
- 关系提交检查当前事件版本与自身修订，过期写入拒绝并要求重读。事件更新
  后保留旧关联及其证据，并明确标记需要重核，不能继续伪装成已基于新版本
  核对的结果。原生 Agent 在后续批次补充、修订或撤回关联。
- 事件保护、原文复核持有和人工修正约束同时适用于关联发布；不能换一个
  关系 ID 绕过。并发复核意见保留，失败不清空已有有效关联。
- 具体文件分拆、API/CLI 命令名、内部索引、字段英文名和局部事务边界交
  实施者决定，但不得削弱证据绑定、版本冲突、保护或项目隔离这些不变量。

### Acceptance and delivery slices

1. 数据与材料：可核查的来源状态/新鲜度/正文状态；新材料进入与历史积压
   可区分；定向补充原文有来源记录，失败可见并可恢复。
2. 实体与金融关系：稳定身份、最小关系记录、证据检验和读写工具/阅读投影。
3. 增量与复核：候选召回、事件/关系修订、保护与撤回，真实多轮验收。

| 检查 | 必须观察到的结果 |
| --- | --- |
| 空正文/摘要/缺日期 | 分别显示实际状态；非空、长文本、content:encoded、页面提取均不能自动变成“全文已核实”；不猜发生时间，不可用项保留。 |
| 同一事实、直接后续、不相关、综合报道 | 合并报道但不丢独立进展，不因为同一行业/公司混并。真实样本结论另记录，不能用软件 fixture 代替准确率。 |
| 真实关税材料 3269/3280 与 3272 | 方向有歧义的证据保留未决，不为凑出一致结论合入；不宣告政策已生效。 |
| 真实航运材料 3306/3322/3336 | 保留说法归属，条件性传导清楚，未出现的供应中断/价格变化不能变为原文事实。 |
| 真实标题/正文不一致材料 3279/3283 | 标题不能替代正文，缺口留待复核。 |
| 实体/代码歧义与引用错误 | 不合并同名异体、不猜代码；伪造/过期/不存在证据和不在材料里的引文被拒绝。 |
| 更新、并发复核、人工保护、重启 | 新进展可持续追加；旧关联标待重核，人工更正保留；中断不丢原文、已完成关系和待补事项。 |
| 没有新报道但有后续工作 | 归组后的待补原文或关联重核仍能由同一 Issue 查询、有限重试及继续处理；空原文队列不能触发错误的提前结束。 |
| 真实连续来料 | 在同一独立验收项目通过既有采集器和 Issue 完成最多三轮、每轮至多 20 项准备/补原文/重核工作，结束暂停；逐轮保留来料/处理/未决记录。没有实际新来料或后续时，该项继续未验，不把重放旧料称作持续采集。 |

先复用现有真实验收材料建立可复跑的证据/不确定性检查，再加入实际新来料。
不在这一阶段承诺全市场覆盖率、关系准确率数字或毫秒级时延。F: 余量约
5.5 GB 且此前发生 ENOSPC，运行前检查可写与余量，不擅自清理用户文件。

### Accepted inline-reader increment (2026-10-24)

The maintainer says the inline News-panel v3 direction is much better. Proceed
with this bounded presentation change using existing real reading data; this
does not claim item-by-item acceptance of the broader financial-data design.
There is no new data provider, financial relation result or model execution.

- [x] Establish RED checks: prepared event details stay in their list row;
  grouped raw originals stay inside `news-feed`; neither opens a dialog.
- [x] Replace prepared-story Sheet presentation in
  `ui/src/components/news/NewsStories.tsx` with inline disclosure. Preserve real
  evidence, developments, original-source filters/order, errors/retry, bookmarks
  and protection. Refresh an open event when its revision changes.
- [x] Replace raw-group Sheet presentation in `ui/src/pages/NewsPage.tsx` with
  inline original-report disclosure; preserve every original and ordering.
- [x] Adapt the owning component/page specs to the accepted disclosure behavior;
  cover collapse, citation focus, stale-request isolation and live revision.
- [x] Add collapse copy to all four existing locales; update owning guides.
- [x] Verify the two owning UI suites, UI/test typechecks and UI build; inspect
  prepared and raw reading in the actual preview on desktop and mobile. Follow
  the project's leaf feedback ladder rather than the generic full-suite default.
- [x] Complete scoped review against the pre-change dirty-file snapshot and
  record actual results. Hold commit/push/PR/merge; leave scheduled tasks paused.

Snapshot/evidence: `C:/Users/Administrator/AppData/Local/Temp/openalice-inline-reader-20261024`.
The first unit attempt (`red.json`) executed no tests because both workers failed
to start; it is not a valid RED result. Actual-browser checks against the unchanged
baseline failed with the expected out-of-panel drawer symptom:
`red-browser-event.json` and `red-browser-group-valid.json` each record CLI exit 1.
The earlier raw-browser selector/timeout attempt is excluded. Product changes
started after the actual-browser failures were observed. The first full changed
component/page attempt (`green.json`) also failed before running tests because
its threads workers did not start. Neither failed invocation establishes a
passing assertion. Final verification on 2026-10-25 uses Node 24.21.0 and the
repository's unchanged root configuration:

| Conclusion | Evidence under the snapshot directory | Scope / limits |
| --- | --- | --- |
| Both owning suites pass: 2 files, 34 tests, zero failures. | `reader-clean.json` / `.log`; separate `page-final.json` also passes 24 cases. | Covers inline event/raw reading, collapse/focus, citation filters, failed requests/retry, stale response isolation and revision refresh. An earlier mixed invocation's worker startup error remains a failed invocation. |
| Final UI owning typecheck/build and registered-test typecheck exit 0. | `ui-build-final.json` / `.log`, `test-types-final.json` / `.log`. | UI build includes `tsc -b`. Existing missing local proxy-port configuration and large-chunk diagnostics are build warnings. No complete repository suite or packaged Electron/CLI verification for this leaf UI change. |
| Built preview opens real prepared details inside their own row; citations open/focus the actual three supporting originals and reset the official-source filter. | `event-acceptance.js` / `.log`, `keyboard-collapse.log`, `desktop-event-final.png`. | Uses the existing oil event and its API evidence; one real development. Keyboard collapse retains the row and control focus. No financial relation was invented. |
| Raw grouped originals stay inside the News panel, in earliest-first order; keyboard collapse retains focus. | `raw-acceptance.js` / `.log`, `raw-collapse.log`, `desktop-raw-final.png`. | Three actual originals; one level of grouping, zero dialogs. |
| Prepared and raw inline reading fit 375px width without horizontal overflow. | `mobile-acceptance.js`, `mobile-event-acceptance.log`, `mobile-raw-acceptance.log`, inspected `mobile-event-final.png` / `mobile-raw-final.png`. | Open each reader after changing viewport: the existing responsive shell remounts its content at the breakpoint. Browser setup/selector failures are excluded from success. Desktop inspection is 1440x1000; no hardware mobile-device claim. |
| Original archive, bookmarks/protection and paused preparation remain intact. | `preview-before.json`, `preview-after.json`, `browser-acceptance.json`. | 12 originals, four events, three review-held originals; archive SHA-256 remains `8918387c526eb07168588a1f9521a75f0ad0c35d046fa52e6574c92377b4c9c4`. No paid provider/model call, new feed or trading write. |
| Scoped independent review has no remaining findings after fixes. | `news_inline_review` compared the ten before snapshots with the current dirty files and rechecked both fixes. | Corrected pagination focus to ignore expanded nested originals; removed obsolete drawer/focus-trap guide text. An extracted production-callback browser diagnostic records RED/GREEN in `pagination-red.log` / `pagination-green.log`; the full component regression also passes in `reader-clean.json`. |

The actual preview is `http://127.0.0.1:47351/market/news?view=hot`, serving the
final `ui/dist`; it is separate from the earlier visual-only v3 mockup. The
temporary source-dev server did not render successfully and was stopped after
verifying ownership; it supplies no acceptance evidence. Runtime/backend code
was unchanged in this increment. The held branch and HEAD remain unchanged;
no commit, push, PR update, merge or release. Broader financial relationships,
body completion and sustained incoming-data acceptance remain pending.

Copy follow-up (2026-10-25): the maintainer requests removal of the long heat
calculation explanation from the product. Removed the Hot-view paragraph and
the repeated metric tooltip, including unused copy in all four locales. Keep
compact heat/trend values and the calculation contract in the owner guide;
no calculation, ranking, data or persistence changes. Evidence is under
`C:/Users/Administrator/AppData/Local/Temp/openalice-news-copy-20261025`.
The first two-file invocation passed the ten reader cases but exited 1 because
the page worker failed to start. The separate page invocation passed all 24
cases with exit 0. The final UI owning typecheck/build exits 0
(`copy-build-exit.json`). The rebuilt real preview shows all four events with
heat/trend values and neither the long paragraph nor a heat tooltip
(`copy-browser.log`, inspected `copy-hot-final.png`). The scope is copy removal;
no new tests, full-suite rerun, packaged acceptance or publishing. The broader
inline-reader evidence above remains the previous increment's evidence.

### Financial-design builder check and boundaries

首轮独立检查提出三项会影响实施的空缺，以下由我按现有目标和权限边界
补明，不记成主人逐项决定：没有新原文也继续到期的补原文/关联重核；获取
规范与服务端可强制的提交校验分开；首版不认证全文完整性。以上规则和验收
行已写入本节。`news_design_builder_check` 复读修订后的设计，对这三项反馈
“nothing important left”。根 Agent 核对了修订内容；此结论只表示可据此
制定实施计划，不是代码审查或产品效果验收。

本轮不启用新的付费 X/FMP 数据源、不处理全量多年档案、不接交易写入，不做
完整事件因果图谱、行情因果认证、日报周报或 RSS 输出。资料受限和信源失效
保留为缺口。付费数据商与长期运行接受度仍单独验收。

Brainstorming builder review is complete. Review only this section and its
referenced current contracts; the root agent remains the sole writer.
Implementation planning starts after the
written design is accepted, following the chosen Superpowers workflow. This
document does not lift the branch hold or authorize commit/push/merge/release.

## Full AIHOT capability coverage check before this increment (2026-10-24)

The maintainer asks whether the linked project's functions have all been
absorbed. **No.** This is a delivery-coverage check, not another UI acceptance
or an upstream deployment. Public main was re-resolved through GitHub and is
still `b3998dc6fc138eb9659f33f55eb38c1c716f0d57` (2026-10-22). The previous
pinned source snapshot therefore remains applicable. Rechecked README,
`docs/{sources,selection,grouping,architecture}.md` and the pinned content,
event and publication job entry points, alongside local source and existing
runtime evidence. Do not infer full capability from test counts or screenshots.

| Public AIHOT capability | OpenAlice delivery coverage | Remaining acceptance gap |
| --- | --- | --- |
| Six source families, body completion and source timing | Partial: RSS/RSSHub collection and a trusted producer framework; JSON examples and X/FMP adapters exist. Public RSS has real-run evidence; paid X/FMP acceptance is still open. | Complete standard web/JSON/WeChat/external-ingest workflows where needed, reliable body/provenance handling, previews and adaptive collection. An arbitrary-code adapter interface is not six fully operated source integrations. |
| Automatic content processing with durable retry/recovery | Not connected for semantic preparation. Collection already has its own timer. Event preparation is currently task-triggered through a native CLI. | Freshly collected material must enter native preparation without manual per-batch publication, retain pending/failure state, retry safely and recover after restart without duplicating results or silently losing originals. Reuse existing Issue/Session execution rather than adding another model loop. |
| Independent double scoring, source-tier thresholds and SelectBench calibration | Not delivered. The artifact's `selected` boolean and a native agent's explanation are not this subsystem. | Financial relevance/importance rules, independently recorded evaluations and calibration against labeled financial material; priority must not delete collected originals or impose an AI-only filter. |
| Structured facts, Chinese writing and full translation | Partial: one real batch has grounded Chinese titles, summaries, reasons and original references. | Automatic material revision handling, fact/company extraction, body completion and translation, grounded-writing checks and failure handling across incoming reports. |
| Semantic grouping, candidate recall, review, follow-ups and manual correction protection | Partial: report/development/story storage, native four-relation guidance, revision validation and reading projection; 12 real originals became four events. | Continuous candidate recall and relationship/review execution, correction ownership/locks and broader relation evaluation. Fictional relation controls and reader fixtures do not establish real-world follow-up/roundup accuracy or continuous grouping. |
| Event heat, rising/new markers and history | Not delivered. Publisher/report counts are reading metadata only. | Independent-participant identities, time decay, historical snapshots and comparable coverage-aware trends. See upstream `events/hot.ts`; do not label source counts as heat. |
| Daily, weekly and monthly editions | Not delivered. | Rule-based daily selection, same-event deduplication and follow-up policy, bounded period introductions, publication schedules, idempotency and missed-period recovery. See upstream `reports/{edition,compose}.ts`. |
| Topic/company navigation and relevance search | Partial: category/topic, symbol and keyword/original-body matching exist. | Dedicated topic/entity coverage and relevance-ranked full-text discovery. Existing literal body matching is useful but is not the full upstream discovery surface. |
| Reader preferences, bookmarks and backup | Partial: themes, grouped/all-report reading and cited original views exist. | News bookmarks, font/preferences parity and import/export backup where included in the intended financial reader. |
| Agent delivery formats | Partial: working local CLI/API/MCP tooling exists. | Outbound selected/all/full-text and edition RSS variants, Agent Markdown/llms surfaces and their delivery contracts. Ingesting RSS is not publishing RSS. |
| Editorial and operational backend | Partial: source/catalog/subscription/module approval, credentials and collection status/retry surfaces exist. | Content diagnosis and manual scoring/group corrections, per-step model control, model/payment receipts and budget circuit breakers, operational alerts and processing backlogs. Worker ownership receipts are a different concern from paid-model receipts. |
| End-to-end quality and continuity evidence | Partial: focused software checks and one task-triggered real native batch. | Selection and relation calibration, failures included in quality metrics, unattended continuity, recovery/budget behavior and the complete collection-to-publication path. |

Public source anchors:
- [Capability list and explicit exclusions](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/README.md)
- [Selection and editions](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/docs/selection.md)
- [Grouping and evaluation](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/docs/grouping.md)
- [Automatic content jobs](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/jobs/content.ts)
- [Grouping/digest jobs](https://github.com/KKKKhazix/AIHOT/blob/b3998dc6fc138eb9659f33f55eb38c1c716f0d57/packages/backend/src/jobs/events.ts)

The parent objective remains a useful financial news/event system. The next
functional milestone must connect incoming originals to durable native
preparation, grouping/review, financial prioritization and grounded writing,
then feed heat and editions from those same results. Reader cosmetics do not
close that milestone. Full acceptance requires newly arriving material to
travel through the enabled path without manual event publication, with
observable pending/failure states, original evidence and recovery behavior.

Adapt mechanisms to file-backed AliceProject state and native CLI ownership;
do not copy PostgreSQL/pg-boss or move model execution into Alice. Preserve
MIT notices. AIHOT's production source list/operations data, model rankings,
reset monitoring, private topic milestones and branding are not supplied by
the public reusable engine; they cannot be counted as imported features.
The existing branch/release hold and paid-task authorization boundaries remain.
No code, paid-provider request or upstream deployment was performed for this
coverage check. Recheck this matrix when upstream relevant paths or local
news processing/output capabilities change.

## UI/UX Pro Max reader pass (2026-10-24)

The maintainer explicitly invokes `ui-ux-pro-max` for the existing news work.
Apply it to the news reader within the established neutral desktop-console
style and held branch. Retain current theme tokens, source content and native
preparation boundaries; no new product-wide design system or dependency.

Verified local guidance: `visible field labels --domain ux` returns Forms /
Input Labels; `keyboard focus refs --stack react` returns Accessibility /
Manage focus properly and refs for DOM elements. Initial broader searches
returned unrelated results and were narrowed once; only the relevant guidance
is used. The skill's native/mobile target sizes do not replace desktop web's
24 CSS-pixel target rule.

- [x] Give date, symbol and keyword filters persistent visible labels and
  align actions to their inputs.
- [x] Lead event rows with a level-three headline and tabular timestamp;
  keep a latest-fact preview for multi-development events and remove the
  repeated single-development block without removing summaries or evidence.
- [x] Correct citation navigation: reset the official-only filter, focus the
  original-report heading, reset section scroll and preserve opener restoration.
- [x] RED/GREEN the behavior with three reader cases and rerun NewsPage:
  `reader-red.json` has 3 expected failures; `reader-green.json` has 23 passed,
  0 failed across two files. Records: `F:/temp/openalice-news-ui-20261024`.
- [x] Complete the owning UI typecheck/build and inspect the actual reader
  with real material in desktop/narrow layouts, both themes and keyboard use.

| Conclusion | Check | Actual result and limits |
| --- | --- | --- |
| Reader and page interactions | `reader-final.json`, `result-complete.json` | 23 passed, 0 failed; current test command exit 0. The later contextual-navigation regression was reproduced in `context-red.json` before the shared focus handling was completed. |
| Owning types and build | `build-complete.log`, `result-complete.json` | UI typecheck/build exit 0. Initial fixture typing errors (query options and required `image:null`) were corrected; existing large-chunk warnings remain. Backend/native-package builds were not repeated for this UI change. |
| Actual layout and text contrast | `browser-verification.json` | Actual source preview at 1440, 1024, 768 and 375 CSS pixels: no document/stream horizontal overflow, visible labels and in-viewport fields. Day Codex and Night Graphite checked. Sampled headline, summary, timestamp and label contrast is at least 5.7:1. This is scoped checking, not a whole-app accessibility certification. |
| Reading density | `before-geometry.json`, `desktop-dark.json` | With the same 1440×1000 viewport and real five-event data, the first single-development row shrank from 213 to 149 px and fully visible rows increased from 3 to 4. Full summaries and all source evidence remain intact. |
| Real contextual keyboard use | `keyboard-citations-current.json`, `keyboard-all-originals-current.json`, `keyboard-development-current.json`, `keyboard-return-current.json` | Real Tab/Enter actions show all three cited originals, clear a prior official-only filter and focus the destination heading. All-originals and development shortcuts also retain useful focus. Escape restores the opener. Reduced-motion mode checked; original dark/normal-motion review settings restored. |

Screenshots: `after-events-final.png`, `after-events-light.png`,
`after-events-375.png`, and `current-reader-final.png` in the same evidence root.
The first 768px sample and an early modal command ran before asynchronous
content was ready; the current checks explicitly wait for rows/detail navigation
and pass. The preview remains at `http://127.0.0.1:47341/market/news` with Events
selected. No source artifact, news-preparation scheduler, broker operation or
project palette preference was changed. The held branch remains uncommitted
and unpublished; native Electron acceptance was not performed in this pass.

## Native preparation slice and financial scope (2026-10-24)

The maintainer clarifies that finance must consider news and events across all
subjects, because they can affect markets. Do not transplant AIHOT's AI-only
prefilter or use an attention threshold to discard original material. Preserve
subscribed originals; combine duplicate coverage of one fact, retain a later
development separately, and keep unrelated events apart. Prioritization changes
reading order, not whether original evidence survives. Unknown market links
remain unknown rather than fabricated positive/negative price effects.

Continue the accepted native-CLI preparation direction with the existing
file-backed reader. The first slice exposes prepared-event list/read/publish
through the current `alice`/MCP registry, uses one shared store for native and
HTTP publications, and extends the existing Alice skill with the local command
and grounded event-preparation procedure. All subjects and non-selected events
remain available; a stock symbol is optional. Reuse existing Issue scheduling
for later recurring native runs; do not create another model loop/scheduler or
enable a paid unattended task by default. Keep the held branch and user state.

- [x] RED/GREEN the native publication boundary: non-AI/no-ticker events,
  originals retained, missing evidence/stale revisions rejected, bounded
  artifact input and a single writer shared with HTTP.
- [x] Register `alice events list/read/publish`, verify the real shim and
  file-backed JSON input, and document the native preparation path in the
  existing Alice skill/owner guide.
- [x] Run a bounded real-source native preparation sample for duplicate
  coverage and unrelated events; publish only evidence-linked outputs into
  the isolated review home. Follow-up and roundup controls are explicitly
  fictional and never published; this real batch does not exercise those paths.
- [x] Verify prepared occurrence identity in the real Latest stream after the
  fresh build. Different wording for the same development folds together;
  distinct developments and conflicting assignments stay apart. Unprocessed
  originals remain available, and damaged prepared files do not hide them.
- [x] Verify the affected tool/API/CLI surface and current types; preserve
  original archive bytes and expose unresolved items rather than dropping them.

The native preparation acceptance used the installed Codex CLI against the
production archive/event tools and real `alice` shim in an isolated workspace.
Its only input material was 12 existing public-feed reports: Anthropic's
enterprise package, Collins' nine-product tariff exemption statement, an
Iran/Russia meeting plan, and a separately attributed tanker-mine claim.
All 12 were read and assigned once into four events, three reports each;
none required a ticker, and two events remain `selected:false`. All four
were published through the actual CLI and read back. The two Iran events
remain separate. The original tariff-direction disagreement remains visible,
and the tanker incident remains an attributed claim. Conditional market
transmission is explicitly analysis rather than an observed price effect.

Independent checks confirm the four persisted artifacts, complete ID coverage,
four correctly classified fictional relation controls, unchanged NVIDIA
baseline and unchanged archive SHA256
`4EE2198CC65EF0D72C8D4BEB2EE39DD99351C31B02AE2D60CEA1C93FB3D10BCF`.
The four real events were then published through HTTP to the existing isolated
review runtime; all returned revision 1 and three available originals. The
actual Events page and tariff original-report view were inspected and captured.

Evidence root: `F:/temp/openalice-news-preparation-20261024`, including
`native-result.json`, `native-independent-verification.json`,
`preview-publication.json`, `events-preview.png`, `tariff-overview-preview.png`
and `tariff-originals-preview.png`. The native workspace retains the exact
originals, publication receipts and readbacks. The procedure extends the
existing Alice skill and retains AIHOT's MIT attribution; no new model loop,
scheduler or dependency was added. The six tools/store/HTTP cases are registered
under the hermetic integration suite `news-reading`.

Limits: this is a task-triggered fixed batch, not continuous automatic coverage
or an estimate of general semantic accuracy. The real batch contains neither
a distinct later development nor a multi-event roundup; native relation
controls cover those only as fictional decisions, while reader/store tests
exercise separate developments and revision conflicts. Publisher claims and
actual market effects were not externally verified. Hotness, briefings and
source-level coverage remain separate open work.

Current review preview: `http://127.0.0.1:47341/market/news` (Events is selected
in its visible review browser). This runtime bootstraps the actual source
entry, with its own `preview-home`, global directory and Supervisor tree.
Only the public archive, prepared artifacts and public feed settings were
copied for this review; no broker/provider credentials were copied. Original
archive IDs remain stable. Both listeners bind IPv4 loopback: web 47341 and
the real CLI gateway 47342. `preview-process.json` records PID/start/argv/home;
the preview and its browser are intentionally left running for the maintainer.

Replacing the older preview process was rejected by the automatic execution
policy without a specific reason. That command never started. A separate
runtime/port was used instead; the original 47331 service and its state were
not interrupted. The completed native-only test gateway was stopped separately.

| Current conclusion | Actual check and record | Result and limits |
| --- | --- | --- |
| Tool/store/HTTP, real CLI shim and reader behavior | `preparation-final.json`, combining `preparation-green.json` and `preparation-store-green.json` by current file | 8 files, 124 passed, 0 failed. This is the latest-result aggregate, not a new full-repository run. The six integration cases are registered and included by inventory. |
| Current types | `root-types-final.log`, `test-types-current-result.json`, and current `tests.tsbuildinfo` | Root exit 0; registered-tests exit 0, with the moved `tests/integration/news-reading/preparation.spec.ts` confirmed in the checked program. UI types also passed in the full build. |
| Full build | `build-types-result.json`, `build-final.log`, `ui-copy-current-build-result.json` | Exit 0: 16 Turbo tasks, main ESM/declarations and module worker built. The final grouping help text in all four locales also passes the owning UI typecheck/build, exit 0. Existing chunk/direct-eval warnings remain. |
| Real runtime projection and CLI registration | `preview-api-verification.json` and `preview-api-verification-current.log` | Exit 0: all 12 references resolve; three Anthropic originals share an identity; two Iran events differ; bootstrap exposes all three aliases and the actual shim lists five events (four native results plus the existing NVIDIA baseline). |
| Actual Latest and Events UI | `browser-latest-grouped.json`, `browser-latest-originals.json`, `browser-financial-events.json` | Browser assertions pass: `Claude Chat` yields one group retaining three reports; All Reports yields three rows; Events shows five stories including tariff and two distinct Iran events. Captures: `latest-grouped-preview.png`, `financial-events-preview.png`. |
| Current localized build actually loaded | `browser-current-build.json`, `latest-grouped-current.png`, `financial-events-current.png` | After the final build/reload, the actual page still folds the three originals into one row and displays the corrected distinction between prepared progress and fallback headline folding. |

The initial 124-case run and the first two-file rerun hit a cold Windows
pagination-fixture timeout. Direct Node timing in `story-timing.json` measured
51-file creation at 11.9 s, first read at 7.15 s, subsequent reads at 14–16 ms,
and cleanup at 8.9 s. The pagination case now has a local 30 s budget and this
file's cleanup hook 20 s; all assertions remain, and the current two-file run
passes 11/11. No worker readiness, collection or product deadline was widened.
Initial browser-test fork startup and early preview-readiness probes also
failed; the visible logs retain them. Vite+ with one worker completed the UI
cases, and the actual preview was checked after startup on its correct CLI
listener. These do not establish a startup-latency or continuous-coverage SLA.

The native CLI's successful command events also confirm reading the candidate
Alice skill and its news reference (`native-skill-use.json`); this supplements
the observed batch behavior without claiming general compliance or automatic
selection in every future Session. The broad topic rule and evidence boundary
are retained in the owning guide and default skill. This slice adds no
continuous semantic processing, heat score, briefing generation or broker write.
The held branch remains uncommitted and unpublished pending maintainer review.

## Current AIHOT reuse assessment (2026-10-24)

Question: which public AIHOT capabilities can improve OpenAlice's actual
reading value, especially duplicate coverage, prioritization and event context?
This is a source-backed reuse assessment, not approval of a new implementation
or a claim that these capabilities have been delivered.

Verified upstream main: `b3998dc6fc138eb9659f33f55eb38c1c716f0d57`.
The GitHub compare against the previous `a0d1e75` pin reports 11 new commits
and 11 changed files, concentrated in authentication/dependencies and source
documentation; the inspected grouping, writing, heat and report code is
unchanged. The previous acquisition/architecture findings remain applicable.
Public source snapshots, tree and compare evidence are in
`F:/temp/openalice-aihot-reuse-20261024`; the GitHub connector was unavailable,
so primary GitHub REST/raw endpoints were used. Public hot/topic page text was
also inspected; no new rendered-site comparison or upstream runtime test ran.

| Capability to reuse | Upstream evidence at the pinned revision | OpenAlice fit and remaining work |
| --- | --- | --- |
| Semantic grouping and continuing events — first priority | `docs/grouping.md`, `industry/prompts/group-definitions.md`, `packages/backend/src/events/{relate,recall}.ts` | Reuse the four relations, candidate-recall approach, prompt/schema and decision rules. Existing durable reports/developments/stories can receive native-CLI preparation results. Recall similarity only proposes candidates; it does not establish identity. Chinese lexical folding is not a substitute. Roundups must not join independent events. |
| Relevance, prioritization and grounded Chinese writing — first priority | `docs/selection.md`, `industry/selection.ts`, `industry/prompts/{selection-score,story-digest,rules-anti-hallucination}.md` | Reuse the dimensions and grounded-writing rules, with standards calibrated separately for AI, macro and company news. Do not adopt AI-only weights/thresholds as financial policy. Prefer authoritative originals as representatives; preserve attributed claims, conditions and conflicting developments. Show useful results inside existing News views. |
| Event hotness — after grouping and source identity | `packages/backend/src/events/hot.ts` | Reuse independent-participant deduplication, source-time decay and incomplete-coverage handling. Current source/report counts cannot establish independent ownership or heat history; add those observations before publishing a score/trend. Attention heat and editorial importance remain different. |
| Daily/weekly/monthly briefings | `docs/selection.md`, `packages/backend/src/reports/compose.ts` | Reuse one-event-per-entry, meaningful-follow-up, source-diversity and catch-up rules. Daily selection is rule-based; weekly/monthly models write constrained introductions rather than inventing entries. Adapt outputs to the existing Inbox/reader after prepared events are reliable. |
| Topic/company follow-up | `industry/topics.json`, `apps/web/app/routes/{topics,topic}.tsx` | Reuse the configurable entity/topic vocabulary and linked-reading behavior for companies, models, sectors and macro subjects. Extend current categories/watchlists through structured results, without recreating an unrequested Selected destination. The private milestone module is a separate exclusion below. |
| Source operation and provider safeguards | `docs/sources.md`, `packages/backend/src/providers/{receipts,circuit}.ts` | Existing RSS/RSSHub and v2 modules are the base. Adapt HTML/JSON listings, optional WeChat/external ingest, body completion, trial collection, provenance and budget/receipt concepts where useful. Provider wrappers and SQL-backed receipts require local integration; neither the source catalog nor a successful preview proves coverage. |

Reusable assets: MIT-licensed generic prompts/rules, schemas, taxonomy formats,
selected pure functions, evaluation fixtures and metric logic. The inspected
`relate.ts` separates decision rules from `group.ts` I/O;
`scripts/eval-relations-core.ts` exposes relation metrics. The actual recall,
heat, report and receipt implementations depend on PostgreSQL, and report/
provider execution also reaches the upstream model/queue runtime. Port their
behavior into Alice's file-backed state and native CLI ownership; do not import
an in-process model loop, PostgreSQL/pg-boss stack or a second workflow engine.
Preserve copyright/license notices for copied portions. README explicitly
excludes AIHOT branding, its production source list/operations data, model
rankings, reset monitoring and topic milestone functionality from this public
reuse scope.

Recommended first product proof: the three real Anthropic bundle reports seen
in the live preview become one occurrence with all originals retained; a later
pricing/availability change becomes a distinct development in the same story;
an unrelated product update and a multi-event roundup do not cause a false
merge. Generate a concise factual overview and explain its reading value.
Use relation/selection gold cases and the digest side-by-side criteria from
`docs/{grouping,selection,story-digest-evaluation}.md`; record false merges,
missed merges, unsupported claims and processing failures, not only successful
model outputs. Existing public materials suffice for this proof; paid-provider
access is an independent acceptance item.

Limits: static code and author documentation establish the available mechanism,
not its accuracy, cost or reading benefit on OpenAlice data. No model/provider
requests, upstream deployment, source-code transplant or schema change occurred
in this assessment. Recheck when upstream changes `events/`, `editorial/`,
`reports/`, `industry/prompts/` or when Alice's execution/persistence boundaries
change. Minimum recheck: resolve upstream main, compare those paths, then
confirm the local reader contract and native-CLI preparation boundary.

## Live product preview (2026-10-24)

The maintainer asks whether the original problem is solved and wants to see
the actual effect. Reopened the isolated real-data preview at
`http://127.0.0.1:47331/market/news`, with its own visible browser, public-source
collector and RSSHub. Its home remains the F: scratch `runtime-home` described
below; review-service ownership receipts are kept beside it.

The current raw stream visibly still contains three reports of Anthropic's
enterprise bundle announcement at 02:14–02:15, with similar-report folding
enabled. Acquisition and original reading work, but this is direct evidence
that automatic cross-source semantic consolidation and prioritization have not
yet solved the product problem. The NVIDIA event shown in the Events view was
manually prepared from real originals; it does not prove automatic event
discovery or continuing-event preparation. Product acceptance remains open;
paid-provider credentials are not the only remaining product gap. The earlier
technical test/build results must not be presented as proof of reading value.

## Acceptance continuation (2026-10-24)

The maintainer has asked to finish the news initiative before other project
work. Continue the accepted acquisition/read/configuration scope on this held
branch. Preserve the existing no-commit/push/merge/release boundary until
acceptance; the request does not itself accept the product or authorize paid
provider requests. Use this file as the execution record.

- [x] Establish current focused source/UI and owning typecheck evidence.
- [x] Bring the two existing PR shutdown/state fixes into the working tree,
  preserving the local v2 acquisition and reading increments. Verify their
  regressions and the combined tree; do not merge divergent history implicitly.
- [x] Recheck real public-source collection, archive/restart deduplication,
  source health, original access and the existing News page in an isolated home.
- [x] Complete the accepted incoming-report interaction: automatic checks
  advertise new originals without replacing the reading stream; an explicit
  action inserts them. Preserve query cancellation and paused-update behavior.
- [x] Run cumulative source/build checks and record failures and package/runtime
  limits separately from the focused news results.
- [ ] Complete real X/company-provider acceptance when an actual first sample,
  credentials and request budget are supplied; maintainer acceptance remains
  required. No credential values belong in this record.

Initial working tree: `1b6684e7`, 46 modified files and 21 untracked entries.
Current PR #1767 remains Draft at `129fb420`; the local and PR histories have
28 and 2 exclusive commits. Initial diff and untracked-file copies were saved
outside the repository under the host temporary directory
`openalice-news-20261024-fbc56341b6fe4a6e88864bb0ccf40e07`.
Code Intel could not read its DAG capability registry (missing local path);
continue with bounded source inspection rather than change host configuration.
The current process environment contains no SocialData/FMP credential variables;
the pending provider question is independent of local verification.

Current evidence: original focused run had 274 passes, two stale Demo
expectations failing and one POSIX-only skip. Restored the two remote runtime
fixes without merging history; the failed old-module restoration was observed
RED before the manager/status correction. The combined 32-file run then passed
291 tests with one POSIX skip. Initial source/UI/tests typechecks and the first
16-package build passed. Demo assertions now include the new health fields and
the already-added AI story evidence.

Four incoming-update regressions were observed RED, then the affected UI/hook/
Demo run passed 37/37. Independent read-only review found stale event previews
after query changes. Follow-up also caught loss of the same page's cursor; both regressions
were observed RED before correcting query reset/refresh state. A real browser
also exposed escaped Jin10 headline formatting. Parser and archived-read
regressions were observed RED, then the current targeted run passed those
assertions; its unrelated 51-story pagination fixture timed out under concurrent
build I/O and remains to be rechecked without that contention.

The fresh 49-source public audit parsed 41 sources; eight failed, 31 had a dated
item in 24 hours and 36 in seven days. Three WSJ feeds still point to January
2025. This is a one-time source-window sample. The isolated actual source
Runtime archived 3,146 records from all 23 selected sources with no duplicate
keys on first inspection; continued polling reached 3,161 before the preview
was stopped. No paid provider or user home was used.

Environment interruption: C: temporary storage returned ENOSPC while writing a
JSON test report and UI build output. The full-suite attempt was stopped with
its process ownership checked; it has no completed acceptance receipt. Existing
code/backups remain intact. Subsequent receipts and test temporary directories
use `F:/temp/openalice-news-20261024-fbc56341b6fe4a6e88864bb0ccf40e07`.
The preview was force-stopped for this move; that stop is not graceful-exit
evidence. A fresh test home reuses only the news configuration and archive,
whose initial SHA-256 is `41a1c06e8167a68b96decb1a53bf19fe15b851f51a0889831ad945fe7fc3546e`.

Final 16-package source/UI build passed on F: (`build-final.log`); source,
registered-test and desktop typechecks passed, and the UI build includes its
own typecheck. The actual WebPlugin-served UI passed the ten browser checks in
`browser-receipt.json`: real News/category queries, corrected headlines and
bodies, source diagnostics, keyboard originals/Escape/focus return, 320px
reflow, and incoming-report count/scroll preservation/explicit acceptance.
The incoming-update check withholds one real archived original only in browser
transport; the collection-time-label check uses an explicitly fictional item.

An actual two-original NVIDIA GTC Berlin story was manually prepared through
the existing story API in the isolated home (`real-story-artifact.json`,
`real-story-receipt.json`). Preview, overview and both original links were
checked in the real browser, including Escape/focus return. Stale revision and
disabled collection both returned 409. Publication left archive bytes unchanged.
This proves a prepared real-data reading workflow, not automatic inference.

Node source startup diagnosis (`node-source-probe.json`): manager import
1,965ms, full main import 55,353ms, actual readiness 69,869ms, normal IPC exit 0
and runtime lock removed. The copied shutdown fixture's 45s startup allowance
ended before that behavior was reachable. It now separates a 90s source startup
budget from its 15s shutdown budget and 5s forced-test cleanup. Its Connector is
a test-owned loopback 503 server; failure diagnostics exclude auth banners and
evaluate when the deadline fires. Both normal and failed-module-close Node
assertions passed in `integration-final-retry.json`. That receipt is still
`accepted=false`: one unchanged Guardian process-tree assertion hit its default
5s timeout during concurrent checks (12 executed assertions passed, one failed,
four platform skips). Do not call that suite green. The full repository run and
the final isolated retry remained pending at that checkpoint.

The subsequent serial 32-file retry (`serial-focused.json`) exposed 33 failures
and 266 passes, with one platform skip. Most worker failures shared the same
Windows boundary: PowerShell/C# preparation consumed the module's 5s startup
allowance, and the separately compiled stop helper also had a 5s wall-clock
deadline. An owned no-victim probe measured the stop helper itself at 4.0–4.4s,
before its possible 2s Job-drain loop. It also omitted the isolated TEMP/TMP.
Those failures are recorded, not relabelled as an accepted baseline.

The host now bounds Windows helper preparation separately at 10s. A single
private greeting after Job assignment and before worker execution starts the
unchanged 5s module-ready deadline; duplicate greetings fail. The stop helper
gets a 10s deadline and the inherited TEMP/TMP; ownership and exit confirmation
remain mandatory. Two timer regressions were observed RED before the fix.
`windows-startup-green.json` then passed 14 assertions (one POSIX skip),
including the real Node module/descendant process tests and four deadline/
protocol checks. The remaining 31 focused files and registered integration
lanes are being rechecked against this correction; earlier broad failures do
not establish their current outcome.

`focused-windows-fixed.json` reduced the broad retry to 283 passes and six
outer-watchdog failures. All real host, manager and collector assertions passed,
including failed restoration. The remaining failures were desktop main's
dynamic import hitting the 5s test limit, the 51-file pagination fixture hitting
5s, one configuration teardown hitting 10s, and an actual rejected module
startup being given only 5s for its whole HTTP test. These fixtures now budget
their complete operation explicitly (desktop 30s, pagination 15s, rejected
startup 30s, configuration teardown 20s). Desktop child-ready/exit assertions
remain 3s, its full startup-plus-close watchdog is 20s, and its mocked 10s force
deadline is still asserted at 9,999/10,000ms. Module ready/collect bounds remain
5s/15s. Their isolated rerun is pending; no production failure is hidden by
changing a global test timeout. The previously recorded Guardian wrapper/tree
case also now has a 20s outer fixture budget for two process startups, OS tree
enumeration and its unchanged 2s graceful/2s forced phases.

The three-file retry passed 15 assertions; pagination still exceeded 15s.
An isolated actual-store measurement (`story-timing.json`) resolved that
uncertainty: 51 serial publications took 15,505ms, while each list/filter/page
read took 11–22ms. The pagination test now seeds its 51 persisted fixtures
directly, keeping publication/revision/atomic-write checks in their dedicated
tests. The first bulk-fixture retry still exceeded the default 5s watchdog
(9,056ms including cleanup); the fixture therefore retains a 15s outer budget
for creating its 51 files. Production store behavior is unchanged. The final
fixture, integration and build checks follow this correction.

The corrected pagination fixture passed all five assertions; its last case took
10,302ms including cleanup. The registered integration retry passed all
Guardian/tree and failed-module-close assertions (12 passes, four platform
skips), but the normal Alice case exhausted its 90s source-startup budget before
any engine diagnostic. That is `integration-windows-fixed.json`, accepted=false;
the acquisition lane was not run by that failed selector. Cold source startup
now has a separate 150s fixture allowance (170s whole case), with safe manager/
main import markers. Its 15s shutdown and 5s owned forced-cleanup deadlines
remain unchanged. Final typechecks/build precede the last registered retry.

Final local evidence for this held working tree:

- `focused-combined-final.json`: 33 files, 304 passed, zero failed, one
  POSIX-only skip. This de-duplicates each file's latest outcome across the
  sequential focused runs; it does not relabel the earlier failed receipts.
- `integration-source-final.json`: selector acceptance=true; hermetic lane
  13 passed/four platform skips and acquisition lane 1/1 passed. Both real
  Alice close outcomes, Guardian IPC/tree behavior and unified RSS/X/company
  archive, cursor recovery, overlap deduplication and provider-failure recovery
  passed. X/company transport is loopback fixture data, not paid/live evidence.
- Source, registered-test and desktop typechecks passed. The final build
  (`build-after-windows.log`) passed all 16 workspace tasks (15 cached), main
  declarations and worker entry. The UI had no source changes after its actual
  ten-check browser acceptance described above.
- The own preview collector was paused through HTTP (200), then the preview,
  RSSHub and Connector quarantine processes were stopped after checking their
  PID, creation time and command/parent ownership. `preview-cleanup.json`
  records forced test-service stops, not graceful Alice-exit evidence. The
  independent registered IPC tests supply that exit evidence. Screenshots,
  isolated state and receipts remain outside the repository under the F: root.

The local increment is ready for maintainer review on the held branch. The
full repository test attempt remains incomplete, and this candidate has no
new Electron/native CLI/remote-backend or POSIX runtime acceptance. Live
SocialData/FMP still needs a first company/market, credential configuration
location and request budget; no paid request was made. Continuous coverage and
the wider discovery/digest capability remain open. No commit, push, PR update,
merge or release was performed.

## Latest correction: reading value and information granularity (2026-10-21)

The maintainer rejects the Selected reading increment as providing no actual
reading improvement. The agent's explanation that the structure was merely
too heavy was also explicitly rejected. Do not substitute simplification or
fewer pages for evidence of benefit. The existing page consistency matters;
copying AIHOT's Selected navigation was an agent-added product decision without
an established need. Technical checks and a working Demo do not accept it.

The maintainer says a List and timeline are sufficient presentation, and wants
to test actual data completeness and better display. The financial reference
was dictated as "金石数据" with an explicit voice-input recognition caveat; the
working interpretation is 金十数据's information granularity, rather than a
request for a separate Selected/search page. Do not claim its exact site
behavior has been verified from that wording.

AIHOT must be considered as a news framework: source acquisition/operation,
filtering and writing, deduplication and continuing events, hot-topic discovery,
themes/search, periodic digests and human/agent outputs. Reading tabs alone
cannot represent absorption of that framework. Its public README also makes
clear that some live-site features and production source lists are not shipped
in the open-source engine.

Current action: stop the independent Selected-page direction and further UI
restructuring based on guessed value. Keep existing code as unaccepted work;
do not silently delete unrelated acquisition/accessibility work or rewrite the
page under a new guess. Next evaluation must connect reference capabilities to
actual coverage and observable benefit inside the existing News module. This
clarification changes the acceptance basis; it is not another implementation
approval or a claim that live data completeness has been measured.

## Accepted execution checkpoint (2026-10-21)

The maintainer accepts the product assessment/delivery order below ("这就没什么
问题了，我觉得"). Execute within the existing held branch and canonical plan;
no new approval interview, commit, push, PR update or merge. The separate
Selected destination is withdrawn as a product decision. Preserve acquisition,
original-evidence reading and independent accessibility work.

First increment scope and interfaces: source catalog -> actual public fetch
sample -> shared collector health/JSONL metadata -> news projection/query ->
existing News/Source status UI and Demo compatibility. No paid provider calls
or edits to the user's complete home. Raw archive records remain intact.

- [x] Sample the existing 43 RSS/RSSHub candidates using the production parser
  and an owned isolated RSSHub. Record request outcomes, publication freshness,
  empty material and actual source-window counts, separately from completeness.
- [x] Add fresh-publication, missing-date/content and request-duration evidence
  to collector status; preserve last successful observations on fetch failure.
  Mark newly collected RSS timestamps when publication time is unavailable.
- [x] Validate and add AIHOT's compatible official AI RSS candidates to the
  existing catalog, with explicit opt-in and generated documentation.
- [x] Keep the default News stream and existing navigation. Remove the
  unrequested Selected switch; preserve event context and original access.
  Apply category filtering before the result limit so noisy market sources
  cannot make an available AI/category feed appear empty.
- [x] Run a real isolated collector/archive/API/News preview with working
  financial and AI sources; record actual counts, date provenance, original
  access, category retrieval and keyboard/reflow behavior. Keep one-time
  source-window evidence separate from continuity/latency acceptance.

Ruling: use the canonical plan as the inline execution ledger and the held
dirty feature branch as the workspace. Commit-based skill helpers and another
plan file would conflict with the maintained iteration hold.

### First real-source evidence and implementation

- Scratch evidence root:
  `C:/Users/Administrator/AppData/Local/Temp/openalice-news-coverage-20261021`.
  `coverage.json`: original 43 candidates, 39 parseable in this sample, four
  failed (MarketWatch top/pulse timeout, Yahoo 404, JRJ funds timeout); 34
  contain a dated item in the past 24 hours and 35 in the past seven days.
  This is source-window evidence, not a recall percentage or continuity SLA.
- The three WSJ channels returned RSS whose newest items are from January
  2025. Nikkei returned 50 title/link items without publication dates or body;
  a direct check confirmed those fields are absent upstream, not merely missed
  by the parser. ECB and Seeking Alpha supplied title/link-only items too.
  A single empty title/body placeholder appeared in Jin10's response.
- `ai/coverage.json`: six additional official AI RSS candidates taken from
  AIHOT's pinned seed (`a0d1e75b00ede7e503ca948e71a468db964b2df2`): OpenAI,
  DeepMind, Google Research, Hugging Face, Microsoft Research and NVIDIA. All
  six parsed, four had a last-24-hour item and all had a last-seven-day item.
  Hugging Face returned titles/links without text. Added them as opt-in catalog
  entries; regenerated catalog is 49 entries (34 direct, 15 RSSHub). Existing
  user subscriptions and defaults are not silently rewritten.
- Collector status now separates request success from latest publication,
  missing dates, absent text, empty entries skipped and elapsed request time.
  Completely empty inputs are not newly archived; the public read also omits
  older empty placeholders without rewriting JSONL. Newly collected missing
  RSS dates retain explicit collection-time provenance and the reader labels
  it; such records are excluded from date-based lexical folding.
- Category matching previously happened after the client's global 200-report
  window. The API now filters exact category tags before its result cap, and
  the client, hook, reading page and Demo handler pass the same category set.
  This still uses supplied source/category metadata, not automatic semantic
  topic classification. The general 200-report cap and in-memory query window
  remain part of the next reading/data-continuity work.
- An actual isolated collector with 23 explicitly selected financial/AI feeds
  archived 3,056 deduplicated records on the first run, 648 dated in the past
  seven days (`pipeline-receipt.json`). An independent complete Alice runtime
  also started on 47331/47332 with the same 23 feeds and its own complete home;
  UTA disabled, Connector polling quarantined on an owned loopback 503 service,
  auth enabled. No user home, paid provider or real credentials changed.
- Real API queries return 45 AI reports from all six official sources in the
  seven-day window; the 24-hour AI view contains ten reports from four of them.
  Those are actual stored reports, not synthetic articles or event summaries.
- Actual page inspection exposed XML-escaped Jin10 HTML appearing as raw
  paragraph/break/image tags. Decode the XML layer before stripping HTML for
  RSS/Atom HTML bodies; preserve Atom text and nested literal code. Entity
  decoding is a single pass. Strip only actual tags/comments, preserving
  financial comparisons and quoted greater-than signs. Review caught both a
  comparison-loss regression and overlapping whitespace quantifiers; both
  were fixed with dedicated regression cases.
- The corrected-parser preview uses a fresh complete scratch home `home-v3`,
  copying only the explicitly chosen public-feed configuration. Previous
  scratch archives remain intact. `runtime-receipt.json` records 3,054 archived
  reports, 23 successful source fetches, 45 seven-day AI reports, ten 24-hour
  AI reports and 16 Jin10 reports without leaked HTML. Counts are this snapshot,
  not a coverage target. The 49-candidate table is `coverage.csv`.

### Verification and remaining boundaries

- Backend focused suite: 47/47 passed across parser, collector v2, config and
  News routes. A direct collector/Hono self-check was observed RED then GREEN for
  the new diagnostics/category boundary, and separately for excluding an older
  empty placeholder. These use local fixture transport; live fetch evidence
  is recorded separately above. The escaped-HTML and financial-comparison
  parser cases were also observed RED then GREEN; a 100,000-space incomplete
  tag case returns without the overlapping whitespace path.
- Fresh read-only review initially found no high-confidence new issues in the
  coverage increment; follow-up parser review found the two issues above.
  The reviewer confirmed both fixes, with no further high-confidence findings.
  This does not accept prior lexical grouping or close pagination limitations.
- `browser-receipt.json`: the full existing App frontend (`ui/src/main.tsx`)
  with the real isolated Alice Runtime passed category retrieval, absence of Selected,
  original evidence, keyboard-open/Escape/focus return, source diagnostics and
  320px reflow (body/document both 320px). The real Jin10 query also contains no
  leaked paragraph/break/image tags. No page exceptions. The missing-date
  label was checked on a separate explicitly fictional browser fixture; it is
  not a claim that the enabled 23 feeds supplied an undated report. Screenshots
  `real-news.png`, `real-ai-news.png`, `real-source-status.png`,
  `real-ai-mobile.png` are review evidence for this News workflow.
- UI Vitest workers timed out during startup in both forks and threads; those
  UI cases did not run. Their expectations/fixtures were updated, including the
  Demo status fields. The owning UI `tsc --noEmit` subsequently completed with
  exit 0. Root `tsc --noEmit` also completed with exit 0. Both incremental
  build-info files are outside the repository in the scratch evidence root.
- The native complete Runtime reached readiness. Vite's HTML response stalled
  beyond 60 seconds in this environment; the agent-browser CLI also timed out.
  Used an installed-Bun bundle of the full existing application and isolated
  Playwright for News workflow evidence. The real preview is available at
  `http://127.0.0.1:5173/market/news`, with Demo mode absent and auth/origin checks
  retained. Source-only preview on 5178 was stopped. This temporary bundle does
  not establish Vite/package-build, native PTY/WebSocket or other app-flow
  acceptance; no product build pipeline or dependencies were changed.
- Continuous coverage and publication-to-arrival latency are still unmeasured;
  X/FMP live providers and automatic content preparation/hotspots are pending.
  This increment establishes the first real-data baseline, not whole-product
  acceptance. Next reading improvements must use this same real material.

## Product capability assessment and proposed delivery order (2026-10-21)

The maintainer asks how to make the capability and the News product good as a
whole. Removing Selected or declaring List/timeline sufficient does not answer
that request. The following direction was subsequently accepted; specific
replacement layout and live capabilities still require evidence.

### User outcomes and reference allocation

- During continuous reading: notice new facts promptly, distinguish repeated
  coverage from a new development, and retain position when updates arrive.
- During investigation: recover the original statement, attribution, conditions,
  corrections and earlier developments without reconstructing an event manually.
- During discovery/catch-up: find independently spreading subjects and catch up
  on changes since the previous visit, including AI/industry before any explicit
  company or stock association exists.
- Use Jin10 as the financial flash granularity/coverage reference and AIHOT as
  the acquisition, filtering, fact/story grouping, discovery and operations
  reference. Reuse the established Alice navigation and components.

Fresh evidence: AIHOT's public hot board shows an event summary, latest
development, independent sources/participants and historical movement. Its
topics separate companies/models, technical directions and content types. Its
source/selection guides distinguish official material, reporting and discussion
signals, and evaluate actual samples. Jin10's official indexed homepage exposes
market flashes, important events, categories and other product sections, but
direct web reading returns a JavaScript shell; this is not a rendered-layout,
latency or licensed-feed inspection.

References: https://github.com/KKKKhazix/AIHOT,
https://github.com/KKKKhazix/AIHOT/blob/main/docs/sources.md,
https://github.com/KKKKhazix/AIHOT/blob/main/docs/selection.md,
https://aihot.news/hot, https://aihot.news/topics, https://www.jin10.com/.

### Current bottlenecks grounded in code

- The 43-entry source catalog is a set of candidates. Enabled subscriptions,
  successful requests, archived records and visible results are separate states;
  actual coverage across macro, A/HK/US equities, AI/industry and discussion has
  not been measured. X/FMP adapters have no accepted live-provider run.
- `src/domain/news/config.ts` defaults to a ten-minute collection interval.
  `collector/rss.ts` collects source rows sequentially, and `useNewsFeed.ts`
  polls the UI every minute. Actual configured cadence and end-to-end latency
  must be measured before claiming real-time flashes. Different source types
  need cadence compatible with their upstream availability, limits and cost.
- RSS currently assigns collection time to a missing publication date. Preserve
  date provenance and uncertainty before using timestamps for freshness, delay,
  story ordering or heat; old/undated material must not appear freshly published.
- Existing health fields describe attempts, counts and request success, without
  establishing publication freshness or continuity. Diagnose losses at source,
  retrieval, archive, processing, query and display boundaries.
- Prepared story storage/rendering exists, but automatic preparation and hotspot
  production do not. Manually prepared Demo artifacts cannot prove either.

### Proposed product behavior

1. Keep News in the existing application navigation; search operates on that
   page. Selected is not an established destination requirement. Use importance
   and relevance to help find material within the existing reading flow.
2. Preserve the timestamped stream at fact/update granularity. Fold equivalent
   reports into one visible fact, retaining all originals. A genuinely new fact
   appears at its own time and links to the continuing event across days. Do
   not silently hide new facts inside an older collapsed event.
3. Render short flashes directly. Longer articles get a factual Chinese digest
   with original access; social material preserves author, quote and links.
   Event context answers what changed and exposes earlier developments. Missing
   material and unverified statements keep their uncertainty.
4. Use a compact time/content list with stronger content hierarchy, controlled
   summary length and expandable evidence. Consolidate source selection in
   existing filters rather than repeating an overflowing source strip. New
   arrivals show a count and can be inserted without moving the reader's place.
5. Find heat from independent participation, velocity and time decay with real
   history. Distinguish original reporting from reposting/discussion. Importance,
   heat and the user's interests remain distinct signals. A quiet central-bank
   announcement can matter; a loudly repeated rumor can remain unconfirmed.
6. Support subjects/companies/industries alongside explicit stock associations.
   Search, followed subjects, unread updates and later digests consume the same
   facts/events. Preserve the original evidence for native agents and humans;
   do not introduce a parallel model runtime or database.

### Delivery order and acceptance evidence

| Order | Concrete deliverable | Evidence of user benefit |
| --- | --- | --- |
| 1 | A real coverage matrix and collection run: official macro, Chinese market flashes, overseas company/market news, AI/industry, then optional X discussion. Separate candidates, enabled, working, stale and unavailable. Correct date provenance and quantify collection/display delay. | A fixed reference window identifies which expected source items arrived, when, and where misses occurred. No catalog count or Demo stands in for coverage. |
| 2 | Display the same real sample in the existing News page with fact-level folding, genuinely new updates, concise readable content and original evidence. Begin this once the first usable samples exist; do not wait for every provider. | Compare old/new on repeated reading, discovering a new development, source tracing, narrow-screen reading and position preservation. Keep independent accessibility work. |
| 3 | Connect automatic content preparation and durable grouping, then real hotspot signals and followed-subject updates. Reuse AIHOT rules/prompts/algorithms where compatible. | Label real same-fact/new-development/unrelated/roundup cases; measure processing failures and false merges as well as successful cases. Heat must cite actual independent participation and stored history. |
| 4 | Catch-up/digests, calibration and native-agent reuse on the established records. | New facts since the previous visit/day are recoverable, repeated facts do not dominate, and the same evidence can be inspected by an agent. |

Suggested measurement: an initial 48-hour diagnostic sample spanning relevant
sessions, followed by at least seven trading days for initial continuity
acceptance. These are proposed windows, not established SLAs. Define coverage
against an explicit obtainable reference set; no claim of worldwide news
completeness. Record missing-item reasons, publication-to-arrival delay (median
and tail), duplicate exposure, false merges, late/missing developments and
summary/date fidelity before deciding targets. Do not choose an arbitrary
percentage before obtaining the baseline.

This assessment changes only the canonical plan. No product code, tests, live
subscriptions, credentials, paid requests or GitHub state changed in this step.

## Current maintainer direction: AIHOT as the main reference

The maintainer rejects the bulky source-coverage strip, duplicate filtering and
unclear panel hierarchy. Earlier local checks establish functionality, not
acceptance of the reading design or adequate real source coverage.

Accepted product direction: AIHOT's acquisition, content organization,
selection, aggregation and reading experience, with coverage of macro, AI,
technology/industry, companies and assets. An AI/industry event can matter
before it has any identified stock relationship. Dates are supporting metadata;
events can develop across days and must retain original evidence and updates.
Do not force every event into a company/ticker or invent a trading impact.

The maintainer explicitly corrected the interpretation of FinancialJuice:
`https://www.financialjuice.com/home` is a reference for financial information
coverage, not a request to copy its interface or build a trading workbench.
AIHOT remains the main product and content-organization reference. This
supersedes a generic today/yesterday article-list framing. A revised panel
design remains to be shown; no replacement layout or semantic-event
implementation is accepted yet.

Public FinancialJuice HTML was inspected: My News, asset-class categories,
Macro and Market Moving are visible. Direct automated browser rendering was
blocked by the site's security service; live panel layout and authenticated
features have not been verified. Do not claim an exact visual reproduction
based on this limited inspection. No product code changed during that earlier
clarification; the subsequent accessibility changes are recorded below.

## AIHOT alignment checkpoint after accessibility acceptance (2026-10-21)

The maintainer says the current increment is broadly OK but still insufficient,
and asks to use the Superpowers process to align with the original reference.
Accessibility acceptance is a foundation; it does not close the original
content/source/reading objective. This is continuation, not a request to
discard the working collector or begin a trading workbench.

Process disclosure: the preceding increment primarily followed
`better-accessibility`; it was not a complete Superpowers product-design
cycle. Use the existing confirmed requirements during brainstorming rather
than interview the maintainer again about the same goals. This checkpoint is
reference research and a proposed direction, not an approved full design or a
claim that implementation has begun.

### Reference checked again

- `git ls-remote` confirms upstream `main` still equals the existing review
  clone: `a0d1e75b00ede7e503ca948e71a468db964b2df2`.
- Read the live public [selected feed](https://aihot.news/) and
  [hot board](https://aihot.news/hot), plus upstream
  [selection rules](https://github.com/KKKKhazix/AIHOT/blob/a0d1e75b00ede7e503ca948e71a468db964b2df2/docs/selection.md),
  [source guide](https://github.com/KKKKhazix/AIHOT/blob/a0d1e75b00ede7e503ca948e71a468db964b2df2/docs/sources.md),
  `apps/web/app/routes/{home,hot,story}.tsx`,
  `apps/web/app/features/feed/`, and `packages/contracts/src/site.ts`.
- The public feed exposes source/time, a readable headline, a factual summary,
  a selection reason, and other coverage. The hot board represents events,
  distinguishes reporting sources from participants and shows developments.
  The story contract separates reports, facts/developments and a story digest.
- Direct headless navigation did not produce the expected rendered reference
  page in this attempt. Live text and pinned source were inspected; do not claim
  a fresh visual or pixel comparison from this run.

### Concrete gaps

| Area | AIHOT reference | Current OpenAlice | Alignment target |
| --- | --- | --- | --- |
| Reader entry | Selected feed, all material and event heat have distinct purposes. | Latest/importance/sentiment/watchlist filters share one raw-report stream. | Distinguish worthwhile reading, new material and developing events; keep topic/asset filters subordinate to reading. |
| Content preparation | Relevance filtering, selection criteria, structured facts, readable Chinese summaries and selection reasons. | `NewsArticle` carries raw content and attribution but no reviewed selection result or event synthesis. | Add a separately produced, evidence-linked reading result; a raw report must remain available while processing is pending. |
| Group identity | A fact has multiple reports; a story has multiple facts/developments and its own digest. | `NewsReadingGroup` only contains a transient key, reports and sources. Its title matching uses a 24-hour anchor and the current maximum-200 result window. | Distinguish duplicate coverage of one fact from a genuinely new development of a continuing event; give the latter durable identity. |
| Representative content | Official/qualified originals and content quality influence the representative report. | The newest report supplies the group's visible title and content. | Use an explained representative or a sourced event overview; do not let a later repost automatically become the event's voice. |
| Event reading | Overview, developments, reports, provenance and heat have separate roles. | The Sheet repeats raw rows in chronological order. | Explain what happened, what changed and what evidence supports it, then expose all originals. Dates remain supporting metadata. |
| Source operation | Configurable adapters, provenance tiers, participation modes, trial collection and actual health. Public seed sources are not the production account pool. | RSS/RSSHub, optional X/company-news v2 adapters and a 43-channel catalog exist; real provider coverage is not established. Source roles are not a complete editorial/signal policy. | Demonstrate real usable coverage and classify official statements, reporting and discussion; importing a catalog or a module is not source acceptance. |
| Heat | Independent participants/sources and time decay; quality and discussion heat are different. | Visible report/source counts have no equivalent event heat/history. | Deduplicate attribution and separate freshness, discussion heat and selection importance. Do not display an invented score or sparkline. |
| Domain scope | Its public site is AI-focused and its selection rules are customizable. | Market navigation is dominated by markets/assets; AI has no equally clear reading entry. | Make AI/technology/industry readable alongside macro/company/market news even without any stock association. |

### Proposed next increment and acceptance

1. Prepare a concrete comparison using the same source-linked sample events:
   an AI/industry development, a macro development, and a company/market event.
   Show the reference's reading hierarchy and the corresponding OpenAlice
   view. Clearly label any manually prepared comparison data; do not imply that
   a new automated pipeline already exists. This is the next reviewable result,
   ahead of another round of spacing or animation polish.
2. Specify the read contract for original reports, facts, continuing stories,
   developments, summaries/reasons and provenance. Define stable identities,
   corrections and additive versioned file persistence before implementing the
   event index. Existing JSONL archives and v1 artifact identities remain valid.
3. Run a small real-source collection through the existing collector and native
   agent processing path. Keep model processing off page reads and outside an
   in-process agent/model loop. X/provider credentials and paid quota still need
   a real configured choice; free source and UI work can continue independently.
4. Accept against the same samples end to end: different-language coverage of
   the same fact is combined; a later development stays distinct inside the
   same continuing event across days; original attribution and uncertainties
   survive; an AI story without a ticker remains discoverable; source coverage
   is backed by actual successful collection. A working Demo alone is not this
   acceptance.

Keep React/Vite, the shared collector, native CLI ownership and file-backed
state. Reuse AIHOT's applicable product behavior and licensed code where it
fits; its PostgreSQL/queue/model runtime is not a drop-in Alice subsystem.
FinancialJuice remains a data-coverage reference. No product code, real
subscription, paid request, commit, push or PR state changed in this checkpoint.

## Execution correction and reading delivery (2026-10-21)

The maintainer asks why the agreed alignment was still not implemented. The
failure was task drift: local acquisition/accessibility checks became stopping
points, and the next turn produced another proposal. Requirements and local
implementation authority were already available. Stop repeating approval
requests for the same direction; return a working, inspectable reading slice.
Keep the held branch and all previously verified acquisition/accessibility work.

Execute inline using Superpowers' plan and RED/GREEN/review principles. The
canonical plan is also the progress ledger; the maintainer's existing no-commit
iteration hold overrides the skill's commit-based helper scripts.

Scope: an additive versioned story artifact referencing durable archive report
IDs; a validated read/publication API; selected/latest/events reading entries;
event overview, distinct developments and original evidence; AI/technology
navigation; explicit Demo data. No new model runtime or invented heat score.

Pre-flight interfaces: story contract -> store/API -> UI/client/hook -> Demo.
The same report IDs and development references must survive every boundary.
Original JSONL and existing raw-news queries remain compatible. Publications
must reject unknown reports, duplicate fact/report identities and stale updates.

- [x] Define and check the report/fact/story contract and versioned file store.
- [x] Connect read/publication APIs and preserve raw-material reading.
- [x] Implement selected/events reading and overview/developments/evidence.
- [x] Provide three explicit Demo stories, including AI without a ticker and
  a development across days; keep all evidence accessible.
- [ ] Run owning checks and inspect the current rendered surface; record
  remaining live-source and automatic-processing gaps without claiming closure.

Implementation evidence: `docs/news-reading.md` owns the new optional file
family and API. The reader separates Selected, Latest and Events, with topic
links for AI and technology. The standalone source-component Demo at
`http://127.0.0.1:5177/market/news?view=selected` is inspectable; this is not the
complete application shell or proof of real-source processing.

Fresh reviewer findings and fixes: raw reads no longer hydrate stories;
previews omit bodies/quotes/media and detail loads on demand; publication is
limited to 100 distinct originals and replies with ID/revision; older publishers
remain in Sources; filtering now runs before 50-item pagination, and keyword
search still reaches original bodies. A 51-story regression checks that an older
selected story survives 50 newer unselected stories and that a body-only term
finds its story. The built-in archive resolves/matches evidence in one scan.

Current checks: 36/36 backend unit/route cases passed. Isolated Playwright
source-component checks passed for the three reading entries, AI without a
ticker, >48-hour history, lazy evidence bodies, older-source options, body-only
keyword search, source-role filters, quoted originals, modal keyboard
containment/Escape/focus return and 320px reflow. A removed evidence button
returns focus to the house Sheet popup; do not require an invented exact focus
target when keyboard reading remains contained and operable.

Earlier UI Vitest attempts timed out before worker startup (both forks and
threads); no assertions ran in those attempts. A fresh UI run and UI/root
typechecks are pending. The touched archive-store tests formerly shared a
checkout-local JSONL path, producing slow hooks and unsafe concurrent reuse;
they now use one unique temporary directory with cleanup, and all 36 backend
checks passed with ordinary timeouts. No shared process was terminated.

Remaining product boundary: these three events are explicitly fictional and
manually prepared. Automatic selection/semantic processing, real X/provider
credentials, adequate live coverage and full application acceptance remain
open. Publication and read contracts enable that processing; they do not
implement a scheduler/model runtime. The feature-branch iteration hold remains.

## Accessibility follow-up

The maintainer explicitly invokes `better-accessibility`. Audit and fix the
current News reading, report details, source directory, source/module forms and
their update behavior. Check keyboard paths, accessible names/states, focus,
errors, announcements, reduced motion, 320px reflow and 200% zoom. Keep existing
theme/components and the held branch. This is a scoped accessibility increment,
not acceptance of the wider redesign or real source coverage.

- [x] Inspect source and reproduce issues in an isolated preview browser.
- [x] Add focused regression cases, then fix confirmed root causes.
- [x] Recheck keyboard flows, accessibility tree, automated rules and owning
  tests/typecheck; report WCAG criteria and explicit unverified areas.

### Accessibility findings and disposition

#### Operable

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `ui/src/index.css:242` | Custom focus shadows can disappear in forced colors while outlines are suppressed. | Restore a 2px system-color outline in forced colors. | WCAG 2.4.7: keyboard focus must remain visible. No color-contrast measurement is claimed. |
| MEDIUM | `ui/src/pages/NewsPage.tsx:225`; `ui/src/hooks/useNewsFeed.ts:111`; `ui/src/pages/NewsCollectorPage.tsx:195`; `ui/src/components/news-modules/NewsModulesSection.tsx:210` | News and status replace themselves on timers without a pause control. | Visible automatic-update checkboxes stop polling and suppress late automatic publication. Manual refresh remains available. | WCAG 2.2.2: readers can pause auto-updating content. |
| MEDIUM | `ui/src/pages/NewsPage.tsx:177`; `ui/src/components/news/NewsSourceCatalog.tsx:23` | Directory navigation uses a button and scrolls without moving keyboard focus. | Native link retains its directory fragment in a new tab; after loading, focus moves to the directory heading. | WCAG 2.4.3 and native navigation semantics. |
| MEDIUM | `ui/src/pages/NewsCollectorPage.tsx:144` | Pointer-only blocking leaves visibly disabled settings editable by keyboard. | Native disabled fieldset supplies consistent control state and behavior. The directory itself retains a keyboard reading target. | WCAG 4.1.2: exposed availability must agree with behavior. |
| LOW | `ui/src/pages/NewsPage.tsx:165` | Revealing additional results relies entirely on a scroll observer. | A Show more reports button also reveals a batch and focuses its first headline. | Keyboard reading recommendation; the existing observer's native keyboard-scroll path is not classified as a WCAG failure. |
| LOW | `ui/src/components/news/NewsSourceCatalog.tsx:50` | The directory has no explicit keyboard target/name when its buttons are unavailable; current Chrome still supplies a native scrolling focus target. | Named group with `tabIndex=0`; Tab from the collection switch reaches it while its fieldset is disabled, and PageDown scrolls it. | Keyboard consistency recommendation supporting WCAG 2.1.1; the pre-change full build was manually checked and this is not a confirmed failure in current Chrome. |

#### Understandable

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `ui/src/pages/NewsPage.tsx:188`; `ui/src/pages/NewsCollectorPage.tsx:391`; `ui/src/components/news-modules/ModuleCredentials.tsx:38`; `ui/src/components/news-modules/NewsModulesSection.tsx:60`, `:113`, `:166`, `:301` | Some custom errors lack field associations/focus; empty credential submit is disabled instead of explaining the error; busy credential submission can drop focus. | Inline descriptions, invalid state and focus after rendering; enabled submit validates empty/whitespace input; saving retains focus and ignores repeat submissions. | WCAG 1.3.1, 3.3.1 and 3.3.3: identify the field and explain how to correct it. |

#### Robust names and announcements

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `ui/src/pages/NewsPage.tsx:307`; `ui/src/components/news/NewsSourceCatalog.tsx:62` | Original-link and Add source ARIA names omit their visible text. | Native visible publisher name; Add source keeps its visible text and appends the publisher for assistive technology. | WCAG 2.5.3: visible text must occur in the accessible name. |
| MEDIUM | `ui/src/pages/NewsPage.tsx:223`, `:387`; `ui/src/pages/NewsCollectorPage.tsx:313`; `ui/src/components/news/NewsSourceCatalog.tsx:68`; `ui/src/components/news-modules/ModuleCredentials.tsx:60`; `ui/src/components/news-modules/NewsModulesSection.tsx:57`, `:77`, `:246` | Several status regions arrive already populated or credential outcomes have no dedicated announcement. | Stable polite regions precede updates and report counts, failures, empty searches and credential outcomes. | WCAG 4.1.3: status must be available without moving focus. Actual screen-reader speech remains unverified. |
| MEDIUM | `ui/src/pages/NewsPage.tsx:66`; `ui/src/pages/NewsCollectorPage.tsx:594` | The browser title does not distinguish these views. | News/category and News Collector titles. | WCAG 2.4.2: the current page has a descriptive title. |

#### Reflow protection

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW | `ui/src/pages/NewsPage.tsx:180`, `:234` | A zero-minimum inner news pane can collapse when filters consume a short viewport. | Minimum reading-pane height with an outer vertical scroll fallback. | Preventive support for WCAG 1.4.4/1.4.10; no pre-change rendered failure is claimed because the original preview was unavailable. |

### Accessibility verification evidence

- Latest focused root-config Vitest run, Node 24, forks, one worker: **7 files,
  63/63 passed**. Covers reading groups, request cancellation, paused/in-flight
  polling, manual refresh, keyboard batch reveal and focus, modal Tab/Escape/
  return, directory focus/naming, source validation, credentials, subscription
  validation, exact-hash validation and paused module status. Initial worker
  startup failures and earlier stale assertions are excluded from success.
- Owning UI `tsc --noEmit -p ui/tsconfig.json`: **exit 0**, repeated after the
  final production changes. No root/backend or packaged runtime acceptance is
  implied by this UI check.
- Chromium isolated source Demo: inspect the accessibility tree; keyboard
  navigation, modal Tab/Shift+Tab containment and exact trigger return; source
  directory landing; native disabled controls; empty-key feedback; status pause
  for 16 seconds with zero requests and manual refresh issuing both status
  requests. 320px has no horizontal overflow. At 200% root text sizing, native
  Tab reaches the first original link inside the scroller; the equivalent 200%
  viewport/DPR case uses 640x450 CSS pixels at DPR 2. These are simulations,
  not a claim to have exercised the browser's zoom-menu command.
- Native date controls show their segment focus indicator; host-element-only
  CSS inspection misses this. Screenshots were inspected. Forced-colors focus
  computes to a solid 2px system-color outline. Reduced motion brings the
  Sheet transition to the shared near-zero duration (0.01ms).
- axe-core 4.10.2, WCAG A/AA tags through 2.2, with color contrast excluded:
  News and report dialog have zero violations. The enabled directory has zero
  violations. In the disabled-fieldset case axe still flags
  `scrollable-region-focusable`; a **real Tab** reaches the new group and
  PageDown changes its scrollTop to 385, so this remaining automated finding
  is manually cleared. Do not report a completely clean automated run for that
  disabled case. The earlier full build also lets Chrome Tab into the bare
  scroller, so adding the explicit group is an enhancement, not a claimed HIGH
  fix. The full shell also has two incomplete `aria-controls`
  checks on lazily mounted navigation popups; they are outside this news scope.
- The ordinary Vite Demo build completed into a temporary directory, with its
  existing chunk-size warnings. Development servers intermittently stopped
  serving during module loading. The complete built shell was inspected first;
  the final current News/Collector components and CSS were then bundled into
  an isolated preview with installed esbuild/Tailwind tools. The final directory
  focus fix was rechecked in that current component preview, not falsely
  attributed to the earlier full build. No project build configuration or
  dependency changed. The late forced-colors CSS rule was also checked in the
  source preview; the earlier full build used a temporary supplemental copy of
  that exact rule. Optional Vercel analytics is stubbed in the static full-shell
  audit because this local preview does not host that script.
- Scripts, axe results, accessibility trees and inspected images:
  `C:/Users/Administrator/AppData/Local/Temp/openalice-news-a11y/` and
  `.../openalice-news-a11y-final-components.cjs`,
  `.../openalice-news-a11y-manual-cases.cjs`. Only isolated Demo state was changed;
  no real source subscription, provider credential or trading state was used.
- **Not verified:** NVDA/VoiceOver speech, measured contrast across themes,
  actual browser zoom-menu behavior, other browsers, packaged Electron/CLI,
  real provider acquisition and the wider application. No new full-repository
  suite or release acceptance was run.

**Approve — inspected News/Collector accessibility scope only.** No confirmed
HIGH finding remains; the broader AIHOT redesign and live-data acceptance stay
pending. The Draft #1767 iteration hold remains in force.

## Goal and accepted scope

The maintainer accepted event aggregation reading and clearer, broader news
sources after the AIHOT comparison. Keep the current React/Vite frontend,
native Agent CLI boundary, collector and JSONL archive. No model calls on page
reads, new dependencies, automatic subscriptions or archive rewrites.

Owner guides: [[docs/news-sources.md]], [[docs/news-modules/sdd.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/testing.md]].

## Earlier local increment design

Historical implementation scope, not the full AIHOT alignment target above.
The source-coverage strip mentioned here was subsequently removed during the
accessibility increment.

- Group the reports returned for the current filters, with an explicit switch
  back to all reports. This is a conservative reading projection, not a durable
  semantic event identity or complete archive index.
- Match canonical article URLs or near-identical informative headlines within
  24 hours, against an immutable anchor (no transitive chaining). Different
  numbers or polarity remain separate. Never discard source articles.
- Show report/source counts and first/latest time. Open the complete reporting
  timeline in the existing accessible Sheet, retaining scroll and filters.
- Make source coverage visible on News. Replace the settings preset dropdown
  with searchable categorized source cards showing Direct/RSSHub and whether
  already subscribed. All additions use the existing save path.
- Expand the server-owned opt-in Chinese finance catalog using upstream RSSHub
  route definitions; classify current Chinese presets. Route existence is not
  live availability. Existing subscriptions and defaults remain authoritative.
- Extend demo fixtures with clearly illustrative multi-source Chinese stories;
  fixtures never establish real subscriptions or live collection success.

## Implementation and verification

- [x] Add deterministic grouping cases: multilingual punctuation, shared URL,
  similar reports, conflicting numbers/polarity, short headlines, invalid dates,
  24-hour boundary and non-transitive grouping. Implement the pure UI helper.
- [x] Integrate grouped/all reporting modes, counts and accessible source
  timeline; exercise opening/closing and retain existing filter/recovery tests.
- [x] Add source coverage and searchable categorized settings cards; exercise
  explicit additions, duplicate prevention, empty/error states and full-config
  preservation through existing tests.
- [x] Expand catalog, regenerate source guide and update four locales/demo.
- [x] Run targeted tests and UI typecheck; inspect the running demo at desktop
  and narrow widths. Record actual evidence and limits before handoff.

## Acceptance limits

The current News endpoint caps output at 200 articles; the UI must label this
window and never claim a complete event census. Cross-language paraphrases and
different developments are not inferred by lexical grouping. Future semantic
analysis belongs in native CLI tasks with separately approved persistence.

## Actual evidence (2026-10-21)

- Node 24.21.0, installed Vitest 5.0.1, threads pool / one worker: the final
  eight-file run passed 67/67 assertions (grouping, catalog, NewsPage, feed
  editor, useNewsFeed, demo list/config handlers and server config). One later
  catalog error/retry assertion and category checks were added; that file
  separately passed 3/3. No production changes followed the last full run.
- `node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit`: exit 0 on
  the final production changes. Demo-mode Vite build to a temporary output:
  exit 0, 3923 modules; existing large-chunk warnings remain.
- Independent read-only review found signed-number and contracted-negation
  false merges. Both were reproduced by failing tests, fixed, passed, and
  independently rechecked by inspection. The two-file fix run passed 32/32.
- Actual browser flow on the live source Demo at `127.0.0.1:5173`: 15 reports
  form 12 groups; the three-source timeline contains all three originals;
  Escape closes it; All reports restores all 15. Explicit source addition
  changes only the mock session. Source-directory navigation reached top=93px.
  Desktop 1440x1000 and narrow 390x844 checks, including the details Sheet,
  passed without document overflow or page errors. Requests cancelled by
  StrictMode/navigation were observed and are not collection failures.
- Screenshots and runnable browser probe are local, under
  `C:/Users/Administrator/AppData/Local/Temp/openalice-news-reading/` and
  `.../openalice-news-reading-review.cjs`. The accepted final browser run used
  an isolated Chromium context with `--no-proxy-server`; earlier local request
  timeouts remain environment observations, not a diagnosed Node defect.
- A separate static-preview diagnostic rendered the flow but failed its
  zero-page-error assertion (`Unexpected token '<'`); it is not counted as
  clean browser acceptance. The source Demo is the handoff surface.
- Existing local RSSHub at `D:/temp/rsshub/dist/index.mjs`, temporarily bound
  to loopback 1212 with memory cache: `wallstreetcn/live/global`,
  `wallstreetcn/live/a-stock`, `jrj/103`, `jrj/010` each returned HTTP 200,
  RSS and 3 items. Receipt: `.../openalice-news-reading/source-probe.json`.
  This is upstream-feed evidence, not a live Alice ingest or all-channel SLA.
  The temporary RSSHub process was stopped and port 1212 released.
- Catalog now has 43 channels (28 direct, 15 RSSHub), including 12 new channels
  from two additional publishers. Defaults and real subscriptions are untouched.
  Real RSSHub availability of the other eight new channels, full repository
  tests, packaged Electron/CLI and live Alice ingestion were not checked.

The source Demo remains on port 5173 under the already-installed Node 24; the
system Node selection was not changed. Existing Draft #1767 and its prior
module/runtime acceptance gaps remain unchanged.

## AIHOT acquisition follow-up after maintainer correction

Pinned upstream: `KKKKhazix/AIHOT@a0d1e75b00ede7e503ca948e71a468db964b2df2`
(fetched again for this source investigation). Read `docs/sources.md`,
`sources/x.ts`, `providers/socialdata.ts`, `sources/collect.ts`,
`jobs/content.ts`, the X Article extraction path and the relevance prompt.

- Six collector kinds converge into shared material/processing: RSS, HTML
  listings, JSON listings, X search, WeChat accounts and external pushes.
- X uses an authenticated SocialData API adapter (`/twitter/search`), configured
  by accounts/search queries, not the RSSHub catalog. It retains post identity,
  author, original timestamp, expanded links, quoted post and media references.
  Incremental cursors, bounded backlog, batching, receipts and budgets are part
  of the acquisition capability. No paid API was called in this investigation.
- Editorial sources enter relevance/selection/structuring/grouping; hot-signal
  sources normally bypass selection and contribute discussion evidence to
  grouping/heat. The two roles cannot be represented by one flat source list.
- The relevance prompt judges supplied content as PASS/BLOCK/UNKNOWN; account
  selection and topic judgment are separate responsibilities. X Articles have
  their own body lookup; link-only/empty posts are not assigned invented copy.
- The public seed actually contains 18 RSS sources and no X accounts. README
  explicitly excludes the production source list, so its actual account pool,
  coverage and paid-provider service internals are not established by this code.
- Correction: the agent treated lexical folding plus added channels as a
  sufficient first absorption without tracing this complete acquisition and
  processing contract. Preserve that increment as a reading projection; it
  does not implement social-source collection, roles or semantic event identity.
  Further product scope remains to be selected from the restored full pipeline.

## Unified acquisition direction — maintainer follow-up

The maintainer endorses applying AIHOT's source-layer approach beyond X to
stock/financial news. This approves the direction for design; the following is
a proposal, not an implemented ABI or authorization to purchase API access.

### Alternatives and recommendation

- Keep adding RSS/RSSHub presets: smallest change, but leaves social content,
  stock identities, checkpoints and provider failures outside the contract.
  Reversible catalog changes cannot deliver the requested source capability.
- Extend the existing News acquisition contract (recommended): adapters feed
  the existing collector/store; source subscriptions describe accounts, feeds
  or company queries. Requires versioned contract/storage evolution and reader
  compatibility work, but preserves one archive and current installations.
- Import AIHOT's backend: brings its processing system, but also PostgreSQL,
  queues and a model workflow incompatible with Alice's current boundaries;
  migration and rollback cost are substantially larger. Do not take this path.

### Proposed responsibilities

1. Acquisition adapters own protocol-specific fetching: retain RSS/RSSHub,
   add an X adapter and a company-news adapter. Listing/JSON adapters can follow
   demonstrated source needs; do not build a universal scraper first.
2. Subscriptions describe a publisher/account/query and polling policy. Provider,
   original publisher, source role (official/reporting/discussion), topic and
   asset association are separate concepts. Official origin is provenance,
   not an automatic guarantee that a statement is correct.
3. Shared material records retain stable upstream identity, canonical URL,
   author/publisher, original content and time, collection time, media/quotes,
   language and market-qualified asset references when supplied. Unknown time
   or asset association remains unknown; collection time is not publication
   time, and provider summary is not a full article. Preserve each original
   even when a reading group combines reports.
4. The host owns credential bindings, checkpoints, validation, deduplication,
   retry/rate limits and collection health. Adapter credentials must not enter
   ordinary subscription params, archived content or diagnostic URLs. Reuse
   existing lifecycle/sealing primitives where applicable; the RSSHub-specific
   key binding alone is not a generic provider credential service.
5. Downstream event reading consumes the archive. Later semantic analysis must
   use Alice's native agent capabilities; do not copy AIHOT's in-process model
   pipeline. The current lexical groups remain a limited reading projection.

### Smallest useful first delivery (proposed)

- Keep existing macro/RSS sources working and opt-in subscriptions unchanged.
- Connect one X account/query through a selected, configured provider and one
  company-news query, alongside that company's official release feed where
  available. Start with one company as a cross-source proof, not a claim of
  comprehensive US/A-share/HK coverage.
- Reuse suitable existing provider implementation code privately. OpenTypeBB's
  `CompanyNews`/`WorldNews` models already exist, but are not evidence of News
  collector integration or current external availability. Its compatibility
  HTTP hierarchy must not become a new product contract (market-data guide).
- Show source cards with publisher, content type, account/market/company scope,
  last attempt, last success, actual newly archived count and actionable error.
  A successful empty batch differs from a failed request; partial symbol
  failures must remain visible. Do not derive health from a catalog entry.
- Acceptance: three available source types archive real originals; the same X
  post collected through overlapping queries deduplicates; a restart/retry
  neither skips unarchived records nor duplicates archived ones; failures of
  one provider leave other sources and non-trading startup available. Verify
  desktop/mobile attribution and originals without requiring UTA.

### Implementation constraints to resolve before coding

- ABI v1 is strict and has no host checkpoint or rich-material envelope. Define
  an explicit compatible version transition with existing artifact approvals,
  workers, config/API clients, fixtures, tests and store readers. Released
  persisted changes require the normal migration mechanism; no archive rewrite
  or silent approval of altered artifacts.
- Existing JSONL writes can commit a batch prefix. Advance a checkpoint only
  after its represented records are durable; replay must use stable IDs. Keep
  provider page tokens distinct from a successfully archived high watermark.
  Rate limits and bounded backlog cannot be described as lossless coverage.
- Current worker collect limit is 15 seconds; AIHOT's X search allows 60.
  Decide bounded page size/timeouts and cancellation explicitly rather than
  silently increasing the global deadline or assuming upstream timings fit.
- YFinance's current company-news implementation can suppress per-symbol
  failures and passes `text`/`symbol` through instead of mapping them to the
  standard `excerpt`/`symbols`; check mapping and error semantics before reuse.
- Provider choice, available credentials, paid request budget and first market
  are still open. A US company is a convenient proposed cross-source sample,
  not a maintainer selection. A-share/HK official announcements need their own
  verified connectors/identifiers; generic company news does not prove them.

Evidence: local News Module ABI/SDD, market-data architecture guide and
OpenTypeBB company-news implementations; pinned AIHOT code above. This follow-up
changes only the plan. No paid request, credentials, production subscription or
archive was changed, and no acquisition end-to-end acceptance is claimed.

## Implementation follow-up after direction acceptance

Maintainer accepted the unified acquisition proposal. Continue on the held
feature branch; no merge/release. Use Superpowers writing-plans and inline
execution, with this file as the single plan and progress record.

- [x] Add backwards-compatible v2 manifests/results with original publisher,
  author, media, quotes and market-qualified symbols; preserve v1 artifact
  hashes and array results. Cover schemas and rejection boundaries first.
- [x] Extend the worker/manager/collector path for v2 result envelopes and
  host-owned checkpoint acknowledgement after all represented writes succeed.
  Scope checkpoints to artifact plus subscription query identity. Preserve
  originals in the existing string metadata/JSONL contract.
- [x] Add sealed exact-artifact credential storage, serialized management API
  and password inputs; never return credential values or infer paid consent
  from installation. Fetch errors must omit URLs containing credentials.
- [x] Deliver opt-in SocialData X and FMP company-news artifacts with bounded
  network work. Provider choice remains replaceable; these are configured
  adapters, not purchases or automatically selected production providers.
- [x] Cover v1 compatibility, v2 replay/checkpoint failure, rich content and
  adapter mapping using local fixtures. Run owning checks, update owner docs
  and inspect the affected UI. Real paid acquisition remains pending actual
  provider selection/credentials; do not describe fixtures as live acceptance.

Scope includes contract, worker, host, manager, collector, private runtime-state
files, news routes, API/UI types, module credential controls, producer artifacts,
fixtures/specs and owner documentation. No new dependency or model workflow.
New state is additive and versioned; existing archives/config/artifact hashes
must not be rewritten. Keep unknown publication time as an explicit failure in
this first producer set rather than manufacture a timestamp.

### Local follow-up evidence

- Ruling: add explicit ABI v2 rather than extend strict v1 records. Existing v1
  normalized manifest bytes/hashes and array results stay compatible; no old
  archive/config rewrite. New private runtime files carry version 1 envelopes.
- Ruling: bind provider credentials to the exact approved artifact hash. Do not
  reuse unrelated market-data/broker keys or turn provider compatibility HTTP
  routes into the News API. Upgrades require a fresh explicit credential bind.
- TDD: schema, real worker, state/credentials, manager, collector prefix failure,
  API projection, producer mapping/timezone and UI cases were observed failing
  before implementation/fixes and then passing. Invalid dates, DST gaps/folds,
  unsafe URLs, Windows credential-name collisions and malformed v2 results are
  covered. Ordinary v2 provider errors keep the worker available.
- Final focused source regression, Node 24.21.0, root Vitest config, forks and
  one worker: 29 files, 255 passed, 1 Windows-inapplicable POSIX case skipped.
  After adding the fictional three-source Demo fixture, its affected four-file
  follow-up passed 26/26; no subsequent production logic changed.
- `tsc --noEmit`, `tsc -p ui/tsconfig.json --noEmit` and
  `tsc -p tests/tsconfig.json --noEmit`: exit 0. UI and tests checks were repeated
  after the last fixture/type-assertion correction. Earlier UI check exposed a missing public type
  export and unsupported Testing Library `exact` options; both were fixed.
- Registered `news-acquisition` integration suite (owner alice; integration
  lane) ran through `scripts/run-tests.mjs`: acceptance=true, 1/1 passed.
  Real approved producer workers, loopback provider transport, shared collector,
  sealed credentials/checkpoints, archive restart, three source types, overlap
  dedup and provider failure/recovery were exercised. The source receipt is at
  `C:/Users/Administrator/AppData/Local/Temp/openalice-news-acquisition/integration-receipt.json`.
  It identifies dirty source, not packaged/released artifacts.
- Independent read-only review found comma-containing publisher filters and
  quote-only expansion bugs. Both were reproduced RED, fixed GREEN, and
  independently rechecked without remaining concrete blockers. Demo supports
  literal-source filtering and stores only credential flags, never key values.
- Browser on source Demo: import actual SocialData artifact, approve exact hash,
  save a masked dummy credential, clear input, inspect configured status, and
  cancel generic clear confirmation. Module remains unselected/unloaded;
  no paid provider request. Real desktop 1440x1000 and mobile 390x844 flows show
  the fictional issuer/X/media event, all three originals, author, quote and
  qualified stock association. Literal comma-containing publisher filtering
  returns its own report. No page errors or horizontal overflow; mobile Sheet
  bounds were checked after opening it at mobile width and settling animation.
- Demo has 18 reports in 13 lexical reading groups, including an explicitly
  fictional company sample. It is not live market information. Browser script
  and inspected screenshots are under the same temporary evidence directory
  and `.../openalice-news-acquisition-review.cjs`. Earlier diagnostic browser
  runs with wrong dialog selectors/fixture injection are excluded from success.
- UI threads initially timed out before assertions. A temporary minimal config
  isolated the issue for RED/GREEN work; final root-config forks regression
  passed. The temporary config was removed. No shared test config was changed.

Still pending: choose a real first company/market/provider and enter authorized
credentials; establish provider coverage, actual quota/cost and timestamp
convention; run live acquisition and maintainer acceptance. No paid call, real
subscription/credential modification, model processing, semantic-event backend,
new database or scheduler was introduced. No full repository suite, new final
production build, packaged Electron/CLI or remote runtime acceptance this turn.
The earlier Draft #1767 runtime acceptance hold remains in force.

## Maintainer feedback: compact News filters (2026-10-25)

The maintainer selected `form[aria-label="News filters"]` at 1345x933
(752x52 CSS pixels) and requested less height while reading. Kept this increment
on the held branch without commit, push, PR update or merge.

The default form is now one 28px row with a visible keyword label, search,
Filters disclosure and Clear. Dates and symbol remain available on demand;
valid submission closes them, retains their values and counts applied advanced
conditions. Date-range errors reopen the fields and focus the start date.
Keyboard submission moves focus to Search before unmounting the advanced
fields. A narrow keyword flex basis keeps the applied-filter count on the same
row at 390px. Existing view/topic/source controls and query contracts remain.
All four locales include the short Filters label; the interaction owner guide
records the behavior.

An existing component test failed before implementation because `Access opened`
appeared in both the latest-change preview and the already-present inline
Event timeline. Scoped that assertion to Latest development. UI typechecking
also exposed the existing economic-calendar label array's broad `string` type;
made its existing literals readonly with `as const`, without changing behavior.
The host's pnpm shims were unusable; checks used the repository's existing Node
runner and installed compiler/builder directly, without changing tooling.

| Conclusion | Check | Result and limits |
| --- | --- | --- |
| Disclosure, count, clear, date validation, keyboard focus and navigation work | `node scripts/run-tests.mjs --owner ui --path ui/src/pages/NewsPage.spec.tsx --path tests/integration/ui-navigation/NewsPage.navigation.spec.tsx` | Exit 0: 30/30 assertions. Receipt: `C:/Users/ADMINI~1/AppData/Local/Temp/oa-test-receipt-1792940727116-36080.json`. New disclosure tests first failed on the old UI; the Enter-focus assertion separately failed before its fix. |
| Existing calendar behavior retained after literal typing fix | `node scripts/run-tests.mjs --owner ui --path ui/src/components/news/NewsEconomicCalendar.spec.tsx` | Exit 0: 3/3 assertions. Receipt: `C:/Users/ADMINI~1/AppData/Local/Temp/oa-test-receipt-1792940801481-1724.json`. |
| Owning UI typecheck | `node node_modules/typescript/bin/tsc -b ui` | Exit 0 after the calendar literal fix. |
| Current source built into the existing local preview | From `ui/`: `node ../node_modules/vite-plus/bin/vp build --emptyOutDir false` | Exit 0; preceded by a complete production build. Final entry: `index-XsUgaVdU.js`, CSS `index-B-e02nKC.css`. Existing bundle-size warning remains. No build configuration was changed. |
| Compact at desktop and mobile sizes | Browser at `http://127.0.0.1:47357/market/news?view=events`, 1345x933 and 390x844 | Form height 28px, document horizontal overflow 0. Mobile also remains 28px with `Filters (1)`; Enter retains Search focus. A first browser check caught badge-induced wrapping, corrected by the smaller flex basis. |
| Search and recovery remain functional on preview | Type `Anthropic`, submit, then Clear | One matching event, then four events with keyword removed. Advanced dates and symbol produce `Filters (2)` and remain retained when reopened. Agent-browser's date fill did not update controlled state, so date values for that check were dispatched through the native input setter/input/change events; reversed-date behavior is additionally covered by component tests. |
| User's actual embedded page updated | Orca page `3027b330-4e2c-42a0-a2de-3f02aef9739c`, reload and inspect | Same Events URL, actual viewport 991x966; loaded final `index-XsUgaVdU.js`, collapsed dates, form height 28px. No viewport or sidebar resizing. |
| Static styling and patch checks | Impeccable detect for NewsPage; scoped `git diff --check` | Detector `[]`; diff check exit 0 (existing CRLF warning only). |

Screenshots are in the OS temporary directory:
`oa-news-compact-desktop-final.png`, `oa-news-compact-mobile-final.png`, and
`oa-news-compact-orca-final.png`. The isolated browser session was closed; the
existing preview and the user's tab were retained. No collector/preparation,
credentials, subscriptions, broker writes, model calls, runtime/server changes
or persisted-state migration. No full repository suite, packaged desktop or
remote-runtime acceptance was run. This acceptance applies to the compact
filter form, not the broader held News initiative.
# 2026-10-26 — TradingView reference: market groups and sector ETF tiles

User direction: reference TradingView for the remaining News widgets while
retaining the current News panel. This increment extends the existing market
context with Overview/Watchlist, Forex, Commodities, Crypto and sector ETF
performance groups; only the selected group requests data. Sector tiles use
the existing 11-sector rotation endpoint and explicit lookback returns, equal
tile areas, date/source and signed values. Clicking opens the existing inline
price chart. Related-event asset cards retain only their verified codes.

Preflight on the credential-free isolated preview: EUR/USD and WTI daily bars
returned real records; sector rotation returned 11/11 finite daily returns,
as-of 2026-10-23. Sources: existing BarService and rotation endpoint, without
new providers, keys, model calls, collectors or broker writes. Official visual
references: TradingView Market Overview and Heatmap widget documentation.

Scope: NewsMarketContext, one sector tile component, RelatedAssets caller,
focused component tests, four locales and owning News/interaction guides.
Preserve shared compact filters, all earlier changes and the held branch.
No commits, pushes, PRs, merges or releases.

- [x] Watch the new interaction/data-isolation tests fail, implement the groups
  and sector tiles, and run the affected UI suite and owning typecheck/build.
- [x] Verify real desktop/narrow rendering and inline chart interactions;
  perform the fresh read-only review and record remaining limits.

Acceptance (2026-10-26): `F:/temp/openalice-news-tv-markets-20261026`.
Final root-config UI selection passes 7 files / 67 tests (exit 0), owning UI
typecheck and final UI build pass (exit 0). The current source hashes are pinned
in `accepted-sources.json`; `final-acceptance.json` checks those hashes, browser
results, preview build and original archive. A first forks attempt never started
workers and is not test evidence; the threads RED run executed five expected
failures. Follow-up RED cases exposed forex precision, inaccessible return text
and provider-specific group symbols. All were fixed and included in acceptance.
The first typecheck rejected an unsupported test query option; the final owning
check passes after removing it.

Fresh read-only reviewer `/root/news_tv_market_review` found two P2 issues:
tile returns needed accessible descriptions, and new groups needed canonical
provider-neutral codes. Both are fixed; the final scoped review has no remaining
P1/P2. Forex uses bare currency pairs, commodities use the existing catalog IDs,
and crypto uses BTCUSD/ETHUSD/SOLUSD. Eleven canonical symbols returned finite
real daily bars through the credential-free preview. Commodity names remain
generic because providers can return different instrument forms.

Final browser checks use actual APIs, with no mocks or stored event writes:
1440px and 375px widths have no document overflow; 11 ETF tiles show source/as-of,
lookback changes update the return description, a tile opens one real inline
chart, and closing restores its focus. Forex requests use canonical pairs and
show four decimals; all commodity/crypto cards return dates/providers. The
mobile forex strip scrolls locally (345px), and mobile charts fit 375px. A first
browser wait returned a DOM object, causing a tool serialization error; the
recorded chart assertions and subsequent boolean wait confirm actual rendering.
No page errors were reported. Screenshots: `sector-desktop.png`,
`sector-chart-desktop.png`, `forex-desktop.png`, `sector-mobile.png`.

The accepted build was created in the task's temporary directory; only generated
assets and index were copied to the existing local preview, without deleting
older assets. Preview remains `http://127.0.0.1:47359/market/news?view=events` and
depends on this session. Existing compact filters, four stored events, reader
flags and collection/preparation settings are preserved. No full repository,
packaged desktop, real FMP or assistive-technology run; current preview's calendar
source is still unavailable. Daily ETF returns are neither a full stock-market
heatmap nor proof of news impact. The overall initiative remains open and held.

# 2026-10-26 — Maintainer correction: market widgets belong on Market overview

The maintainer explicitly rejected multi-market switching and sector ETF tiles
on the News homepage. Keep the existing simple News price context, move the new
controls/heatmap entry to the existing Market overview, and leave related-event
asset cards restricted to supplied codes. Make global market controls opt-in at
the shared component's caller rather than the default News layout. Preserve
filters, news/event APIs, reader state, provider selection and the held branch.

This corrects the earlier placement assumption; the original request concerns
news presentation. Remaining News design review should focus on concise list
rows, personal reading/update state, source disagreements/corrections, useful
importance explanations, topic/event following, and evidence-backed event
relationships. Existing heat/search/bookmarks/timelines/conditional transmission
are implemented foundations, not reasons to duplicate those features.

Acceptance in `F:/temp/openalice-news-tv-placement-20261026`:
`red-retry.json` executed the two expected placement failures; the first worker
startup timed out without assertions and is not passing evidence. A separate
read-only browser assertion also failed on the old News layout before editing.
`green.json` / `green-exit.json` pass 5 files / 49 tests, including actual Market
overview composition and the default News control exclusion. Owning UI typecheck
and build exit 0. Generated assets/index update the same isolated preview.

At 1440px and 375px, News has its four original price cards and zero global
market groups, while Market overview has the controls and 11 real-data sector
tiles. A real ETF chart opens on Market overview. No document overflow or page
errors were observed. The follow-up read-only review found no actionable P1/P2.
`final-acceptance.json` checks source/build/archive hashes, HEAD, test exits and
the browser receipts. No broker/state/collection/preparation changes or GitHub
publishing. No full repository, packaged desktop or new live provider acceptance;
the News design gaps above are findings, not implemented or approved features.

# 2026-10-26 — Approved News reading increment

The maintainer accepted compact scanning, reading progress and related reading.
Keep the existing News panel/theme; market groups and heatmaps remain on Market
overview. Collapsed event rows show the title, metadata, a two-line latest-change
preview and common actions; timeline, transmission and detailed provenance move
inside the same expanded row. Do not add a drawer or a new page.

Opening current details successfully records the exact read revision plus known
development IDs in the existing project-owned reader sidecar. Failed/cancelled
detail loads and stale-revision writes must not mark newer work read. Show unread,
read or updated status, and retain the pre-open snapshot while displaying exact
new development IDs since the previous read. Revision-only changes are content
updates, not fabricated new facts. Explicit mark-unread remains available.

Related reading uses the existing story list with an optional validated relatedTo
identity: exclude self, match exact case-insensitive stored topics/codes, sort by
shared code/topic counts then update time, and filter before existing pagination.
No inferred entity identity, causality or market direction. Show up to five
matches and their actual shared topics/codes. Open a selected related event inside
the same News reader, with an explicit return to the original list; query changes
reset that temporary navigation. Related reads are lazy, abortable and locally
retryable. Existing original reports, human flags and collector settings remain.

Scope: reader contract/state/store/routes and tests; News API, event rows, related
event component and tests; NewsPage composition, demo handlers, four locales and
owner guides. Read state stays within the unreleased optional v1 file family;
legacy absent fields read as unread. Existing atomic/exclusive writers own changes.
No provider activation, in-process model loop, trading write or GitHub publishing.
UI/UX Pro Max's two targeted disclosure queries did not return a verified match;
use the existing owner guide's native inline disclosure pattern as fallback.

- [x] Watch the new store/placement/progress/related tests fail and implement.
- [x] Run affected node/UI tests, owning typechecks and backend/UI builds.
- [x] Perform the final independent read-only review, real isolated-home
  desktop/mobile checks and record actual data/remaining coverage limits.

Acceptance: `F:/temp/openalice-news-reading-progress-20261026`.
Final root-config Node selection passes 2 files / 27 cases and UI selection
passes 5 files / 73 cases, both exit 0. Root, registered-test and final UI
typechecks plus backend/final UI builds exit 0. The first UI typecheck exposed
the locale type contract's required plural key; all locales now supply it.
Early UI workers timed out before assertions, including a diagnostic temporary
config; those receipts are failures, not RED or passing evidence. The valid
browser RED exposed visible collapsed timelines; store RED executed two expected
failures. A Response reused by the initial API test was corrected to a fresh
Response per call. Old layout assertions were updated to the new disclosure.

Additional observed RED/GREEN cases cover delayed initially-opened progress,
related-mode inherited Hot rank/list naming, and all explicit codes beyond the
three-chart cap. Fresh reviewer `/root/news_reading_progress_review` found the
hidden fourth-code P2; full code text is restored in details and the four-code
regression passes. Follow-up static review has no actionable P1/P2.

The task-owned credential-free preview was restarted on port 47359 with the
current backend and the same isolated home; optional UTA remains disabled.
Current UI assets/index were copied from the accepted temporary build. The
earlier build is superseded and excluded from acceptance. The preview is a
foreground session (30948; runtime PID in runtime/preview-process.json).

Real browser checks show all four collapsed event rows at 141px each at 1440px,
zero collapsed timelines and no global-market controls. Opening Iran's meeting
event saves its exact read revision; its related Hormuz event names the common
Iran topic, opens inline with heading focus, and returns to the original list
with list focus. Two read markers survive refresh. At 375px the same four events
and read markers remain, without document overflow or dialogs. An initial
coordinate click missed a below-fold related control; scrolling it instantly
into view verified the actual pointer path. Earlier failed waits are excluded.

All four real events have one development, so new-development presentation uses
explicitly fictional browser-only fixtures. The demo shows only the new reopening
development since revision 1, keeps that delta after recording revision 2, and
fits desktop/375px widths. Prefix route precedence initially returned a story
instead of a reader response; longest-path-first mocks fixed it. Final demo
receipts require the read marker and delta together. All four mock routes were
removed and the dedicated demo browser closed; no demo event/original was stored.

`final-acceptance.json` binds current sources, tests/exits, browser receipts,
accepted served UI, original artifact/archive hashes, preserved human flags and
held HEAD. Collection and preparation remain paused. No full repository,
packaged desktop or real assistive-technology run. Related links remain stored
topic/code matches, not verified entity/causal relationships; sustained live
collection, native follow-up operation and paid-source acceptance remain open.

# 2026-10-26 — Remove homepage market/calendar blocks

The maintainer explicitly asked to turn off Economic calendar and Market context
because they take space. Remove both NewsPage imports and mounts; keep Market
overview and event-specific asset cards in their existing locations. The existing
NewsPage case now asserts that neither homepage region is present. No backend,
provider, collection, persisted state or other feature changes. Retain the held
branch and no-publishing boundary. Verification/evidence:
`F:/temp/openalice-news-hide-home-widgets-20261026`.

Accepted locally: 2 owning UI files / 30 cases, UI typecheck and preview build
exit 0. Early worker startups timed out without assertions; a final fresh run
passes after standalone JSDOM warmup. No repository test configuration changed.
The temporary build inherits the project config and skips redundant public-file
copying, reusing existing unchanged public assets for this local preview only.
Accepted generated assets/index are served by the existing port 47359 preview.
At 1440px and 375px, both homepage regions are absent, four real event rows remain,
there is no horizontal overflow, and no economic-calendar request is made after
reload. No page errors. Market overview and opened-event asset cards remain.
No full repository suite or packaged desktop acceptance; no GitHub publishing.

## 2026-10-27 — Approved tickets and unread filtering

The maintainer approved issuing the eight slices and starting implementation.
Ruling: use the previously proposed maintainer-owned GitHub fork for this batch,
with the existing `ready-for-agent` vocabulary; this is not a portfolio-wide
tracker migration. Issues was enabled there. REST core quota was exhausted;
GraphQL retained its own allowance and was used to finish and verify publication.
All eight bodies, criteria and labels were read back; #11 has the native #10 blocker.

| Slice | GitHub issue | Execution |
| --- | --- | --- |
| Unread / updated event filtering | https://github.com/2233admin/OpenAlice/issues/8 | Implemented locally; awaiting held-branch acceptance/integration |
| Follow events/topics and notify | https://github.com/2233admin/OpenAlice/issues/9 | Ready |
| Country relations and evidence | https://github.com/2233admin/OpenAlice/issues/10 | Ready |
| Industry/asset relations | https://github.com/2233admin/OpenAlice/issues/11 | Blocked by #10 |
| Source comparison | https://github.com/2233admin/OpenAlice/issues/12 | Ready |
| Movers reading | https://github.com/2233admin/OpenAlice/issues/13 | Ready |
| Sector Rotation reading | https://github.com/2233admin/OpenAlice/issues/14 | Ready |
| Term Structure reading | https://github.com/2233admin/OpenAlice/issues/15 | Ready |

### First-slice implementation plan

Goal: existing Events/Hot/Bookmarks/Important views can select all, unread or
updated events, using project-owned read snapshots before server pagination.
No persisted-state change, provider activation or scheduler change is needed.

Ruling: unread means no read snapshot; updated means a saved revision below the
current revision, including wording-only edits. Existing labels still distinguish
new developments from content revisions. Latest keeps the URL selection but does
not apply an event-reading filter to raw reports. Clear resets the reading filter.

- [x] Add failing store/route/API tests for state changes, combined filters,
  filtering before offset and invalid enum values; run the owning Node checks.
- [x] Add the shared query enum in the reading contract and consume it in
  `stories.ts`, the HTTP parser, UI API and demo handlers. Keep old readers valid.
- [x] Add the compact reading selector and propagate its URL through the News
  tab adopter/registry and hook query identity; reset page offsets on changes.
- [x] Keep an opened event readable after it becomes read; filter/query changes
  and explicit refresh may apply the new result set without stale navigation.
- [x] Run owning Node/UI/navigation/demo cases, root/UI/test typechecks and build;
  inspect the affected real desktop/375px surface and seek one scoped read-only
  fresh review before reporting completion.
- [x] Record actual evidence and remaining limits on GitHub #8 and here.

BASE remains `1b6684e734a6bfda5ba6edf31b5f82085891646e` on the held branch.
Before snapshots, ticket receipts and verification live outside the worktree at
`F:/temp/openalice-news-unread-20261027`. Issue publication is authorized; the
existing code commit/push/PR/merge/release hold remains unchanged.

### First-slice local acceptance

`final-acceptance.json` is accepted. Node RED observed the two expected filter
assertion failures; UI RED observed six expected failures. Final owning Node
cases pass 28/28; final eight UI/navigation/demo files pass 146/146, with no
skips. Root, UI and registered-test typechecks exit 0. Backend and preview UI
builds exit 0; the latter inherits the repository config and reuses unchanged
public files. The served index and verified source hashes match those artifacts.

One fresh scoped read-only review found a P2: Latest displayed unfiltered
Important headlines but preserved a hidden reading filter on their destination.
The failing regression was observed and fixed: Latest strip actions select All;
event-mode strip actions retain their visible filter. No other P1/P2 findings
were reported. Retained Hot rows also have an observed RED-to-GREEN rank check.

The real isolated preview shows four events, two unread and zero updated.
Opening one unread event marks its exact version read; a genuine automatic poll
updates the count to one while keeping its two-row reading context and open
body. Explicit refresh applies the remaining unread result. Reload and browser
Back restore the selector; Latest Important selection opens the read headline
with All selected. English and Chinese desktop/375px surfaces remain usable,
with no horizontal overflow or page errors. The initial timing-entry probe hit
Chrome's 250-entry Resource Timing buffer; the changed result count and retained
open body supply the actual poll evidence. Unsupported selector attempts were
corrected to native CSS and current element refs; these did not change product code.

All twelve originals and four story artifacts retain their hashes; human flags
and the effective pre-test reading snapshots are unchanged after restoring the
tested preview event. Collection/preparation stay paused. Nonempty updated and
revision-only cases are software fixtures, not invented real-news developments.
No full-repository suite, packaged desktop, sustained collection or paid-provider
acceptance is claimed. The other seven tickets have not been implemented.

Local results and limits are recorded on
https://github.com/2233admin/OpenAlice/issues/8#issuecomment-6429256721 .
The ticket remains open for acceptance/integration; source delivery is still held.

## 2026-10-27 — Continue the approved backlog without checkpoints

The maintainer explicitly instructed direct execution without per-ticket stops.
Continue the remaining seven approved contracts; do not seek another design or
execution-method approval. Preserve the native panel style and held source lane.

Execution order: analytics #13/#14/#15; then event/topic following #9 and source
comparison #12; then evidence-backed country #10 and industry/asset #11. #11 is
the only ticket blocked by another unfinished ticket. All three analytics issues
were read from GitHub (bodies and comments) and claimed; they had no other assignees.

Analytics implementation uses existing reference/rotation responses, React,
Recharts, translations and detail navigation. No provider activation or new
dependency is required. One small finite-number comparator may be shared by the
two sortable tables; missing/non-finite values sort last in either direction.

- [x] #13: observe failing list search/sort/retry cases, implement current-list
  controls and accessible sorting, preserve seven lists and provider order.
- [x] #14: observe failing period/axis/unit/navigation cases; use numeric domains
  symmetric around zero, selected-period relative returns, fixed score/volume
  baselines, compact chart, sortable table and existing ETF details.
- [x] #15: observe failing real-date/missing-basis/parity cases; use a numeric
  expiry axis, price/basis switch, valid perpetual reference and contract details.
- [x] Verify owning UI suites/typecheck, real desktop/narrow views, source/hash
  preservation and one fresh read-only review for the completed delivery batch.
- [x] Record local results on issues and continue the remaining News contracts.

Ruling: period switching changes relative returns, not the existing rotation
score or twenty-day volume-share baseline. Term charts retain missing nodes as
gaps and identify far-end comparisons against the perpetual; no claim that the
whole curve has one regime. Rulings and evidence stay in this canonical plan.
Before snapshots and run receipts: `F:/temp/openalice-analytics-delivery-20261027`.


### Analytics and News follow/comparison progress

Analytics #13/#14/#15 are implemented in the held source lane. Owning UI checks
passed 22/22 before the real-surface follow-up; a missing far-end quote regression
was observed RED then fixed. One fresh review found only that P2. Desktop and
375px checks also found a cramped Movers toolbar and missing scatter labels;
the toolbar now wraps deliberately and scatter animation is disabled so all
11 labels render. Search, mobile RVOL sorting, selected periods, ETF navigation,
real expiry spacing, basis mode and contract details were exercised. Evidence:
`F:/temp/openalice-analytics-delivery-20261027`. No new provider is enabled.

News #9 and #12 now implement event/topic following, durable observed development
IDs, one post-write app notification, exact event opening, and inline source
comparison. Node integration passed 42 cases; the initial UI batch passed 135
with one accessible-label test mismatch, corrected in a subsequent 70-case
reader/Office run. Root/UI typechecks and backend/UI preview builds passed for
that batch. One fresh read-only review reported no P1/P2 findings. The real
browser exercised a clearly labelled temporary acceptance fixture: follow,
notification, exact expanded destination, comparison and original-evidence focus,
plus topic following. All work remains local on the held branch.

An automatic approval review rejected the preview fixture cleanup command with
only "blocked by policy". It was not retried by another mechanism. The labelled
`demo-follow-notification` fixture and its local follow/read receipts remain in
the isolated credential-free preview; these are test data, not a real-news claim.
The original archive and four event artifacts were not edited by that fixture.
Do not describe cleanup as complete. Runtime is now the task-owned following
preview on ports 47359/47360, metadata under
`F:/temp/openalice-news-following-20261027/runtime`.

Country #10 and dependent industry/asset #11 were read/claimed after the country
mechanism passed its first tests. One separate `.associations/v1/<story>.json`
record keeps revision history and server-derived operator/native authority.
Evidence binds exact fields/digests/excerpts; old story revisions need review,
withdrawn/stale entries do not filter, operator corrections default protected,
and native writers cannot bypass protection by changing relation IDs. Countries
share ten explicit identities with macro navigation. Industry IDs use the fixed
11 sector ETF classification; asset identity is source-specific barId plus class
and must resolve to exactly one current bar candidate. No default asset is used.
UI/API/CLI integration and final verification for this batch are in progress.

## 2026-10-27 — Remaining seven tickets locally accepted

The authorized backlog is implemented. #8's prior accepted slice remains intact;
#9–#15 now have remote acceptance comments, verified by rereading their exact
bodies. All tickets remain OPEN for held-branch integration. #11's original
Blocked-by paragraph was replaced by the native dependency edge during ticket
creation; its acceptance scope is unchanged. No commit, push, PR, merge or
release occurred; branch/BASE remain unchanged.

Final evidence: `F:/temp/openalice-news-relations-20261027`.

- Seven Node files /64 cases and nine UI files /94 cases passed. After the last
  changes, the owning Node subset passed 36/36 and UI subset 59/59. The old cold
  worker timeouts and intermediate assertion failures are not passing evidence.
- Root/UI/registered-test typechecks exit 0. Backend and preview UI builds exit
  0. UI build reuses unchanged public resources; no native desktop package or
  full-repository suite is claimed. Scoped whitespace checking exits 0.
- A fresh relationship review found three P2s: truncated asset barId, missing
  Important-strip relationship filters, and stale open details after an
  association-only revision. Each had an observed failing regression and fix.
  Further focused regressions cover Latest's hidden relationship filters and
  raw RSS title evidence, independent of the cleaned display title.
- The schema is a pure shared contract; file IO/hashing stay server-owned.
  The fixed ETF catalog was extracted without changing its existing export.
  No new dependency or model/scheduling loop was introduced.
- Actual native CLI gateway read/publish/list operations stored current revision
  1 relationships against event revision 4 for Canada/US (original 3269) and
  Iran attribution/conditional Energy (original 3306). Exact original bodies
  and digests were inspected. The real samples establish no unique security;
  Apple-as-produce is explicitly unresolved. Explicit asset identity, ambiguity
  rejection and complete source routing are covered by controlled cases.
- Real desktop/375px reading shows country/industry filters, matching Important
  headlines, conditions, unknowns, preparation provenance, source comparison
  and exact original focus. UI selection IR + Apply filters selects the one
  matching event; Clear restores five rows (four real plus the labelled fixture).
  There is no page horizontal overflow or page error. A viewport remount closed
  the article once; the timed-out probe was corrected by reopening before the
  accepted mobile screenshots. No product workaround was added for the probe.
- The JSONL SHA-256 remains
  `8918387C526EB07168588A1F9521A75F0AD0C35D046FA52E6574C92377B4C9C4`.
  All four original event files retain their hashes. Human flags and effective
  original read revisions are preserved; the tested Canada event was marked
  unread again through the normal UI. Relationships remain separate sidecars.
- The final task-owned Runtime serves http://127.0.0.1:47359; process/entry
  metadata lives in this evidence directory's runtime folder. It was restarted
  from the accepted backend bundle after checking PID, entry, port ownership
  and UTA-disabled state. Collection and preparation remain paused.

The explicitly labelled `demo-follow-notification` fixture and its local follow
receipts remain. Automatic approval rejected the cleanup command with only
"blocked by policy"; it was not retried through another mechanism. This does
not modify the four original events or archive and is not a real-news claim.

Acceptance comment URLs are in `issue-comment-urls.txt` and readback evidence in
`issue-receipts.json`. Paid X/FMP, continuous collection/preparation, complete
association coverage, native package acceptance and trading writes are not
claimed. Existing unknown/legacy events remain readable and explicitly
unassessed; software publication checks do not establish semantic truth.
