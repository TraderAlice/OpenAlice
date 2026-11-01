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

Development startup and builds need access to the public media index. They
download only its JSON metadata; images and videos remain remote. Serving an
existing build does not fetch the index again.

See the [website owner guide](../../docs/landing.md) for media ownership,
verification, and deployment boundaries, and [AGENTS.md](AGENTS.md) for visual
acceptance requirements.
