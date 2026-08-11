# Quick Start Launch Context

Status: Completed

Owner guides:

- [[../docs/model-semantics-and-runtime-injection.md]]
- [[../docs/ui-interaction-and-motion.md]]

## Problem

Quick Start placed Workspace, Agent runtime, vault slug, model, and effort in
one undifferentiated control strip. Provider slugs were meaningful only to the
person who created them, native runtime authentication could not be selected
explicitly, and ownership explanations repeated implementation details inside
the primary send path.

## Decisions

1. Workspace and Agent runtime form the Session launch context and sit outside
   the message composer.
2. AI access is a separate choice inside the composer. It names the provider
   first, identifies saved access second, and permits the Agent runtime's own
   login/config without an OpenAlice credential.
3. Model and effort remain optional, provider-aware Session launch parameters.
4. Quick Start remembers the most recent compatible access/model/effort tuple
   without rewriting Workspace AI settings.
5. The selected values are the disclosure. Quick Start does not teach internal
   override or persistence mechanics through permanent badges and prose.

## Work

- [x] Split Session context from AI execution controls and make the layout
      responsive from phone through desktop widths.
- [x] Keep AI execution controls as a compact composer toolbar instead of
      expanding them into labeled settings fields.
- [x] Combine model and effort behind one compact trigger with nested,
      keyboard-accessible menus while preserving free-typed model ids.
- [x] Add human-readable provider identity and an explicit native-runtime
      access choice.
- [x] Give the AI-access menu a runtime-aware context line without adding a
      focusable setting or implementation-detail explanation.
- [x] Restyle example prompts as a labeled, responsive suggestion strip with
      one-shot staggered entrance and reduced-motion fallback.
- [x] Replace generic chatbot examples with two compact sets that expose
      market, portfolio, research, Workspace, automation, and AutoQuant
      capabilities through evidence- and permission-aware full prompts.
- [x] Persist and migrate the recent access mode without storing secrets.
- [x] Carry explicit native access through every Quick Start launch route and
      Session runtime binding.
- [x] Add backend, migration, route, hook, component, and layout regressions.
- [x] Verify the real `/chat` route at desktop, compact, and phone widths.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- Focused preference, migration, runtime-binding, route, hook, and UI suites
- Real `pnpm dev` browser walk at 907px, 720px, and 390px widths

## Completion Criteria

Quick Start clearly answers where the Session starts, which Agent runs it, and
which AI access/model/effort will be used; native runtime authentication is a
first-class no-vault option; recent selections survive reloads; and the
composer has no horizontal overflow or implementation-detail disclosure.
