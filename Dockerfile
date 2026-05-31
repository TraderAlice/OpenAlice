# OpenAlice — server / self-host image.
#
# Two-stage build: full toolchain in `build`, slim runtime with only what's
# needed to run the Guardian supervisor + the two long-lived processes
# (Alice main + UTA service) plus the bundled agent CLIs.
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
COPY packages/uta-protocol/package.json packages/uta-protocol/
COPY services/uta/package.json services/uta/
COPY ui/package.json ui/

RUN pnpm install --frozen-lockfile

# Source + build. For the self-host image we intentionally skip
# `@traderalice/desktop` — it pulls in Electron-only dependencies that are
# not needed in this container.
COPY . .
RUN pnpm build:migration-index \
    && pnpm turbo run build --filter=!@traderalice/desktop \
    && pnpm tsup src/main.ts --format esm --dts

# Strip dev deps before the runtime stage harvests node_modules. With
# `electron` + `electron-builder` (each ~500MB) in devDependencies, this
# is the difference between a 2.9GB image and a sub-1GB image. `CI=true`
# satisfies pnpm's "won't remove modules without TTY confirmation" check.
RUN CI=true pnpm prune --prod --config.ignore-scripts=true

# ─── runtime stage ────────────────────────────────────────
FROM node:22-trixie-slim AS runtime
WORKDIR /app

# Bash + POSIX utils are required by workspace bootstrap.sh scripts;
# trixie-slim already ships Bash and POSIX utils. `git` is required by
# workspace bootstrap scripts like chat/bootstrap.sh, which run at runtime.
# `ca-certificates` are required for HTTPS git clones used by templates such
# as auto-quant.
# `tini` becomes PID 1 so signals (SIGTERM from `docker stop`) reach the
# Guardian supervisor cleanly instead of getting dropped by Node's default
# PID-1 behaviour, and zombies from short-lived children (workspace CLI
# auth flows, etc.) get reaped.
RUN apt-get update && apt-get install -y --no-install-recommends tini git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Two agent CLIs installed globally so they're on PATH for the PTY
# sessions OpenAlice spawns. Both come from npm (codex's npm package is
# a thin wrapper that pulls down the Rust binary on install).
# Smoke-checking versions at build time fails the build loud if either
# package broke.
RUN npm install -g \
        @anthropic-ai/claude-code \
        @openai/codex \
    && claude --version \
    && codex --version \
    && npm cache clean --force

# Production artifacts. The Guardian script (`scripts/guardian/prod.mjs`)
# expects `dist/main.js` (Alice) and `services/uta/dist/uta.js` (UTA)
# next to each other at /app.
COPY --from=build /src/dist                       ./dist
COPY --from=build /src/services/uta/dist          ./services/uta/dist
COPY --from=build /src/ui/dist                    ./ui/dist
COPY --from=build /src/default                    ./default
COPY --from=build /src/src/workspaces/templates   ./src/workspaces/templates
# tsup bundles backend deps into the entry files where possible, but
# native modules (node-pty, longbridge, etc.) stay as runtime requires.
COPY --from=build /src/node_modules               ./node_modules
COPY --from=build /src/package.json               ./package.json
# Workspace packages — `node_modules/@traderalice/*` are pnpm symlinks
# resolving to `packages/*/dist` via relative paths. Without these,
# `import('@traderalice/ibkr')` from the bundled `dist` files fails
# with ERR_MODULE_NOT_FOUND at startup.
COPY --from=build /src/packages                   ./packages
COPY --from=build /src/services/uta/package.json  ./services/uta/package.json
# UTA's broker SDK deps (ccxt / longbridge / alpaca-trade-api) live in
# services/uta/package.json after Step 8 cleanup, so Node resolution
# from the bundled `services/uta/dist/uta.js` needs the local
# node_modules tree alongside (pnpm symlinks into ../../node_modules/.pnpm).
COPY --from=build /src/services/uta/node_modules  ./services/uta/node_modules
# Guardian supervisor lives in the scripts/ tree; only the prod entry is
# needed at runtime, but copying the directory keeps the file path the
# CMD references stable.
COPY --from=build /src/scripts                    ./scripts

# Two-home model — see src/core/paths.ts.
#   /app  = APP_RESOURCES_HOME  (image content, baked in)
#   /data = USER_DATA_HOME      (the volume the user mounts)
# HOME redirects ~/.claude / ~/.codex / ~/.config etc. into the volume so
# auth tokens + agent state persist across container rebuild.
ENV OPENALICE_APP_HOME=/app \
    OPENALICE_HOME=/data \
    OPENALICE_USER_DATA_HOME=/data \
    AQ_LAUNCHER_ROOT=/data/workspaces \
    HOME=/data/home \
    NODE_ENV=production \
    OPENALICE_WEB_PORT=47331 \
    OPENALICE_MCP_PORT=47332 \
    OPENALICE_UTA_PORT=47333 \
    OPENALICE_BIND_HOST=0.0.0.0

VOLUME ["/data"]
EXPOSE 47331

# tini handles signal forwarding + zombie reaping; Guardian then spawns
# UTA → Alice and supervises the lifecycle (see scripts/guardian/prod.mjs).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/guardian/prod.mjs"]
