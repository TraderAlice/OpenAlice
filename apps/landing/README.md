# OpenAlice Website

The public Next.js website, user documentation, and blog live in this workspace
package, `@traderalice/landing`.

After installing dependencies from the repository root, run:

```bash
pnpm landing:dev
```

The local site is available at <http://localhost:6066>. To build and serve it:

```bash
pnpm landing:build
pnpm --filter @traderalice/landing start
```

Development startup and builds fetch the public media JSON index; images and
videos remain remote on the CDN. Serving an existing build does not fetch the
index again.

See [AGENTS.md](AGENTS.md) for source/media ownership, build boundaries, and
visual acceptance requirements.
