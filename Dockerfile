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
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Cache-friendly: copy only manifests first so the dep-resolution layer
# stays warm across source-only changes. The postinstall helper joins this layer
# because the root postinstall hook (`fix-pty-perms.mjs`) runs at the end
# of `pnpm install` and must already exist on disk.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY scripts/fix-pty-perms.mjs ./scripts/fix-pty-perms.mjs
COPY packages/guardian-runtime/package.json packages/guardian-runtime/
COPY packages/ibkr/package.json packages/ibkr/
COPY packages/opentypebb/package.json packages/opentypebb/
COPY packages/uta-protocol/package.json packages/uta-protocol/
COPY services/uta/package.json services/uta/
COPY ui/package.json ui/

RUN pnpm install --frozen-lockfile

# Source + build. Mirrors root `pnpm build` (turbo: workspace packages + UI
# Vite build + services/uta, then `tsup` bundles Alice into `dist/main.js`).
# `.dockerignore` removes `apps/desktop`, so Electron is not a discovered
# workspace and cannot trigger a late dependency install in this server build.
COPY . .
RUN pnpm exec turbo run build \
    && pnpm exec tsup src/main.ts --format esm --dts

# Strip dev deps (typescript, turbo, vitest, vite, …) before the runtime
# stage harvests node_modules — a multi-hundred-MB cut. `CI=true`
# satisfies pnpm's "won't remove modules without TTY confirmation" check.
RUN CI=true pnpm prune --prod --config.ignore-scripts=true

# ─── runtime stage ────────────────────────────────────────
FROM node:22-trixie-slim AS runtime
WORKDIR /app

# Bash + POSIX utils are required by workspace bootstrap.sh scripts;
# trixie-slim already ships them — but NOT `git`, which every template's
# bootstrap.sh needs (`git init` per the Harness rule; auto-quant /
# finance-research also `git clone`). Without it, creating any
# Chat/Workspace in the container fails with exit 127. `ca-certificates`
# keeps HTTPS clones of satellite repos working in the slim image.
# `tini` becomes PID 1 so signals (SIGTERM from `docker stop`) reach the
# Guardian supervisor cleanly instead of getting dropped by Node's
# default PID-1 behaviour, and zombies from short-lived children
# (workspace CLI auth flows, etc.) get reaped.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        tini \
    && rm -rf /var/lib/apt/lists/*

# The four supported agent CLIs are installed globally so every Docker
# Workspace gets the same runtime surface as OpenAlice. They all come from npm
# (Codex/opencode packages resolve their platform binary during install).
# Keep these explicit: an unchanged Dockerfile layer must resolve to the same
# runtime instead of silently changing when an upstream `latest` tag moves.
ARG CLAUDE_CODE_VERSION=2.1.202
ARG CODEX_VERSION=0.144.1
ARG OPENCODE_VERSION=1.17.18
ARG PI_VERSION=0.80.6
RUN npm install -g \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
        "@openai/codex@${CODEX_VERSION}" \
        "opencode-ai@${OPENCODE_VERSION}" \
        "@earendil-works/pi-coding-agent@${PI_VERSION}" \
    && claude --version \
    && codex --version \
    && opencode --version \
    && pi --version \
    && npm cache clean --force

# Production artifacts. The Guardian script (`scripts/guardian/prod.mjs`)
# expects `dist/main.js` (Alice) and `services/uta/dist/uta.js` (UTA)
# next to each other at /app.
COPY --from=build /src/dist                       ./dist
COPY --from=build /src/services/uta/dist          ./services/uta/dist
COPY --from=build /src/ui/dist                    ./ui/dist
COPY --from=build /src/default                    ./default
COPY --from=build /src/src/workspaces/templates   ./src/workspaces/templates
# Workspace CLI launchers and their sibling payload are runtime resources just
# like templates. Keep the image-owned directory intact for `cliBinPath()`, and
# install the same self-contained launcher set into /usr/local/bin. Debian login
# shells reset PATH, so ENV alone would make these commands disappear from the
# actual Workspace terminal. Installing only the launchers would also break
# their sibling `openalice-cli.cjs` lookup.
COPY --from=build /src/src/workspaces/cli/bin      ./src/workspaces/cli/bin
RUN install -m 0755 /app/src/workspaces/cli/bin/alice /usr/local/bin/alice \
    && install -m 0755 /app/src/workspaces/cli/bin/alice-uta /usr/local/bin/alice-uta \
    && install -m 0755 /app/src/workspaces/cli/bin/alice-workspace /usr/local/bin/alice-workspace \
    && install -m 0755 /app/src/workspaces/cli/bin/traderhub /usr/local/bin/traderhub \
    && install -m 0644 /app/src/workspaces/cli/bin/openalice-cli.cjs /usr/local/bin/openalice-cli.cjs
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
    AQ_LAUNCHER_ROOT=/data/workspaces \
    HOME=/data/home \
    NODE_ENV=production \
    OPENALICE_WEB_PORT=47331 \
    OPENALICE_MCP_PORT=47332 \
    OPENALICE_UTA_PORT=47333 \
    OPENALICE_BIND_HOST=0.0.0.0

VOLUME ["/data"]
EXPOSE 47331

# Compose and remote orchestrators can distinguish "container process exists"
# from "Alice HTTP surface is ready" without requiring curl in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "const p=process.env.OPENALICE_WEB_PORT||'47331';fetch('http://127.0.0.1:'+p+'/api/version').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

# tini handles signal forwarding + zombie reaping; Guardian then spawns
# UTA → Alice and supervises the lifecycle (see scripts/guardian/prod.mjs).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/guardian/prod.mjs"]
