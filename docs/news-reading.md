# Event reading

News reading keeps three levels separate: immutable archive reports, distinct
facts/developments, and a continuing story. A later report of the same fact
belongs to that development; a new fact belongs to a separate development in
the same story, including across calendar days. Stories need no
company or stock relationship.

## Production boundary

`src/domain/news/reading-contract.ts` owns the version 1 reading artifact.
`NewsStoryStore` stores one current artifact per stable story ID at
`data/news-collector/stories/v1/<id>.json` within the active `OPENALICE_HOME`.
Existing JSONL records and module artifact hashes are unchanged. This is a new
optional file family, not a migration of old reports.

The native CLI or an operator prepares the reading result after inspecting the
archive. Alice validates, stores and renders it; neither an HTTP read nor the
UI invokes a model. The `alice` skill's news reference teaches native-agent
preparation across all subjects, including non-AI events without tickers. Its
reasoning stays in the native CLI; the reader itself does not classify news or
schedule model calls. Recurring runs use explicitly configured existing Issues.

Financial coverage retains collected originals regardless of topic or reading
priority. Grouping combines coverage of one fact, preserves later developments
and leaves unrelated events apart. `reason` may explain supported possible
market transmission, with analysis and uncertainty distinct from sourced facts.
Unknown market links or price direction must not be fabricated.

Native preparation also assesses importance on every publication/revision.
Optional artifact `importance:{level,reason,reportIds}` preserves legacy reads;
automatic native writes require it. Level is `important`, `normal` or
`uncertain`; the nonempty reason is bounded to 1000 characters and its distinct
evidence IDs must belong to this event. This is a native-agent analysis, not a
server-side model call or a guaranteed price-impact score. The existing Issue
prompt also backfills unassessed stored events when incoming work is empty,
within the same 20-original run budget; unchanged assessed events are not
reclassified on every empty cycle. Protected events remain protected.

An optional `transmission` carries a compact conditional analysis for reading:
`{steps,condition,reportIds}` with 2–5 nonempty steps (80 characters each), a
nonempty condition (1000 characters), and distinct evidence IDs belonging to
this event. Explicit null means no defensible path was identified; absence is
an unassessed legacy artifact. Native writes require an assessment and reassess
it on each revision. Empty-cycle backfill also finds missing transmission;
explicit null does not create perpetual work. Steps and conditions are searched
alongside existing event text. They do not establish entity identity, confirmed
market impact, asset direction or an independently versioned relationship graph.

## Compact News widgets

The News homepage omits the global price context and economic-release preview
to leave room for news. Event-specific asset cards remain inside opened details.
Multi-market switching and sector ETF tiles belong to Market overview (`MarketPage`),
where the shared component opts into the TradingView-inspired controls. The selected group is Overview (or
the current watchlist), Forex, Commodities, Crypto or Sector ETFs. Only the
visible group loads data; changing groups closes its inline chart. Daily bars
retain their record date and source. Sector ETF tiles reuse the rotation board's
1D/1W/1M/3M/6M fractional returns, with equal areas and signed values; they do not
represent market capitalization, all stocks or an event's market impact. Missing
or non-finite values stay neutral and unknown. The board's as-of/provider and
stale state remain visible, and source failures have a local retry. Related-event
asset cards do not expose these global groups or load sector data.
New group symbols use the existing provider-neutral currency pairs, commodity
catalog IDs and crypto pairs; commodity labels do not promise a futures/spot
instrument form across providers. Forex prices retain four decimal places.

The standalone economic-release preview component reads from
`/api/reference/economic-calendar`, separate from the corporate earnings/IPO/
dividend board. It shows up to three dated releases, actual/consensus/previous
values (including zero), provider/as-of and stale/unavailable/retry states.
Only an explicit source timezone supports an instant/countdown; date-only or
naive wall-clock text keeps its calendar date with an unknown-time notice.
The widget neither configures nor certifies provider access and is not mounted
on the News homepage.

The event timeline shows the first and latest two stored developments, sorted
by their supplied time; one development stays one node. Omitted developments
remain inside full details. A node opens only its exact evidence IDs through
the existing inline reader and focuses the originals heading. It does not infer
new facts from repost counts or create future milestones.

Inside an opened event, asset cards reuse daily-price summaries and lazy charts.
They accept explicit `EQUITY`, `CRYPTO`, `CURRENCY`, `COMMODITY` codes and supported
US exchange prefixes (`NASDAQ`, `NYSE`, `AMEX`); symbols are passed unchanged to
the existing bar service. Duplicate aliases share a card, with at most three
loaded assets. Missing/unsupported codes stay explicit; no default stock is
substituted and no ticker is inferred from topics, countries or analysis text.
Prices are market context, not proof of the event's impact or entity identity.

## Reading progress and related reading

Event following is an independent reader flag (`following`); topic following
uses complete case-folded stored topic identities through
`GET/PUT /api/news/following/topics`. It shares the AliceProject reader sidecar,
without changing bookmarks, importance, protection or originals. Following
seeds existing development IDs silently. Durable publication records the union
of observed IDs, then emits one `news.story.updated` fact when new developments
match an event or any followed topic. Reposts attached to an existing fact and
wording-only revisions are silent. Overlapping matches coalesce; restarts or
fact removal/readdition do not replay observed IDs. Native preparation owns
same-fact identity; these checks do not independently establish semantic truth.

News notifications reuse the existing application queue and desktop News
preference. Their checked event ID opens the existing News tab via `eventId`,
filters before pagination and expands that event. A direct notification target
ignores older search/read filters and offers a return to the normal list.
Notification failure does not roll back publication. This is an at-most-once
post-write announcement, without an outbox or offline delivery guarantee;
initial/reconnected history remains silent under the existing activity policy.

Read progress belongs to the active AliceProject, shared by its readers rather
than a separate account identity. Legacy missing/null progress means unread.
A successful opened detail records `readProgress:{revision,developmentIds}`
through the existing reader PATCH's `readRevision`; rendering a list or a failed,
cancelled or mismatched detail does not mark it read. The store checks the exact
current revision inside its publication/write queue and returns 409 on a stale
read write. Explicit null clears progress. Existing flags and original artifacts
are preserved. This extends the optional unreleased v1 sidecar family.

The row distinguishes unread, read, new development IDs and revision-only content
changes. Expanded reading retains the snapshot from before this open, so saving
the new read marker does not erase its “since last read” list or evidence links.
Opening after a delayed initial list load also captures the stored snapshot.
This is a revision/development record, not proof that every paragraph was read.

`GET /api/news/stories?relatedTo=<event-id>` filters before existing pagination,
excludes self, and matches only exact case-insensitive stored topics/full codes.
It ranks shared-code count, shared-topic count, updated time and identity. The
reader loads up to five matching previews only after opening details, shows the
actual common labels, and supports local retry/cancellation. A temporary inline
related-reading view can open a match outside the original filters; its explicit
Back to list preserves those filters, and changing filters resets the view.
It carries no Hot rank from the original list. Related labels are metadata
matches, not verified entity identity, independent confirmation or causal impact.

## Native CLI surface

`alice events pending` reads unprepared material from the complete JSONL archive,
in ingestion order rather than the recent memory index. Its optional status is
`pending`, `review` or `failed`; results include counts and bounded paging.
`alice events review` records an uncertain relation or transient failure with
original IDs and a sanitized reason. Review holds require an explicit human
retry. Failed reports retry after 5 and 10 minutes, then require a human retry
after the third failure. Publishing acknowledges its report IDs, so an
interruption after publication does not replay already represented originals.
Committed evidence also stays acknowledged if a failed receipt remains recorded;
explicit review holds and human retry feedback still appear in their queues.
Human retry may include a review note. It re-enters pending work with that
feedback for the native agent; the feedback does not establish source facts.

`alice events list` lists all prepared events by default, including those with
`selected:false`; optional keyword/topics/source filters and `offset` narrow
the view. Follow `nextOffset` to inspect older candidates. `alice events read
--id <id>` returns the full current event and its original evidence.

Settings can create or pause a normal `news-event-preparation` Workspace Issue.
Its visible What is the only scheduled prompt. The existing scanner dispatches
one fresh native Session batch (up to 20 original IDs, default every 15 minutes
with a 15-minute timeout; the actual visible Issue owns cadence and watchdog)
and owns execution/failure history. Native Agent/model/credential choices inherit
the Workspace's headless preferences. This is opt-in; even an empty scheduled
batch starts a native turn and may incur model charges. Pausing cancels future
fires; stopping an already active execution is a separate existing Issue action.
This path adds no in-process model loop or second scheduler.
The managed prompt uses `events pending --order recent` for a bounded
newest-publication queue head. The default oldest-ingestion queue remains
available; recent mode has no offset pagination and retains complete counts and
older work. Late older reports do not jump ahead merely because they arrived
later. New material, prior event evidence and missing-field repair share the
twenty-original run budget.

Every managed publication assesses source comparisons, with explicit
`comparisons:[]` when no supported note exists, and then publishes a separate
current association snapshot. Unknown identities remain unresolved. Empty
assessed snapshots are valid; a failed relationship write leaves its event
published and its stale/missing snapshot discoverable for repair. Missing
importance, transmission, comparison or relationship assessments are eligible
for bounded backfill even while new reports remain. Protected human work and
review holds are not released automatically. Shared-original historical
candidates, including ownership conflicts involving labelled test fixtures,
require explicit resolution; preparation leaves them unchanged and continues
other eligible work. A headline/body conflict or missing body is an evidence
gap, not permission to invent content or claim to have fetched the full page.
The Issue uses `@new-each-run`: the durable archive/event state carries batch
continuity, including when a previous Session failed before native startup.
Enabling a stored preparation Issue upgrades only exact known older managed
What to the current assessment instructions. Custom What text is preserved and
returns an actionable review error instead of starting an incompatible run;
the operator can amend and enable it in Issues. The mutation checks the What
read by the route again before updating, rejecting a changed value. Pausing
remains available without replacing custom instructions.

The collapsed event row shows its headline, metadata, a two-line latest-change
preview, reading status and common evidence/flag/bookmark actions. Timeline,
conditional transmission and detailed provenance open inside that same row.
The path's evidence action filters to exact originals and focuses their heading.
The full overview, source labels and raw coverage score remain inside details.
`reading.publishers` counts recognized publisher/hostname identities across all
available event evidence, separately from `participants` in the 48-hour heat
window. Unknown identities do not add a count. Hostname aliases are not an
independent-confirmation guarantee. Official provenance means a report declares
the `official` role; neither its presence nor its absence proves a claim.

`stories/v1/.reading-state.json` is an optional version-1 sidecar containing
bookmarks, protected-event flags, read progress, unresolved report states and hourly heat
observations. It is project-owned and atomically replaced. Invalid state fails
closed; it is not silently reset. A native publication cannot replace a
protected event, discard its old evidence/development assignments, reuse an
original assigned elsewhere or bypass a held original. Human publication via
the existing PUT route can correct artifacts; protect the result in the reader
to hold further automatic edits. Structural checks still do not prove truth.

`alice events publish --artifact-file ./event.json` accepts the complete JSON
artifact as file-backed text, bounds UTF-8 input to 1 MiB and reuses the same
validation/revision rules as HTTP. The MCP tools are `listNewsStories`,
`readNewsStory` and `publishNewsStory`. Runtime bootstrap shares one
`NewsStoryStore` between these tools and HTTP, so concurrent writers cannot
independently accept the same next revision. Cross-process file writers remain
unsupported. Use the existing `alice rss` tools to inspect collected originals;
their search window remains bounded by the recent index.

## Read and publication contract

Country, industry and asset relationships use a separate optional file family
at `stories/v1/.associations/v1/<story-id>.json`. It retains every full snapshot
revision and server-derived operator/native authority; original event and JSONL
bytes are unchanged. Each snapshot binds the exact story revision, preparation
identity/time, active/withdrawn relations and unresolved labels. Operator writes
default protected; only an explicit operator snapshot can release protection.
Native writes honor that protection, event locks and original report review holds.
The shared event write queue and atomic rename serialize publication; stale story
or relationship revisions fail, including concurrent attempts at the same next
revision. Cross-process file writers remain unsupported.

Evidence identifies an event-owned report, content/title field, UTF-8 SHA-256
digest and exact nonempty excerpt. Title-only evidence is permitted only without
a body. Unknown or ambiguous identities remain unresolved. Ten canonical country
codes share macro navigation; industry IDs use the fixed 11 sector ETF catalog.
Assets require a complete barId and class resolving to exactly one existing bar
candidate. `mentioned`/`directly-involved` describe supported relevance; separately
labelled `conditional-transmission` needs an explicit condition and does not
establish causality or price direction. Structural validation does not certify
the preparer's semantic judgment.

`GET/PUT /api/news/stories/:id/associations` and native `events associations` /
`events publish-associations` share these rules. Reads expose history and original
digest/text preparation inputs, without model calls. Detail/preview views mark
absent relationships unassessed, and old story revisions need review. Current
active targets alone enter country/industry/asset filtering before pagination,
combined with topic/search/bookmarks. Corrupt relationship state fails visibly;
raw archive reading remains independent. Macro country actions open structured
News country filters, with keyword fallback only for uncatalogued countries.
The inline reader shows relation nature, conditions, preparer and exact excerpts;
evidence actions reuse originals/focus and resolved assets reuse existing details.

Optional `comparisons` stores up to 32 prepared notes: `kind` is
`official-response`, `difference` or `correction`, with a bounded summary and
distinct event-owned `reportIds`. Differences/corrections need at least two
reports; publication of an official response also requires an explicitly
official-role original. These checks establish structure, not truth. HTTP,
native publication and detail reads share this artifact contract. Legacy
absence remains unassessed and does not rewrite originals or reader flags.

The inline source comparison orders valid original publication instants, with
stable ID ordering for ties. All tied earliest publications are labelled
"earliest among collected reports". Collection-only or invalid times follow
without a publication rank. Each row and prepared note opens its exact evidence
in the existing originals reader, clears the official-only filter and focuses
the originals heading. Missing bodies remain explicitly missing there.

- `GET /api/news` retains the raw items/query contract and adds each item's durable
  `id`. Prepared reports also carry `eventRef:{storyId,developmentId}`; conflicting
  assignments return `eventRef:null`, and unprepared reports omit it. A failure
  to load identities sets `storyError:true` while retaining all original items.
  `includeStories=true` includes a page of up to 50 prepared story previews,
  without original bodies, quotes or media. Story context is independent of the
  raw query's time window and 200-report cap. The server filters stories by
  topic, literal publisher, text, explicit symbol and latest development date
  before pagination. Keyword search includes original bodies outside the raw
  window. The built-in provider matches archive evidence in one scan without
  retaining all bodies in a response.
  Lookback applies only to Latest; event reading retains older developments.
- `GET /api/news/stories` returns `{stories,sources,nextOffset}` previews;
  `GET /api/news/stories/:id` resolves one complete story and its original reports.
  Original bodies are fetched only when opening a story. The built-in provider
  resolves all requested evidence in one archive scan.
- Query `readingView=selected` selects curated stories, `storyTopics` is a
  comma-separated topic set, and `storyOffset` addresses the next 50-item page.
  Raw-news responses expose `storyNextOffset` and `storySources`; the latter
  includes older publishers so they remain selectable before opening a page.
  `/stories` can enumerate all existing story IDs for preparing revisions.
- `PUT /api/news/stories/:id` publishes a complete version 1 artifact through
  the backend's existing access control. It does not initiate collection,
  trading, paid requests or model calls. Request body is capped at 1 MiB.
- Create with revision 1; an update must be exactly the current revision + 1.
  A stale publication returns 409. Read the latest revision and reconcile
  changes before retrying. Invalid artifacts/evidence return 400; no original
  or published story is replaced on validation failure. Success returns
  `{id,revision}`, rather than echoing original bodies after a write.

Artifact fields: `version,id,revision,title,summary,reason,topics,symbols,
selected,status,updatedAt,preparedBy,overviewReportIds,developments`.
Each development has `id,time,title,summary,reportIds`. Stable IDs are lowercase
ASCII slugs. Times are ISO timestamps with a timezone; `updatedAt` cannot
precede a development. Status is `active`, `watching` or `settled`.

Publication resolves every `reportId` through the archive's durable-ID lookup,
including reports outside the recent index. Each story may reference at most
100 reports. Each report may belong to only
one development within a story. Overview evidence must be a nonempty subset
of these reports. Invalid/duplicate references and unknown fields are rejected.
This checks structural evidence links, not whether a summary is factually true.

## Preparing results

1. Read the originals with existing archive search/read tools. Record actual
   archive IDs, publication times, publishers and uncertainty. Feed content can
   be an excerpt; do not imply the full publisher page was retrieved.
2. Read existing stories before assigning an ID. Keep one fact's independent
   reports together; add a separate development for a genuinely new fact.
3. Write an answer-first factual summary and a separate reason to follow.
   State uncertain business implications as uncertain. A stock symbol is
   optional and must use an explicitly established market-qualified identity.
4. Choose `selected` deliberately. Set `preparedBy` to the actual operator or
   native-agent process, not the original publisher. Publish using the API;
   do not edit the active store concurrently or invent report IDs.

The current snapshot is atomically replaced after complete validation. Publication,
review changes and reader protection share the store's write queue, so a review
arriving during publication is retained. Cross-process file editors are not
supported writers; revisions are not a historical edit log. Original JSONL
evidence remains untouched. Missing originals on later reads are explicitly
reported; a damaged story file makes reading unavailable rather than silently
discarding it. Raw material remains readable if story loading fails.

## Reader

Events, Hot, Bookmarks and Important offer All, Unread and With updates through
the `readStatus` query. Unread means no project read snapshot; updated means its
revision is below the current event revision, including wording-only changes.
The server applies this with the other filters before pagination. The existing
row labels still distinguish new developments from content revisions.
The selector survives News URLs, tabs, reload and history. Latest preserves its
selection without filtering raw reports; its unfiltered Important strip opens
headlines with All selected. Clear resets reading status. A filtered event kept
open remains readable if polling removes it from results; closing or an explicit
refresh applies the current result set. Such a retained row has no new Hot rank.

News opens the existing Latest stream; search and category filters operate
within that page. Category tags reach the server before the result limit so
high-volume sources cannot hide an available category. Events shows continuing
stories and their latest facts. Hot orders the same events by source coverage
attention; Bookmarks reads saved event identities from the project sidecar.
The reader shows compact heat/trend metadata; calculation rules stay in this
guide rather than a persistent banner or repeated tooltip in the News panel.
News accepts an optional `keyword` in its tab/URL parameters alongside category
and view. Global Macro's Search news action uses this existing text search with
the selected country's localized name. View/category changes preserve the
applied keyword; Search and Clear update it, and reload/Back restore the URL
selection in the same singleton News tab. Results depend on source language and
text matching; a search hit does not establish geographic or financial relevance.
The independent Selected UI switch is withdrawn. The artifact's
selection fields remain content preparation data. Latest retains raw material,
including unprocessed reports. Latest folds reports sharing a prepared event
and development identity even when their titles differ; separate developments
and conflicting assignments stay apart. Unprepared reports retain conservative
local 24-hour headline folding, which does not produce story identity. Explicit
refresh loads newly prepared identities without waiting for new report IDs.

### Discovery and review

Event rows show deduplicated declared source names and topics that apply the
existing topic filter from page one. Hot adds the event's rank in that filtered
source-coverage ordering, including the page offset. Neither source names nor
rank establish independent ownership or financial importance.

The Jin10-inspired Important events strip sits below market context and shows
up to three prepared events. Its order matches the complete Important view:
recent revisions by default, relevance under keyword search. Headline actions
open that event inline and focus its heading; View all retains active filters.
Empty/error states never substitute hot or `selected` events.
The feed hides a previous query's results before starting a different query;
the initial inline-open request is consumed only by the destination list.
Later source/topic/date filtering cannot reuse it or move focus back to an old
event. Explicit importance is checked by the strip and Important list even when
an upstream response omits the flag.

Importance derives from a native assessment marked `important`, original
category tokens `important`, `breaking`, `urgent` or `top`, or an explicit reader
override. The optional sidecar
`events[id].important` boolean overrides source classification in either
direction and survives restart independently of bookmarks and protection.
Automatic assessment updates never overwrite that override. Normal/uncertain
assessments do not suppress an explicit source designation. The expanded event
shows the assessment as analysis and opens exactly its cited originals.
This additive field belongs to the same unreleased reader-state increment;
existing state lacking the field reads without a startup rewrite. Source
reports/artifacts remain unchanged. API `important=true` filters events before
pagination and source-marked raw reports before their result cap. The Important
view retains those raw reports below prepared events, including originals not
yet prepared. Clearing event importance does not change source attribution on
a raw report. These designations are not financial-impact scores.

The native market-context strip uses up to four current watchlist assets,
falling back to S&P 500, Shanghai Composite, gold futures and BTC/USD. Existing
configured vendor bars supply two daily records per asset; the strip shows the
latest record date and provider, with change from the preceding available bar's
close field. A daily record can still be in progress; it is not a verified
end-of-session price.
Missing/zero baselines leave change unknown. Selecting an asset lazily opens an
inline 1M/3M/1Y daily-price chart through the same bars boundary. Failures and
retries stay local to that asset. This background does not filter the news or
claim a story/asset relationship, realtime quote or causal price response.
No external widgets, new subscriptions or provider activation are involved.

Story previews add optional `reading` metadata: bookmark/protection flags,
coverage heat, participant count, trend, new-event and new-development markers.
These are read-only projections, not artifact fields. `storyOrder` accepts
`recent`, `heat` or `relevance`; `bookmarked=true` filters before pagination.
Keyword search ranks title/topic/summary matches ahead of body-only matches;
all referenced originals remain searchable beyond the current report window.
Story responses expose topic counts across stored events for topic navigation.

Heat counts distinct declared publishers, falling back to original hostnames;
discussion material with an author uses that individual identity. Repeated
reports from the same identity contribute at most once. Publication times must
be within 48 hours, and weights have a 24-hour half-life. Undated collection-only
items, future times and unidentified sources do not add heat. Hostnames are a
fallback, not verified corporate ownership; alias sites may need owner metadata.
This measures subscribed-source attention, not all-internet popularity or price
impact. Financial implications stay in the event's separate analysis.

Event reads keep hourly observations for seven days. A trend needs a 6–7 hour
baseline with the same known, recently healthy collector source cohort; missing
history or changed/unknown coverage yields `unknown`. A change exceeds 10% plus
0.05 heat units to be rising/falling, otherwise it is steady. New-event markers
require first preparation and the earliest development within 24 hours. New
development markers require a new development identity observed within 24 hours
and a recent development time; adding another account of an old fact does not
refresh this marker. Markers and heat are not estimates of market direction.

`GET /api/news/processing` exposes pending/review/failed queues with bounded
paging and counts. `GET /processing/:id` reads an archived original. Explicit
`POST /processing/:id/retry` releases a hold, optionally with a bounded review
note. `PATCH /stories/:id/reader` changes only bookmark/protection/importance booleans.
These routes retain the normal backend access control. News settings reads
originals and reasons before retrying; the reader can protect an event against
further automatic publication. Bookmark removal and queue retry keep keyboard
focus on a surviving list/navigation element.

Automatic checks keep the current Latest list in place and offer the count of
new report IDs. Accepting the update inserts the fetched snapshot; explicit
refresh still reloads immediately. Changing a query clears pending updates and
event previews. A failed refresh of the same event query retains its last
successful previews and page cursor rather than showing a different query's
events. This count is bounded to the returned report window, not global unread
state or an archive-coverage measure.

RSS headlines can contain publisher formatting even after XML decoding. The
parser and RSS read projection remove common formatting tags while preserving
unknown angle-bracket text and financial comparisons. Reading older reports
does not rewrite the archive or change durable evidence IDs.

New RSS records carry `metadata.timeBasis` (`publication` or `collection`).
Missing publication dates retain an explicitly labeled collection timestamp;
Unzoned dates also retain collection-time provenance instead of inheriting the
server timezone. New RSS records preserve the source date as
`metadata.publicationTimeRaw`. The parser prefers nonempty content over a feed
summary and skips empty formatting. New records carry `contentBasis`
(`feed-content`, `feed-summary`, or `missing`); API and reading surfaces show
declared feed provenance without claiming publisher-page completeness.
`newsReport` exposes `timeBasis: 'collection'`, and the reader labels that time
and excludes the report from date-based local folding. Historical records are
not rewritten or assigned guessed provenance. Preparation must not infer a
development's occurrence time from an undated report's collection time.

Prepared events expand inside their own News-panel row. The existing summary
stays in place; expanded content adds the reason to follow, protection,
developments and original reports. Native disclosures expose developments and
originals without a side drawer or focus trap. Collapsing retains the row and
its disclosure control. An open event refreshes when its preview revision changes.
Publisher, original time, source
role, author and quoted text survive the same shared report projection used
by the raw stream. Official source is attribution, not a truth guarantee.
The event list repeats the latest-development preview only for continuing
events with more than one development; opening the event retains every fact.
Citation actions open originals in the same row, show the referenced reports
regardless of an earlier official-only filter and move focus to their heading.
Missing stored bodies are explicitly labeled instead of rendering an empty
paragraph. Raw grouped coverage likewise expands its originals within the News
feed; every source remains individually readable in the existing time order.

Demo contains three explicitly fictional, manually prepared stories (AI,
company and macro). The AI story has no ticker and includes a development
50 hours earlier. These fixtures demonstrate reading behavior; they do not
establish automatic inference, real coverage or paid-provider acceptance.
