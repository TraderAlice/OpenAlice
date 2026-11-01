# Public Website

This guide owns the public website in `apps/landing/`: source and content
ownership, media preparation, independent builds, and deployment configuration.
The workspace package is `@traderalice/landing`.

## Source Ownership

| Path | Owns |
|---|---|
| `apps/landing/app/`, `components/`, `lib/` | Next.js routes, website presentation, MDX rendering, and media resolution |
| `apps/landing/content/docs/` | Public user documentation; `SUMMARY.md` supplies website navigation |
| `apps/landing/content/posts/` | Public blog content and its registry |
| `docs/` | Repository owner guides and contributor documentation; catalogued in [[docs/README.md]] |

The private `TraderAlice/alice-landing` repository retains source media,
recording recipes, and media publishing tooling and credentials. The migration
keeps that repository intact and imports neither its Git history nor its heavy
media assets. Public documentation and blog content are copied without
editorial changes.

## Media Preparation

[next.config.ts](../apps/landing/next.config.ts) calls
[prepare-media.mjs](../apps/landing/scripts/prepare-media.mjs) before development
startup and production builds. It fetches the current public
[media index](https://download.openalice.ai/website/index.json), validates it,
and writes `apps/landing/.cache/media-index.json`. The default media base is
`https://download.openalice.ai/website`; `NEXT_PUBLIC_MEDIA_BASE_URL` can select
another compatible HTTPS publication.

Only the JSON index is downloaded. Images and videos stay on the public media
host and are requested by the browser. No storage credentials or access to the
private repository is required. The generated index is ignored by Git; there
is no tracked copy or cross-repository index synchronization.

A failed fetch or invalid index stops startup/build, even if an older cache
exists. Each development startup and build reads the latest published index;
it is not pinned to the source commit. Starting an existing production build
with `next start` uses its compiled metadata and does not fetch the index again.
[lib/media.ts](../apps/landing/lib/media.ts) and
[lib/rehype-media.mjs](../apps/landing/lib/rehype-media.mjs) consume the prepared
metadata for URLs and image dimensions.

## Development and Verification

Use the [package README](../apps/landing/README.md) for local commands. Keep
Next.js, TypeScript, and ESLint configuration within `apps/landing/`, while
using the root pnpm workspace and lockfile.

From the repository root, the website checks are:

```bash
pnpm --filter @traderalice/landing test
pnpm --filter @traderalice/landing lint
pnpm landing:build
```

The Node tests use isolated inputs; a real build reads the public index.
For changes affecting appearance, follow the desktop/mobile browser checks in
[apps/landing/AGENTS.md](../apps/landing/AGENTS.md). General test selection lives
in [[docs/testing.md]].

## Build and Deployment Boundary

Root product `build`, `build:server`, and the remote smoke image exclude the
landing package. Desktop and CLI artifacts do not include the website.
Website CI is separate in `.github/workflows/landing.yml`, running the package
tests, lint, and build. Turbo build caching is disabled for this package because
the current public index is an external build input.

`apps/landing/vercel.json` configures the independent Next.js application. A
website Vercel project should use `apps/landing` as its Root Directory. The root
`vercel.json` continues to serve the product demo from `ui/dist`. Moving source
into this repository does not switch the production website deployment.
