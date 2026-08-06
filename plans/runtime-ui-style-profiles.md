# Runtime UI Style Profiles

- Status: `completed`
- Updated: `2026-08-04`
- Delivery: serial PR #976 merged to `dev`.
- Owner guides: [[docs/ui-interaction-and-motion.md]],
  [[docs/development-workflow.md]], and [[docs/project-structure.md]].

## Outcome

OpenAlice can switch its component appearance at runtime without reloading or
changing the selected color palettes. The first release keeps the current
workstation as Default and adds Windows 98 and Broker Classic profiles. The
profiles reuse owned shadcn/Base UI behavior and semantic color tokens rather
than forking components or introducing profile-specific product logic.

## Decisions

- `data-palette` remains the independent color axis. A new `data-ui-style`
  attribute owns typography, geometry, elevation, density, and motion.
- Default is byte-for-byte compatible with the current visual language.
- Windows 98 uses square geometry, semantic beveled surfaces, classic pressed
  states, and reduced decorative motion without copying system assets.
- Broker Classic is an IBKR/TWS-inspired dense workstation profile, not an
  IBKR brand replica. It uses compact flat controls, strong separators, and
  tabular data while retaining OpenAlice semantic colors and identity.
- Touch targets stay usable at narrow widths. Broker density reductions apply
  only on desktop-sized fine-pointer devices.
- The persisted choice is normalized defensively and injected by the inline
  no-flash bootstrap before React renders.

## Work

- [x] Add the style-profile registry, persisted preference, document attribute,
      no-flash bootstrap, and migration-focused tests.
- [x] Add a live Settings selector with localized names, descriptions, and
      miniature profile previews.
- [x] Style shared shadcn slots and OpenAlice shell/form seams for Windows 98
      and Broker Classic without changing primitive behavior.
- [x] Exercise Settings, Chat, sidebars, forms, tables, menus, popovers,
      dialogs, alert dialogs, and sheets in the real development runtime at
      desktop, tablet, and phone widths.
- [x] Run root/UI typechecks, the full Vitest suite, production UI build, and
      unsigned packaged Electron Workspace smoke.
- [x] Merge the serial PR to `dev`, run a post-merge smoke, and archive this
      plan under Completed.

## Verification Record

- Confirmed live switching, persistence across reload, and independent palette
  selection in Settings; restored the user's original Default + Auto state
  after testing.
- Exercised Default, Windows 98, and Broker Classic on Settings, Chat, a real
  Portfolio account, and an Issue activity trail. Verified the Chat menu,
  destructive confirmation, Place Order form without submitting, identity
  popover, mobile Sheet, and a menu nested inside that Sheet.
- Checked the 1280px desktop surface, 740px tablet layout, and 390px phone
  layout. Broker density applies on desktop while phone controls retain their
  touch-size floor.
- Passed root and UI TypeScript, 3,907 Vitest tests (plus 9 skipped), the
  production UI build, and unsigned packaged Electron Workspace acceptance.
- Serial PR #976 merged to `dev`; the merge commit passed the focused 23-test
  theme suite and a real Default → Windows 98 → Default runtime switch while
  preserving the user's Auto + Iris preference.

## Completion Criteria

- Changing profiles updates the active page and open shared primitives without
  reload, preserves the palette pair, and survives restart.
- All three profiles remain legible in day and night palettes and preserve
  keyboard focus, dismissal, reduced-motion, and responsive behavior.
- No profile ships hard-coded product colors, copied brand assets, duplicated
  overlay behavior, or profile-specific domain branches.
- Required local, browser, and packaged checks pass, and the integration PR is
  merged with a successful post-merge smoke.
