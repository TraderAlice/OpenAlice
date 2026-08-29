# Plan: Connector Improvements

**Status:** active — feature-branch iteration hold on `feature/connector-improvements`; do not open or merge a PR until Ame says the branch is ready.
**Owner guides:** [[docs/connector-service.md]], [[docs/alice-project.md]], [[docs/development-workflow.md]]
**Delivery:** Keep verified increments on the owned feature branch. Serial and parallel execution may both be used, but one integrator owns the branch and `dev` remains untouched until explicit acceptance.

## Goal

Improve Connector reliability and operator experience from evidence gathered on
the real Default AliceProject. Preserve the Connector Service boundary: Inbox
and Workspace state remain Alice-owned, broker state remains UTA-owned, and
external adapters remain optional projections rather than sources of truth.

## Working Baseline

- AliceProject: `default` (`/Users/ame/.openalice`), selected explicitly through
  the Supervisor rather than using Demo or `office-lab`.
- Source: this feature branch, started against the Default AliceProject home.
- External-account actions: do not send test messages, commands, or probes
  without Ame's explicit permission. Local settings, health, journal, and
  recorded-replay inspection remain in scope.
- Secrets: never print or capture bot tokens, connector credentials, raw owner
  identifiers, or sealing material.

## Discovery Questions

1. Does the real Settings surface explain service state, adapter state, linking,
   capabilities, failures, and recovery clearly?
2. Do outbound Inbox delivery and phone-desk replies preserve content,
   provenance, formatting, and lifecycle across adapters?
3. Are health and logs actionable without exposing secrets or requiring source
   inspection?
4. Which gaps are shared Connector-core problems versus adapter-specific
   limitations that should remain explicit?
5. Which first increment provides a coherent user-visible improvement with a
   bounded acceptance surface?

## Decisions

1. **Real surface first.** Establish the Default AliceProject baseline before
   choosing an implementation increment.
2. **Feature-branch hold.** Do not open an early Draft PR. Push atomic verified
   commits to this branch and keep this plan current until maintainer acceptance.
3. **No speculative parity.** Discord, Slack, Telegram, and Feishu may expose
   different capabilities; improve shared ownership without pretending an
   unimplemented external path works.
4. **Design before UI edits.** For any Settings interaction change, record
   viable approaches, tradeoffs, the chosen interaction model, responsive
   behavior, accessibility, and shared primitive ownership before editing UI.
5. **Recorded evidence before live messages.** Use unit tests, journal replay,
   and isolated process smoke first. Live external DM confirmation remains an
   explicitly authorized acceptance lane.
6. **Connector lifecycle is explicit.** Each adapter exposes one accessible
   runtime switch. Starting it may turn on the global Connector Service, while
   stopping it preserves credentials, owner binding, Inbox preference, and
   chat configuration.
7. **Chat is a capability, not a desk users must understand.** Desk-capable
   adapters present `Chat on <connector>` with an independent switch and a
   Workspace choice before first enable. The durable Issue remains the internal
   execution specimen; heartbeat cadence and prompt are advanced chat settings.
8. **Configuration stays in context.** The Connector overview opens a shared
   configuration dialog for one adapter instead of routing into the full
   Settings category. A route-backed detail page would deep-link well but turns
   a local edit into navigation; a side drawer preserves context but is too
   narrow for credentials and chat setup. The chosen centered dialog reuses the
   same adapter settings content as Settings, omits the Settings sidebar, and
   becomes near-full-screen on narrow viewports. The shared dialog primitive
   owns focus trap, Escape/backdrop dismissal, labelled header, scroll containment,
   and focus restoration; adapter content continues to own fields and actions.
9. **The overview is a connection center, not a status table.** A large global
   service card, a dense four-row definition list, and raw owner identifiers
   all compete with the action a user actually needs. Three approaches were
   considered: retain the table and restyle it (low risk, same cognitive load),
   turn the page into a setup wizard (clear for first use, poor for daily
   operations), or use state-led cards with progressive diagnostics. The chosen
   model keeps a compact service summary and gives each adapter one plain-language
   state, one next action, linked/last-delivery context, and technical details
   only when something is wrong. Setup stays prominent only until credentials
   exist. Cards remain two columns when space permits and become a single
   vertical task flow without horizontal scrolling on narrow screens. Status is
   conveyed by text and icon as well as color; card actions remain real buttons
   with visible focus treatment.
10. **Configuration follows dependency order.** A tabbed Connection / Delivery /
    Chat dialog was considered, but it hides prerequisites and makes a short
    form feel like several destinations. A strict setup wizard was also rejected
    because it becomes friction after first use. The chosen vertical task flow
    keeps a lifecycle summary visible, then orders shared sections as Connection,
    Inbox delivery, and capability-gated Chat. Required credentials open
    automatically and appear before unrelated delivery preferences; an unavailable
    runtime switch is omitted instead of displayed disabled. Chat setup stays as
    a compact preview until the private chat is linked, then reveals Workspace
    selection and its switch. Saved connection details and heartbeat/prompt
    controls remain progressively disclosed. Runtime and linked copy never expose
    raw external owner identifiers.
11. **The global service control is a pause-all affordance, not a setup step.**
    Keeping the raw checkbox would preserve the implementation model but continue
    to imply that every configured Connector needs a second manual enable. Removing
    the control entirely would simplify first use but lose a useful recovery and
    quiet-hours escape hatch. The chosen Settings card keeps the service control
    secondary, labels it as allowing or pausing all delivery, and explicitly says
    that an individual Connector switch starts it automatically. It uses the shared
    Toggle primitive, keeps health visible beside the control, and removes Guardian,
    kill-switch, and external-owner terminology from user-facing setup copy. The
    row wraps into a vertical layout on narrow screens; its switch has a localized
    accessible name and state is not conveyed by color alone.
12. **Credential setup starts with an in-context platform checklist.** A bare
    help link would still make the user reconstruct the sequence after leaving
    OpenAlice, while a full wizard would duplicate volatile third-party consoles
    and become a maintenance trap. The chosen connection editor shows a compact,
    localized preparation checklist only while required credentials are missing,
    followed by official platform links that open in a new tab without dismissing
    the dialog or losing drafts. Connector definitions own an optional list of
    official setup links, so downstream adapters still render generically without
    UI branching; built-in translations add concise platform-specific steps.
    Links have explicit accessible names and an external-link cue, and the card
    remains a single vertical reading order at narrow widths.
13. **Overview and configuration share one lifecycle truth.** Deriving overview
    state from runtime owner presence alone makes an intentionally stopped or
    reconnecting Connector look unlinked even when its learned account fields are
    durably saved; treating every credentialed-but-off adapter as merely paused
    also hides the required `/link` step. Patching those labels independently was
    rejected because the two surfaces would drift again. The chosen model feeds
    the shared seven-stage setup state into each overview card: credentials needed,
    ready to link, starting, awaiting link, linked, linked offline, or error.
    Durable learned fields remain authoritative while runtime health adds live
    progress; an enabled adapter with no runtime during a degraded service is an
    error rather than an endless starting state. Card copy and its primary action
    are stage-specific, and Reconnect appears only for an actual error. On narrow
    screens actions continue to wrap in document order; linked state is stated in
    text and never inferred from color or a runtime-only identifier.
14. **First-time credentials save as one connection; maintenance stays
    credential-specific.** Keeping one Save button beside every missing token is
    technically precise but makes Slack look like two unrelated setup operations
    and gives no clear completion point. Staging every connection and delivery
    preference behind one Apply action would create a coherent transaction, but
    it would also make routine preference edits needlessly heavy and complicate
    confirmed token replacement. The chosen hybrid saves all currently entered,
    missing credentials through one `Save connection` action after required
    connection fields are complete. Already sealed credentials retain individual
    Replace and Remove actions with confirmation because each is a distinct
    destructive maintenance operation. Validation stays beside the affected field;
    a transport failure for the grouped save appears once beside the group action.
    The action is right-aligned on wider dialogs and expands to the available width
    on narrow screens. Native fields keep their labels, password reveal controls,
    and keyboard order; the shared credentials editor owns grouping and feedback.
15. **Routine controls stay visible; account separation lives with connection
    maintenance.** Keeping Unlink beside Send test makes a destructive identity
    change look like an ordinary runtime action, while hiding it in a generic
    overflow menu would reduce comprehension and disconnect it from token
    maintenance. The chosen model keeps only adapter availability and a healthy
    test send in the lifecycle panel. Unlink moves into the disclosed Connection
    details beside credential replacement/removal, with explicit copy that the
    sealed credentials remain available for a different private chat. The runtime
    control also uses `Use <platform>` language instead of the implementation term
    `Run connector`; its localized switch name describes turning that platform on
    or off. The maintenance row stacks naturally at narrow widths, and confirmation
    remains the final guard before the learned account identity is cleared.
16. **Loading and recovery preserve the user's last trustworthy context.** A
    spinner in a blank page followed by a raw error strip gives no sense of the
    surface being loaded, while replacing a previously useful snapshot with a
    full error state turns a transient poll failure into apparent data loss.
    Silently keeping stale state would avoid disruption but conceal that status
    may be outdated. The chosen hierarchy uses layout-matched skeletons only for
    the first load, a focused recovery surface with Retry when no snapshot or
    configuration can be rendered, and a compact warning notice when last-known
    data remains usable. Overview retries reload the live snapshot; an in-dialog
    stale-health retry refreshes runtime only so it cannot overwrite credential
    drafts. Error meaning is conveyed by text and icon, retry remains a native
    button, and narrow layouts keep the notice/action in document order.
17. **Autosave feedback is a shared, perceivable status—not Connector-specific
    chrome.** A Connector-only toast would make ordinary setting changes visible
    but duplicate the shared settings save lifecycle; leaving the current tiny
    English color dot preserves ambiguity and fails localization/accessibility.
    The chosen model upgrades the shared SaveIndicator used by Settings: localized
    Saving, Saved, Save failed, and Retry labels; a distinct progress/check/error
    icon in addition to color; and one polite atomic live region so status changes
    are announced without stealing focus. Retry remains a real `type=button`
    control. Narrow-browser acceptance rejected the previous zero-height sticky
    overlay because it covered scrolled setup copy. Connector dialogs therefore
    lift the same primitive into the shared dialog's fixed header accessory;
    full Settings pages keep it in PageHeader. Explicit credential saves remain
    field/group actions and never masquerade as autosave.
18. **Connector chat uses conversation language first and scheduling mechanics
    second.** Keeping `Agent chat`, `phone desk`, and `Heartbeat` in the primary
    UI exposes three implementation models for one simple promise; hiding all
    scheduling would make an autonomous chat's behavior impossible to inspect.
    The chosen model describes the product as Workspace conversations and keeps
    each adapter's concrete `Chat on <platform>` name. The optional disclosure is
    renamed Scheduled check-ins, with a check-in schedule and prompt inside.
    Underlying Issue, comment, cadence, `[[no-reply]]`, and connector-desk IDs do
    not change. Existing Issue titles/prompts remain user-owned content and are
    not silently rewritten; new/demo content and UI-authored defaults use the
    conversation wording. The shared Markdown editor accepts contextual
    accessible labels/placeholders so this surface does not announce a generic
    Issue description.
19. **The overview separates owned work from untouched availability.** Keeping
    definition order is predictable but places a never-started adapter between
    the user's linked channels; sorting every card by transient runtime state
    would move targets around during reconnects. A filter control is useful for
    a large marketplace but adds work to the current four-adapter surface. The
    chosen model keeps stable definition order inside two semantic groups:
    `Your channels` contains linked, credentialed, enabled, or partially entered
    platform setup, while `Available channels` contains only pristine adapters.
    This follows the per-platform configuration/status model documented by the
    Hermes Channels surface while fitting OpenAlice's deeper setup lifecycle.
    Empty groups are omitted, so a new user sees one available catalog and an
    established user reaches owned channels first. Both groups reuse the same
    card component and responsive one/two-column grid; headings establish screen
    reader structure without changing any action, credential, or runtime state.
20. **Configuration height follows the task on desktop.** A fixed near-full-
    height shell keeps long forms predictable but leaves short, established
    Connector configurations looking unfinished. A small fixed dialog would
    remove that empty space but force first-time credential guides into a cramped
    viewport. The chosen responsive shell keeps the existing near-full-height
    mobile treatment, where vertical space and virtual keyboards are volatile,
    while desktop dialogs size to their content up to the existing 46 rem or
    viewport maximum. Longer forms continue to scroll inside the dialog, so the
    fixed header, focus trap, Escape/backdrop dismissal, draft preservation, and
    document position do not change. The shared ConfigurationDialog owns the
    sizing rule rather than each Connector form branching on its content.
21. **Channel cards spend space on state, not a repeated capability tagline.**
    Allowing the generic “Send Inbox notifications…” subtitle to wrap would
    remove its visible truncation but make every card taller without adding
    distinguishing information. Replacing it with capability chips would help a
    marketplace comparison, but the current four adapters share delivery and
    capability-specific setup already appears inside configuration. The chosen
    card header contains only the platform identity and lifecycle badge. Its
    plain-language state remains the primary body, followed by durable evidence,
    diagnostics when present, and the next action. Removing the desktop 250 px
    minimum lets single-card rows fit their actual content; CSS Grid still keeps
    cards equal within a row, so action alignment and scan order remain stable.
    No accessible name, focus behavior, state copy, or action semantics change.
22. **The full Settings document gains navigation without becoming tabs.** The
    current all-adapter page preserves every form and unsaved draft, but its real
    content is 2,701 px tall and offers no direct way to reach Slack or Feishu.
    Platform tabs would shorten the page but hide state and drafts behind a view
    switch; top-level accordions would add an expansion step to every edit. The
    chosen in-page navigator keeps one complete document and shows all four
    platforms with their localized lifecycle badges. It is sticky only at
    desktop widths, where it remains a useful switcher. The grid uses one column
    on narrow screens, two once both platform and lifecycle labels fit, and four
    only on genuinely wide viewports; the narrow navigator is static so it does
    not keep consuming the mobile viewport. Buttons move focus to labelled
    region targets and invoke native scrolling with a responsive margin that
    keeps the target heading below the sticky navigator, without changing the
    route or URL history. Badge text accompanies color, normal keyboard order is
    preserved, and the adapter-only dialog omits this redundant navigation.
23. **The configuration shell owns a localized, touchable close control.**
    Leaving the shared primitive's English `Close` fallback in a translated
    Connector dialog makes the visible UI and accessible name disagree; changing
    the primitive to import app i18n would invert ownership for every consumer.
    The chosen API lets a product shell provide its close label and sizing while
    the primitive retains its English default. ConfigurationDialog supplies
    `common.close`, a 40 px mobile hit target, and a compact 32 px desktop target.
    The title reserve already accommodates the larger button, and close semantics,
    Escape/backdrop dismissal, focus restoration, and visual icon remain shared.
24. **Connector actions report results where they are invoked.** A global toast
    would stay visible but detach a probe from the channel that sent it; the old
    bottom-of-form message preserves document flow yet lands below Connection,
    Delivery, and Chat settings, often outside the viewport. The chosen model
    stores one adapter-scoped action result and renders pending test delivery,
    probe success, and test/reconnect failures inside that adapter's lifecycle
    panel. Progress and success use polite atomic status regions; failures use an
    alert, and icons accompany color. The lifecycle copy keeps its own polite
    update boundary instead of making the entire panel live, preventing action
    feedback from re-announcing every control. Starting another action clears the
    stale result; API behavior and external delivery semantics do not change.
25. **Owned channel cards expose the reversible runtime switch.** Keeping only
    Manage preserves a quiet card but makes a paused channel require a dialog
    round trip; adding a Turn on button only while paused shortens recovery yet
    leaves the inverse stop action hidden. The chosen model reuses the shared
    `Use <platform>` Toggle for every credential-ready owned channel, beside the
    existing setup/manage action. It changes only adapter availability: turning
    a channel on also allows the shared delivery service, while turning it off
    preserves credentials, private-chat binding, delivery preference, and Chat
    configuration. Save/restart progress disables that card's switch, and
    toggle/reconnect failures stay in the same card rather than appearing after
    unrelated channel groups. The card retains a single document-order action
    row that wraps on narrow screens; textual lifecycle status and an accessible
    switch name keep state independent of color. The Connector health domain
    owns the read-modify-save-refresh transaction so presentation code does not
    invent a parallel snapshot lifecycle.
26. **A channel card is the container; its information is not more cards.**
    Restyling the existing nested status and diagnostic boxes would retain a
    strong boundary around every sentence, while replacing the whole overview
    with a flat list would reduce visual noise at the cost of channel identity
    and the current responsive grouping. The chosen model keeps one bordered
    article per channel, then uses typography, spacing, the textual lifecycle
    badge, evidence rows, and thin separators inside it. The state description
    becomes ordinary primary copy, and Technical details remains a native
    disclosure without its own rounded panel. The service summary follows the
    same diagnostic treatment. Non-clickable card backgrounds no longer change
    on hover, so hover feedback belongs only to real buttons, switches, and
    disclosures. Document order, keyboard semantics, status text/icons, error
    coloring, responsive one/two-column grouping, and every action remain
    unchanged; this is a hierarchy correction rather than a new interaction.
27. **First-time setup starts with the task, not a duplicate status card.**
    Keeping the lifecycle panel in every stage is structurally consistent, but
    `Credentials required` has no control or recovery action and immediately
    repeats the expanded `Connection details · Required` section. Compressing it
    into a smaller banner would still make users read the same prerequisite
    twice. The chosen model omits only the `needs_credentials` lifecycle panel:
    the required Connection section, platform preparation guide, and fields
    become the first dialog/full-Settings content. The overview card and channel
    navigator still communicate `Needs setup` before entry. Ready-to-link,
    starting, awaiting-link, linked, linked-offline, and error stages retain the
    lifecycle panel because it owns a runtime switch, link instructions, test,
    reconnect, or actionable progress. This removes no control or state and does
    not change field disclosure, keyboard order, autosave, or narrow behavior.
28. **A Toggle should look like the control, not sit inside another control.**
    The lifecycle `Use <platform>` and Chat On/Off controls currently add a
    rounded bordered background around the shared Toggle, making each cluster
    resemble a compound button while the adjacent Inbox Toggle is unframed.
    Removing all visible labels would be lighter but would also remove Chat's
    explicit On/Off state. The chosen model retains `Use <platform>` and Chat's
    localized On/Off text, then removes only the secondary border, fill, radius,
    and padding. The shared Toggle continues to own its 40 px hit target,
    disabled state, focus ring, `role=switch`, and `aria-checked`; lifecycle copy
    and Chat text keep state from depending on color. Action wrapping and header
    alignment stay responsive, and real buttons such as Send test keep their
    distinct bordered shape.
29. **Sticky navigation owns the scrollport edge, not a padded gap.** The full
    Settings scroll owner begins below PageHeader, but its 20 px vertical
    padding constrains the sticky channel navigator 20 px below that edge. A
    preceding adapter's controls can therefore scroll through the gap; real
    geometry showed Slack's Save connection at y=95–129, the scrollport at
    y=101, and the navigator at y=121. Painting an upward mask could hide the
    symptom but also cover a stale/retry notice, while a negative sticky offset
    would clip the navigator itself. The chosen model removes top padding from
    the scroll owner and restores the same initial whitespace with an ordinary
    aria-hidden flow spacer. The spacer scrolls away, allowing `top: 0` to place
    the navigator exactly at the scrollport edge. Bottom/horizontal padding,
    mobile's static navigator, focus transfer, document order, and responsive
    section scroll margins remain unchanged.
30. **Channel navigation focuses the semantic heading, not the entire form.**
    Removing the current section focus ring while leaving focus on the region
    would hide keyboard context; keeping focus on the navigator would fail to
    announce the destination after scrolling. Real geometry shows the current
    Feishu focus target is a 609 x 602 px section, so its persistent ring frames
    most of the working view. The chosen model gives shared `ConfigSection` an
    optional focusable semantic heading. Connector navigation focuses that
    `<h3>` with `preventScroll`, then scrolls its labelled section as before.
    The title owns a compact visible ring, while the section retains its id,
    `aria-labelledby`, responsive scroll margin, and document structure without
    becoming a tab stop. Dialog content does not enable the option. Screen-reader
    destination context, keyboard focus, mobile/desktop positioning, and route
    history are preserved with a much more precise visual affordance.

## Ordered Work

- [x] Start this branch against the real Default AliceProject and record its
      current project, Connector service, and adapter health baseline.
- [x] Walk Settings > Connectors in the real browser route and capture concrete
      usability or diagnostic gaps without exposing credentials.
- [x] Trace the matching backend, protocol, adapter, journal, and Guardian paths
      for each observed gap.
- [x] Present the first coherent increment and alternatives to Ame before UI or
      interaction implementation.
- [ ] Implement accepted increments as atomic commits, updating this plan with
      evidence and remaining risks.
  - [x] Replace Start/Stop buttons with one per-adapter runtime switch.
  - [x] Replace visible phone-desk setup with `Chat on <connector>`, a Workspace
        choice, an independent switch, and collapsed heartbeat/prompt settings.
  - [x] Name newly created connector Issues `Chat on <label>` and use natural chat
        language in default What and domain/HTTP errors; conflict says
        `Chat on <Label> already exists`; do not rewrite existing Issues.
  - [x] Add a reusable configuration dialog and open one adapter's shared
        settings content from its overview card without changing routes.
  - [x] Replace the operations-style status table with a compact service summary
        and state-led Connector cards; hide raw owner identifiers and progressively
        disclose diagnostics.
  - [x] Reorder each Connector dialog into dependency-led Connection, Inbox
        delivery, and capability-gated Chat sections with first-use disclosure.
  - [x] Present the global Delivery service as a secondary pause-all control and
        remove implementation-oriented owner/Guardian/kill-switch setup copy.
  - [x] Add a data-driven, localized platform preparation guide to first-time
        credential setup without replacing the existing lifecycle.
  - [x] Unify overview and configuration lifecycle derivation, including durable
        linking, service-unreachable errors, stage-specific actions, and recovery.
  - [x] Save missing credentials as one connection while preserving confirmed
        per-token replacement and removal for configured credentials.
  - [x] Separate routine runtime controls from destructive linked-account
        maintenance and remove remaining runtime-facing Connector jargon.
  - [x] Replace blank Connector loading/failure states with skeletons and
        state-preserving recovery on overview and configuration surfaces.
  - [x] Make shared autosave feedback localized and accessible without changing
        Connector credential-save boundaries.
  - [x] Replace remaining Connector chat setup jargon with conversation and
        scheduled-check-in language while preserving Issue semantics.
  - [x] Separate owned/in-progress channels from pristine available adapters on
        the Connector overview without state-driven card reordering.
  - [x] Make short desktop Connector dialogs content-sized while preserving
        bounded scrolling for long forms and near-full-height narrow layouts.
  - [x] Remove repeated truncated card subtitles and fixed minimum heights so
        the overview prioritizes state, evidence, and the next action.
  - [x] Add a responsive lifecycle-aware channel navigator to the full Settings
        document without hiding forms, drafts, or changing routes.
  - [x] Localize the configuration-dialog close control and enlarge its mobile
        touch target without changing shared dismissal behavior.
  - [x] Keep test-delivery and reconnect feedback inside the triggering channel's
        lifecycle panel with localized accessible progress and errors.
  - [x] Add per-channel runtime switches to credential-ready overview cards and
        keep their save/reconnect feedback local to the affected card.
  - [x] Flatten informational boxes inside overview cards and remove hover cues
        from non-clickable channel surfaces.
  - [x] Remove the actionless duplicate lifecycle panel from first-time
        credential setup while retaining status in overview/navigation.
  - [x] Remove pseudo-button containers around lifecycle and Chat toggles while
        preserving visible state labels and shared Toggle semantics.
  - [x] Let the desktop channel navigator cover the Settings scrollport edge so
        controls from preceding channels cannot show through above it.
  - [x] Focus the destination channel heading instead of outlining the complete
        Settings form after navigator jumps.
- [ ] Reconcile the accumulated branch with current `dev`, run full acceptance,
      and open a PR only after Ame says the branch is ready.

## Verification

Every code increment runs `npx tsc --noEmit` and `pnpm test`, plus the smallest
relevant Connector lanes:

- `pnpm test:connector-replay`
- `pnpm test:connector-service`
- Settings browser verification on the real Default AliceProject
- isolated Guardian enable/restart/disable recovery when lifecycle changes
- Docker/package assertions when process layout or distributed resources change

The configuration-dialog increment passed its focused UI suite (21 tests), UI
typecheck/build, and real-route browser acceptance at desktop and 390 px widths.
The browser check confirmed route retention, one-adapter content, narrow-screen
action wrapping without horizontal overflow, close-button dismissal, and focus
restoration. No live connector action or configuration control was exercised.

The connection-center overview increment passed 23 focused UI tests, UI
typecheck/build, and real-route browser acceptance at desktop and 390 px widths.
The browser check covered healthy, paused, setup-required, and degraded cards;
collapsed diagnostics; responsive card/action flow; capability-specific dialog
copy; route retention; dismissal; and focus restoration. The overview no longer
renders raw owner identifiers. No live connector action or configuration control
was exercised.

The dependency-led configuration increment passed 24 focused UI tests, UI
typecheck/build, and real-route acceptance for unconfigured Slack, paused
Discord, degraded Telegram, and linked Feishu at desktop and 390 px widths. It
also verified the shared full Settings route. Connection now precedes delivery,
unavailable controls are omitted, Chat stays compact until linking, errors offer
in-context reconnect, and neither overview nor configuration copy renders raw
owner identifiers. No live reconnect, test delivery, credential, or toggle
action was exercised.

The Delivery-service control increment passed the same 24 focused UI tests,
UI typecheck/build, and real-route acceptance on the full Settings surface at
desktop and 390 px widths, followed by a regression check of `/connectors`.
The card explains automatic service startup, retains pause-all and health state
as secondary controls, uses a localized accessible switch, removes setup-facing
owner/Guardian/kill-switch language, and introduces no horizontal overflow.
No live service or adapter control was exercised.

The platform-preparation increment passed 26 focused API/UI tests, the 15-test
Connector protocol package suite, protocol and UI typechecks, the production UI
build, and the full repository suite. Real-route acceptance opened the
unconfigured Slack dialog at desktop and 390 px widths, where the localized
checklist remained readable, preserved a single scroll column, and introduced no
horizontal overflow. A separate `dev:demo` walkthrough verified the decoded
definition contract, official-link target, new-tab behavior, and the same desktop
and narrow layouts. The already-running real Connector process predates the new
link metadata and was deliberately not restarted, so no active adapter or external
account was disturbed.

The shared-lifecycle increment passed 32 focused setup/UI tests, UI and root
typechecks, the production build, all 5,101 repository tests, and real-route
acceptance against the same Default AliceProject. That project previously
exposed the contradiction: a paused Discord card now retains its
durable linked-chat state; the degraded Telegram card also remains linked and
presents Reconnect as the primary recovery action followed by Review. Desktop
and 390 px checks confirmed the new action hierarchy, exact one-error Reconnect
count, same-row narrow actions, and no horizontal overflow. No recovery or
configuration action was clicked.

The grouped-credential increment passed 27 focused Connector UI/lifecycle tests,
UI typecheck/build, root typecheck, and the 5,102-test monorepo suite. Real-route
browser acceptance covered the unconfigured Slack dialog at desktop and 390 px:
two missing tokens share one disabled-until-complete Save connection action, the
narrow action expands to the available width, and the document has no horizontal
overflow. No field was edited and no credential or external Connector action was
submitted on the real AliceProject.

The linked-account maintenance increment passed the same 27 focused tests, UI
typecheck/build, root typecheck, and all 5,102 repository tests. Real-route acceptance used
the linked Feishu dialog at desktop and 390 px: the lifecycle panel now exposes
only `Use Feishu` and Send test, while Unlink appears with preservation copy inside
Connection details beside credential maintenance. The maintenance row becomes a
full-width action on narrow screens and the page remains exactly 390 px wide. No
test, toggle, credential, removal, or unlink action was triggered.

The loading/recovery increment passed 31 focused state/setup/UI tests, UI and
root typechecks, the production build, and all 5,106 repository tests. Browser
acceptance used isolated
Vite instances and an ephemeral fake backend: it covered the overview recovery
surface, a configuration-dialog recovery surface, and last-known overview data
with a non-blocking refresh notice at desktop and 390 px. Every narrow state
matched the 390 px viewport without horizontal overflow. The isolated processes
and tabs were removed afterward; the real `/connectors` tab remained unchanged.

The shared-save-feedback increment passed 31 focused Connector/SaveIndicator
tests, UI and root typechecks, the production build, and all 5,110 repository
tests. Demo-browser acceptance changed only a non-secret Discord Application ID
and verified Saving/Saved feedback in the fixed configuration-dialog header at
desktop and 390 px widths. The status remained visible while the form was
scrolled without covering setup copy, the narrow title retained its hierarchy,
and the temporary demo tab, viewport override, and process were removed. The
increment also cancels delayed health refreshes when the settings surface
unmounts or a newer save supersedes them, preventing stale background work.

The conversation-language increment passed 41 focused editor/chat/demo tests,
UI and root typechecks, the production build, and all 5,111 repository tests.
Real-route acceptance covered the linked Feishu dialog at desktop and 390 px:
the hierarchy now reads Chat on Feishu, Scheduled check-ins, Check-in schedule,
and Check-in prompt without horizontal overflow. The existing user-authored
prompt remained unchanged and visible, confirming the UI does not rewrite durable
Issue content. Four locales and the demo-created chat use the same product model.

During isolated-demo setup, one terminal request to Vite port 5174 bypassed the
browser-only MSW layer and was proxied to a separate Office development instance
on 47331. The active acceptance instance on 47431 was unchanged. The Office home
had no Connector config files before that request: the three affected files had
all been created at the request timestamp while the rest of its config predated
them. Recovery first disabled the mistakenly started service, then removed only
those newly created `connectors.json`, `connector-service.json`, and restart-flag
files. A readback returned the original default state: service disabled, every
adapter unconfigured, and no saved credentials. No external message was sent;
the temporary demo credential produced only a platform 404. Subsequent browser
acceptance used visible read-only UI interaction only.

The channel-grouping increment passed 29 focused overview/demo tests, UI and
root typechecks, the production build, and all 5,112 repository tests. The
grouping spec covers a mixed state where a partially credentialed Slack adapter
remains owned/in-progress while a pristine Telegram adapter stays available.
Real Default AliceProject acceptance at desktop and 390 px showed Discord,
Telegram, and Feishu in stable definition order under Your channels, followed
by pristine Slack under Available channels. Both headings and their descriptions
remained in document order, no group was represented by color alone, and no
Connector action was triggered. The temporary viewport override was reset.

The adaptive-dialog increment passed the same 29 focused overview/demo tests,
UI and root typechecks, the production build, and all 5,112 repository tests.
Real Default AliceProject measurements at the 1,052 x 734 desktop viewport
showed the short Discord dialog shrink from 702 px to 381 px and the longer
Feishu dialog settle at 611 px. The first-time Slack form remained capped at
702 px with its 742 px content scrolling inside the dialog. At 390 x 844,
Slack and an expanded Discord connection both retained the 828 px near-full-
height shell, internal scrolling, and a document width exactly matching the
390 px viewport. Focus/dismissal behavior remained on the shared dialog
primitive, no Connector action was triggered, and the viewport was reset.

The compact-card increment passed 29 focused overview/demo tests, UI and root
typechecks, the production build, and all 5,112 repository tests. Real desktop
measurements kept the diagnostic-heavy Discord/Telegram row equal at 294 px,
while Feishu reduced from 250 px to 226 px and pristine Slack from 250 px to
197 px. No card rendered the repeated generic delivery subtitle. At 390 px,
all four lifecycle states retained platform, textual state, evidence,
diagnostics, and actions in document order; the page width remained exactly
390 px. The first full-suite run exposed an existing async test race where the
Slack assertion treated the open loading skeleton as loaded settings. The test
now waits for Save connection, its targeted rerun passed, and the full suite
then passed. No Connector action was triggered and the viewport was reset.

The full-settings navigator increment passed 30 focused overview/demo tests,
UI and root typechecks, the production build, and all 5,113 repository tests.
The interaction spec verifies four lifecycle-labelled buttons, a semantic Slack
region, focus transfer, scrolling, and the responsive sticky offset. Real
Default AliceProject acceptance at 1,052 x 734 first caught a four-column
Telegram truncation and then a sticky-overlay defect; the final two-column
layout rendered every platform/status in full, and the Slack heading sat
directly below the 133 px sticky navigator with focus visibly transferred. At
390 x 844 the static one-column navigator rendered all four labels without
overflow, then scrolled entirely away while focused Feishu settings began below
the mobile header. Both paths retained `/settings/connectors`, added no URL
history, and changed no Connector setting or external state. The viewport was
reset.

The localized-close increment passed the same 30 focused overview/demo tests,
UI and root typechecks, the production build, and all 5,113 repository tests.
The localized route test opens the ConfigurationDialog in Chinese and finds
`关闭`; the shell contract also asserts its 40 px mobile and 32 px desktop size
classes. Real Default AliceProject acceptance measured the rendered close
control at exactly 32 x 32 px at 1,052 x 734 and 40 x 40 px at 390 x 844. The
larger narrow target did not overlap the title or create horizontal overflow;
click dismissal still closed the dialog and the viewport was reset. No
Connector control or external action was triggered.

The contextual-action-feedback increment passed 31 focused Connector tests,
UI and root typechecks, the production build, and all 5,114 repository tests.
The interaction specs verify that successful and failed test-delivery feedback
appears exactly once inside the same lifecycle region as Send test, using a
polite status for progress/success and an alert for failure. Real Default
AliceProject acceptance at 1,052 x 734 and 390 x 844 confirmed that the Feishu
lifecycle panel retained its readable action layout without horizontal
overflow. The isolated demo's pristine fixtures expose no Send test action, so
dynamic visual states were accepted through the semantic interaction specs
rather than hidden state injection or a real Connector API call. No external
message was sent, no Connector state changed, and the viewport was reset.

The overview-runtime-control increment passed 41 focused overview, health-store,
and Connector demo tests, plus UI typecheck and production build. The domain
tests prove that starting one channel also allows the shared delivery service,
while stopping one channel preserves service state and adapter settings. The
interaction specs cover credential gating, a globally paused channel whose
retained preference must still render an off runtime switch, local pending
status, local toggle failure, and local reconnect failure. Real Default
AliceProject acceptance at 1,052 x 734 showed runtime switches for Discord,
Telegram, and Feishu but none for pristine Slack. The first layout placed three
Telegram actions into an accidental two-line wrap; the accepted card footer now
uses a stable availability row followed by its task-button row. At 390 x 844,
all labels, switches, reconnect/review buttons, state evidence, and diagnostics
remained in document order with a page width exactly matching the viewport. No
control was clicked, no external message was sent, no Connector state changed,
and the viewport was reset.

The single-container-card increment passed 35 focused overview and Connector
demo tests, UI and root typechecks, the production build, and all 5,120
repository tests. Real Default AliceProject acceptance at 1,052 x 734 confirmed
that the service summary and four channel
articles retained their status, evidence, diagnostic disclosure, runtime switch,
and task actions after the nested informational panels were removed. At 390 x
844, Discord, Telegram, and Feishu preserved the same reading and touch order;
the Telegram diagnostic remained a native disclosure between evidence and
runtime controls, and the page width exactly matched the viewport. Card-level
hover classes are absent, while buttons, switches, and disclosure summaries keep
their own affordances. No control was clicked, no external message was sent, no
Connector state changed, and the viewport was reset.

The first-task-first increment passed 35 focused overview and Connector demo
tests, UI and root typechecks, the production build, and all 5,120 repository
tests. Its dialog test proves that an unconfigured adapter exposes no runtime
switch and no duplicate `Credentials required` panel while retaining the
expanded Connection section, official setup
links in the current catalog fixture, delivery ordering, and capability-gated
Chat preview. Real Default AliceProject acceptance at 1,052 x 734 moved Slack's
preparation guide, both credential fields, and Save connection into the first
desktop task view. At 390 x 844 the same content remained a single scroll owner,
Save connection fit the available width, and the page width exactly matched the
viewport. Full Settings rendered zero duplicate credential-status panels while
its channel navigator still reported Discord Offline, Telegram Unavailable,
Slack Setup, and Feishu Ready. The live process still predates setup-link
metadata as already recorded by the platform-preparation increment; it was not
restarted. No credential, delivery, or Connector control was changed, and the
viewport was reset.

The direct-toggle increment passed 41 focused lifecycle, Chat panel, overview,
and Connector demo tests, UI and root typechecks, the production build, and all
5,120 repository tests. The component contracts assert that runtime and Chat
switch wrappers contain neither border
nor rounded-container classes while preserving `Use <platform>`, localized
On/Off text, `role=switch`, and existing enable/disable behavior. Real Default
AliceProject acceptance at 1,052 x 734 showed Feishu runtime, Inbox, and Chat
switches using one consistent visual grammar; Send test remained a distinct
button. At 390 x 844 the runtime actions wrapped in order, Chat retained visible
On state, all switch hit targets remained available, and the page width exactly
matched the viewport. No Toggle or Connector action was invoked, and the
viewport was reset. The desktop pass also exposed a separate sticky-navigator
gap that can reveal a preceding channel's scrolling controls; that is the next
owned increment rather than hidden in this visual-only change.

The sticky-edge increment passed 35 focused settings-navigation, overview, and
Connector demo tests, UI and root typechecks, the production build, and all
5,120 repository tests. Its structural contract keeps horizontal/bottom padding
on the scroll owner, replaces only top
padding with an aria-hidden 20 px flow spacer, and preserves the desktop-only
`sticky top-0` navigator. Real Default AliceProject geometry at 1,052 x 734
reproduced the defect with scrollport top 101 px, navigator top 121 px, and the
preceding Slack Save connection spanning y=95–129. After the change the
navigator top equaled the scrollport at 101 px (`gap: 0`) and fully covered the
still-scrolling control. At 390 x 844, computed navigation position remained
`static`, the initial gap remained 20 px, the navigator scrolled entirely above
the viewport after choosing Feishu, and the focused section began 16 px below
the scrollport edge with no horizontal overflow. No field, Toggle, or Connector
action was invoked, and the viewport was reset.

The heading-focus increment passed 35 focused settings-navigation, overview,
and Connector demo tests, UI and root typechecks, the production build, and all
5,120 repository tests. The interaction contract asserts that the labelled
channel region is no longer focusable, while its semantic heading has
programmatic `tabindex=-1` and a compact focus ring, focus
moves to that heading, and the region still receives the native scroll request.
Real Default AliceProject measurements at 1,052 x 734 reduced the Feishu active
element from a 609 x 602 px SECTION to a 44 x 21 px H3 while preserving section
top 253 px below the sticky navigator. At 390 x 844, the same H3 began at y=191,
the section at y=167, the static navigator had fully scrolled above the viewport,
and the document width remained exactly 390 px. No form or Connector control was
invoked, and the viewport was reset.

Live Telegram, Discord, Slack, or Feishu delivery is reported as skipped unless
Ame explicitly authorizes the external-account action.

## Non-goals

- turning a feature branch into a preview or release lane;
- moving Inbox, Workspace, or UTA ownership into Connector Service;
- exposing or copying connector credentials;
- submitting trading actions as part of ordinary Connector testing;
- claiming cross-adapter capability parity without real implementation.

## Completion

The branch has an accepted Connector outcome, the real Default AliceProject and
required isolated lanes verify the accumulated diff, stable conclusions are in
the owner guide, and Ame explicitly asks to open the PR to `dev`. Delete this
plan and its `PLANS.md` entry in the accepted integration change.
