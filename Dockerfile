# OpenAlice — server / self-host image.
#
# Two-stage build: full toolchain in `build`, slim runtime with only what's
# needed to run `node dist/main.js` plus the bundled agent CLIs.
#
# Target audience: VPS self-hosters running Workspace chat. Auth is the
# user's responsibility — `docker exec -it openalice claude` once after
# first up, then OpenAlice is good to go.

# ─── build stage ──────────────────────────────────────────
FROM node:22-trixie AS build
WORKDIR /src

# pnpm via corepack (ships with Node 22). Pin the version we develop with
# so the install plan is reproducible.
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

# Cache-friendly: copy only manifests first so the dep-resolution layer
# stays warm across source-only changes. `scripts/` joins this layer
# because the root postinstall hook (`fix-pty-perms.mjs`) runs at the end
# of `pnpm install` and must already exist on disk.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY scripts ./scripts
COPY packages/ibkr/package.json packages/ibkr/
COPY packages/opentypebb/package.json packages/opentypebb/
COPY ui/package.json ui/

RUN pnpm install --frozen-lockfile

# Source + build. `pnpm build` runs `turbo run build` (workspace packages
# + UI Vite build) then `tsup` bundles the backend into `dist/main.js`.
COPY . .
RUN pnpm build

# Strip dev deps before the runtime stage harvests node_modules. With
# `electron` + `electron-builder` (each ~500MB) in devDependencies, this
# is the difference between a 2.9GB image and a sub-1GB image. `CI=true`
# satisfies pnpm's "won't remove modules without TTY confirmation" check.
RUN CI=true pnpm prune --prod --config.ignore-scripts=true

# ─── runtime stage ────────────────────────────────────────
FROM node:22-trixie-slim AS runtime
WORKDIR /app

# Bash + POSIX utils are required by workspace bootstrap.sh scripts;
# bookworm-slim already ships them. We install the two agent CLIs
# globally so they're on PATH for the PTY sessions OpenAlice spawns.
#
# Both come from npm (codex's npm package is a thin wrapper that pulls
# down the Rust binary on install). Smoke-checking versions at build time
# fails the build loud if either package broke.
RUN npm install -g \
        @anthropic-ai/claude-code \
        @openai/codex \
    && claude --version \
    && codex --version \
    && npm cache clean --force

# Production artifacts.
COPY --from=build /src/dist                       ./dist
COPY --from=build /src/ui/dist                    ./ui/dist
COPY --from=build /src/default                    ./default
COPY --from=build /src/src/workspaces/templates   ./src/workspaces/templates
# tsup bundles backend deps into dist/main.js where possible, but a few
# native modules (notably node-pty) stay as runtime requires.
COPY --from=build /src/node_modules               ./node_modules
COPY --from=build /src/package.json               ./package.json
# Workspace packages — node_modules/@traderalice/* are pnpm symlinks
# resolving to `packages/*/dist` via relative paths. Without these,
# `import('@traderalice/ibkr')` from the bundled dist/main.js fails
# with ERR_MODULE_NOT_FOUND at startup.
COPY --from=build /src/packages                   ./packages

# Two-home model — see src/core/paths.ts.
#   /app  = APP_RESOURCES_HOME  (image content, baked in)
#   /data = USER_DATA_HOME      (the volume the user mounts)
# HOME redirects ~/.claude / ~/.codex / ~/.config etc. into the volume so
# auth tokens + agent state persist across container rebuild.
ENV OPENALICE_APP_HOME=/app \
    OPENALICE_HOME=/data \
    AQ_LAUNCHER_ROOT=/data/workspaces \
    HOME=/data/home \
    NODE_ENV=production \
    OPENALICE_WEB_PORT=47331 \
    OPENALICE_MCP_PORT=47332

VOLUME ["/data"]
EXPOSE 47331

CMD ["node", "dist/main.js"]
