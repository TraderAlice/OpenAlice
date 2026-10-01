# Settings Machines and Add Machine dialog

Status: implementing on `codex/settings-machines-dialog`; Draft PR only, no merge/release.
Base: `75c1c8c1a81020af4bfddaeaf9204bda5e18a39b` (includes #1693 and #1691).
Owner guides: [[docs/remote-access.md]], [[docs/data-locations.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/demo-mode.md]], [[docs/testing.md]].

## Frozen product and visual contract (v1)

Goal: find machine controls directly under Settings / General / Machines, then
add an SSH machine without expanding a form into the fleet list. The parent
reviewed PRD v1; D1–D5 were generated and inspected by parent and implementer
before production edits. No separate user approval at each implementation step.

Design evidence in Slack workspace T0C62C55Z7A, channel C0C59V8S9RP,
thread 1790840275.051999 (attachments, never committed image binaries):

- D1 page: F0C6RCT6DGQ
- D2 form modal: F0C5V3FHS94
- D3 plan review: F0C5V3JP5SA
- D4 probe error / blocker / applying / apply error: F0C5WT6NT6E
- D5 narrow form and scrollable review: F0C6RD30AP2

Use existing tokens and shell: white content, cool-gray sidebar, thin borders,
blue interaction. Machines follows Overview before Language. `/settings/machines`
uses the Settings tab registry and normal history, not custom navigation.
The page keeps a 1100px content maximum; dialog maximum 640px, at least 16px
viewport inset, scrolling body and fixed header/footer, two form columns on
desktop and one on narrow screens. Image annotations are not product copy.
D5 port helper belongs to the port field. `22` is a placeholder, never a default.

Move only MachineManagementSection. Keep Where Alice is working / Switch
location, version/update overview, Data location and Windows shell in Overview.
Machine profiles and SSH belong to the local control plane. AliceProject homes
belong to their Runtime. No migration, new registry, credentials upload,
rename/remove, automatic connection, or new backend endpoint.

## Requirements and acceptance trace

| Requirement / acceptance | Surface / implementation | Evidence required |
|---|---|---|
| REQ-01 / AC-01 navigation and history | D1; category, tabs types/registry/UrlAdopter, MachinesSettingsPage | direct URL, reload, Back/Forward, sidebar selection |
| REQ-02 / AC-02 fleet and states | D1; MachineManagementSection | local, online, incompatible/unavailable, refresh/error/empty |
| REQ-03 / AC-03 modal and validation | D2/D5; AddMachineDialog | no inline form, trim required values, integer port 1–65535 |
| REQ-04 / AC-04 read-only probe | D2/D4; shared machines provider | no apply on probe; input edit/close/unmount invalidate late result |
| REQ-05 / AC-05 reviewed approval | D3/D4; modal review | exact target/actions/versions; blockers cannot approve; no remote changes still requires save approval |
| REQ-06 / AC-06 operation lifecycle | D4; existing plan/apply/operation | one approval; failure/expiry requires fresh review; successful fleet refresh without switching |
| REQ-07 / AC-07 dismissal and recovery | D2–D4; modal + shared provider | discard unapproved draft on close; reopen fresh; running operation continues across navigation and can restore |
| REQ-08 / AC-08 accessibility/responsive | D2/D5; shared Base UI Dialog | initial/final focus, Tab trap, Escape rules, visible errors, 390px body/footer |
| REQ-09 / AC-09 boundaries | Overview, update lifecycle, location | existing data-home, update plan, setup guidance and target selection regressions |
| REQ-10 / AC-10 delivery | Draft PR + Vercel demo | official attachment screenshots, demo routes/mock limits, exact-head CI |

## Journey and state contract

Form: SSH target + Machine label required; optional SSH port and local SSH key
path. Blank port uses OpenSSH configuration. Probe is read-only. Cancel/X/Escape
can dismiss pending probes without claiming to terminate an SSH process. Edits
or dismissal invalidate responses through the existing generation guard.

Probe failure stays in the modal with entered values and Retry probe. Success
shows Review Machine plan: machine, SSH target, platform, Runtime, active / target
and installed versions, actual planned actions, blocker or deferred/restart
notice. No fake fixed install/restart steps. Back invalidates approval and
returns to editable inputs. Only Approve and add Machine writes; adding with
no remote mutations still saves a local profile. No automatic connection.

While applying: real operation status, no percentage, no X/Cancel/Escape.
Keep this window open while the Machine is added. Provider outlives navigation;
returning restores only the matching running add operation, never an old upgrade.
Failure explains partial completion and offers Close / Review again; no old
plan resubmission. Success refreshes list, closes and announces Machine added.
Reload-restored operations lack target/draft details in the existing operation
contract; do not invent them, and require re-entry for a new review if needed.

Dialog owns draft, phase and approved plan association. Shared
useUpdateLifecycle().machines owns data and mutations. Existing transport stays
Electron desktopMachine.plan/apply/operation or /relay/v1/machines/{plan,apply,operation}.
Apply submits only the reviewed plan ID. Backend expiry, fingerprint validation
and single-use approval remain authoritative. Focus starts at SSH target,
results are announced, Tab is trapped, close restores the trigger. Navigation
away clears only this dialog's unapproved work.

## Ordered work

- [x] Read current dev, owner guides, screenshots and machine/data contracts.
- [x] Freeze PRD v1 and inspect actual generated D1–D5.
- [x] Implement navigation, modal states and localized copy.
- [x] Add meaningful regression tests and accurate demo scenarios.
- [ ] UI typecheck, UI owner suite, real browser desktop/narrow/keyboard/history.
- [ ] Compare actual screenshots with D1–D5; attach outside source tree.
- [ ] Open Draft PR to dev, record Vercel preview and exact-head CI; do not merge.

Verification limitations must be stated explicitly: browser demo uses MSW and
simulates SSH, install and save. It is not real remote-host or packaged Electron
acceptance. Full installation initially hit refused GitHub release downloads
for Electron/dugite; UI dependencies can be installed without lifecycle scripts.

Browser discovery: the existing sidebar only changed tab state and UrlSync
replaced the address, so category clicks had no Back entry. Settings category
clicks now also use the existing React Router navigate function to push history;
tab registry/adoption and global UrlSync remain intact. This is required for
AC-01, not a global navigation rewrite.

Local evidence: initial UI owner run passed 363 files / 2,114 tests. Subsequent
focused route/provider tests passed 79 assertions; add-dialog recovery and demo
approval tests also pass. Chromium acceptance at 1440×1000 and 390×844 passed
form/review/apply, probe error retry, blocked review, apply failure/review retry,
focus trap/return, Escape, saved Current target, direct route, reload and actual
Back/Forward. Final exact-head verification and delivery remain pending.

## Recovery and mixed-navigation follow-up

Review found two reproduction-backed gaps. A replacement renderer had no
apply promise to refresh its fleet after a restored add completed. The dialog
now refreshes once before announcing success only when the original provider
flight does not already own that refresh. A late first operation response can
adopt a running add even after the form opened; historical completion and
upgrade operations are ignored.

Settings Developer entries now use the same Router navigation as categories.
The URL adopter also keys adoption to a fresh Router location, so same-path
navigation recovers from a tab-only native URL projection. Actual Router/store
regressions cover Machines/Logs/Overview and Back/Forward.

GitHub CLI 2.102.0 was fetched from its official release and verified against
the official SHA-256 manifest. Its documented --attach command accepts the
option, but uploading the first PNG returned HTTP 400 Bad Content-Length; the
CLI explicitly reported that the PR was not changed. No authentication or
global network settings were changed. The requester has received two verified
compressed actual screenshots in Slack; high-resolution originals are retained.

Follow-up local checks: 65 targeted assertions passed; the real browser
controller-restoration fixture passed both reload-during-add and late-operation
discovery. Each completion issued exactly one additional fleet read, displayed
Restored Cloud without changing Current, and issued zero apply calls. Browser
Machines/Logs/Overview history also passed. The injected controller is a test
fixture, not real SSH acceptance.
