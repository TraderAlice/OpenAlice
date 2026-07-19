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
COPY patches/ patches/
COPY scripts/fix-pty-perms.mjs ./scripts/fix-pty-perms.mjs
COPY packages/cli/package.json packages/cli/
COPY packages/guardian-runtime/package.json packages/guardian-runtime/
COPY packages/connector-protocol/package.json packages/connector-protocol/
COPY packages/ibkr/package.json packages/ibkr/
COPY packages/opentypebb/package.json packages/opentypebb/
COPY packages/uta-protocol/package.json packages/uta-protocol/
COPY packages/uta-broker-alpaca/package.json packages/uta-broker-alpaca/
COPY packages/uta-broker-ccxt/package.json packages/uta-broker-ccxt/
COPY packages/uta-broker-ibkr/package.json packages/uta-broker-ibkr/
COPY packages/uta-broker-leverup/package.json packages/uta-broker-leverup/
COPY packages/uta-broker-longbridge/package.json packages/uta-broker-longbridge/
COPY services/uta/package.json services/uta/
COPY services/connector/package.json services/connector/
COPY ui/package.json ui/

RUN pnpm install --frozen-lockfile

# Source + build. Mirrors root `pnpm build` (turbo: workspace packages + UI
# Vite build + optional services, then `tsup` bundles Alice into `dist/main.js`).
# `.dockerignore` removes `apps/desktop`, so Electron is not a discovered
# workspace and cannot trigger a late dependency install in this server build.
COPY . .
RUN pnpm exec turbo run build --filter=!./packages/uta-broker-* \
    && pnpm exec tsup src/main.ts --format esm --dts

# Produce three dependency closures instead of pruning the whole workspace.
# A workspace-wide production prune would retain the optional Broker Pack
# workspaces and their SDKs even though no production process imports them.
RUN pnpm --config.inject-workspace-packages=true --filter open-alice deploy --prod /runtime/root \
    && pnpm --config.inject-workspace-packages=true --filter @traderalice/uta-service deploy --prod /runtime/uta \
    && pnpm --config.inject-workspace-packages=true --filter @traderalice/connector-service deploy --prod /runtime/connector \
    && if find /runtime/root/node_modules /runtime/uta/node_modules /runtime/connector/node_modules \
        -type d \( \
          -path '*/node_modules/ccxt' -o \
          -path '*/node_modules/longbridge' -o \
          -path '*/node_modules/@alpacahq/alpaca-trade-api' \
        \) -print -quit | grep -q .; then \
      echo 'Broker SDK leaked into the core Docker dependency closures' >&2; \
      exit 1; \
    fi

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
# expects Alice, UTA and Connector Service artifacts next to each other at /app.
COPY --from=build /src/dist                       ./dist
COPY --from=build /src/services/uta/dist          ./services/uta/dist
COPY --from=build /src/services/connector/dist    ./services/connector/dist
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
# Alice, UTA Core, and Connector each receive only their own production
# dependency closure. Live broker SDKs are downloaded later as Broker Packs.
COPY --from=build /runtime/root/node_modules      ./node_modules
COPY --from=build /src/package.json               ./package.json
# Internal runtime packages are injected into the production dependency
# closures above. Their manifests explicitly publish `dist`, so this image
# does not need the source workspace tree (or the Broker Pack workspaces).
COPY --from=build /src/services/uta/package.json  ./services/uta/package.json
COPY --from=build /src/services/connector/package.json ./services/connector/package.json
COPY --from=build /runtime/uta/node_modules       ./services/uta/node_modules
COPY --from=build /runtime/connector/node_modules ./services/connector/node_modules
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
    OPENALICE_CONNECTOR_PORT=47334 \
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
