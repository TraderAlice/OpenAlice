# ── Stage 1: Install dependencies ──────────────────────────────────────
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

WORKDIR /app

# Copy workspace structure for install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ibkr/package.json packages/ibkr/
COPY packages/opentypebb/package.json packages/opentypebb/
COPY ui/package.json ui/

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/ibkr/node_modules ./packages/ibkr/node_modules
COPY --from=deps /app/packages/opentypebb/node_modules ./packages/opentypebb/node_modules
COPY --from=deps /app/ui/node_modules ./ui/node_modules

COPY . .

# Build workspace packages, UI, and backend
RUN pnpm build

# ── Stage 3: Production image ─────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

# Claude Code CLI — required for the claude-code AI backend
RUN npm install -g @anthropic-ai/claude-code

# Non-root user
RUN addgroup -g 1001 alice && adduser -u 1001 -G alice -s /bin/sh -D alice

WORKDIR /app

# Production dependencies only
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ibkr/package.json packages/ibkr/
COPY packages/opentypebb/package.json packages/opentypebb/

RUN pnpm install --frozen-lockfile --prod

# Built artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages/ibkr/dist ./packages/ibkr/dist
COPY --from=build /app/packages/opentypebb/dist ./packages/opentypebb/dist

# Default data templates (config is mounted at runtime)
COPY data/default ./data/default

# Data directories owned by non-root user
RUN mkdir -p data/config data/brain data/sessions data/trading data/cache logs \
    && chown -R alice:alice data logs

USER alice

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3002/api/config || exit 1

CMD ["node", "dist/main.js"]
