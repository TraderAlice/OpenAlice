# Alice Landing

These instructions apply to `apps/landing/`. Run the commands below from this
directory, or use the root `landing:dev` and `landing:build` shortcuts.
Read [[docs/landing.md]] for the media and deployment boundary.

## Visual change gate

Any change that can affect appearance or layout must be verified in the actual
site before it is handed off. This includes JSX or MDX structure, copy whose
length can change wrapping, Tailwind or CSS classes, images, typography,
spacing, responsive behavior, and navigation presentation.

For every such change:

1. Start the site locally with `pnpm dev` and open the affected route in a real
   browser.
2. Inspect the rendered result visually; source review and a successful build
   are not substitutes for looking at the page.
3. Check both a normal desktop viewport and a narrow mobile viewport when the
   page is responsive.
4. Check for horizontal overflow, broken wrapping, clipped content, and browser
   console errors.
5. Capture at least one screenshot of the rendered result and attach or embed
   it in the user-facing handoff. Use multiple screenshots when one image cannot
   clearly show the affected desktop and mobile states.
6. Report the route and viewport(s) inspected. Do not describe a visual change
   as complete if the browser inspection or screenshot handoff was skipped.

## Local checks

Run the checks proportionate to the change. For ordinary site and documentation
changes, use:

```bash
pnpm lint
pnpm build
```

Preserve unrelated work and stage only files that belong to the requested
change.
