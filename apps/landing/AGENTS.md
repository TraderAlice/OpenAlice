# Alice Landing (`@traderalice/landing`)

These instructions own the public Next.js website, user documentation, and blog
in `apps/landing/`. Run commands from this directory or use the root
`pnpm landing:dev` and `pnpm landing:build` shortcuts.

## Source and Media Boundary

| Path | Owns |
|---|---|
| `apps/landing/app/`, `components/`, `lib/` | Next.js routes, website presentation, Markdown/MDX rendering, and media resolution |
| `apps/landing/content/posts/` | Public blog content and its registry |
| `docs/` (repo root) | Unified `.md` documentation (`docs/guides/`, `docs/architecture/`, and `docs/SUMMARY.md`) |

The private `TraderAlice/alice-landing` repository retains raw media, recording
recipes, and R2 publishing credentials. `next.config.ts` calls
`scripts/prepare-media.mjs` before `dev` and `build` to fetch only the public
JSON index (`https://download.openalice.ai/website/index.json`) into gitignored
`apps/landing/.cache/media-index.json`. Images and videos remain on the public
CDN (`NEXT_PUBLIC_MEDIA_BASE_URL` overrides the host). A failed or invalid index
fetch stops startup/build even when an older cache exists; `next start` on an
already-built site uses compiled metadata without refetching.

Root product `build`, `build:server`, desktop/CLI packaging, and remote smoke
exclude `@traderalice/landing`. Website CI runs separately in
`.github/workflows/landing.yml` with Turbo caching disabled (external media
index input). `apps/landing/vercel.json` configures the website Vercel project
(`apps/landing` as Root Directory), while root `vercel.json` serves the `ui/dist`
product demo.

## Visual Change Gate

Any change that can affect appearance or layout (JSX/MDX structure, copy length,
Tailwind/CSS, images, typography, spacing, responsive behavior, navigation) must
be verified in a real browser before handoff:

1. Start `pnpm landing:dev` (`http://localhost:6066`) and open the affected
   route in a real browser.
2. Inspect both a desktop viewport (`1440×1000`) and a narrow mobile viewport
   (`390×844`) when responsive.
3. Check for horizontal overflow, broken wrapping, clipped content, and browser
   console errors.
4. Capture screenshot evidence and report the routes and viewports inspected.

## Local Checks

```bash
pnpm --filter @traderalice/landing test
pnpm --filter @traderalice/landing lint
pnpm landing:build
```

Preserve unrelated work and stage only files belonging to the requested change.
