FROM oven/bun:1.4.0 AS bun-runtime

FROM node:22-bookworm AS builder
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
COPY . .
RUN corepack enable \
  && corepack prepare pnpm@11.7.0 --activate \
  && pnpm install --frozen-lockfile \
  && pnpm exec tsx scripts/build-migration-index.ts \
  && pnpm exec turbo run build --filter=!./packages/uta-broker-* \
  && pnpm exec tsup src/main.ts --format esm --dts \
  && pnpm build:bun:release

FROM debian:bookworm-slim

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl openssh-server python3 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/bash --uid 10001 smoke \
  && passwd --delete smoke \
  && mkdir -p /run/sshd /fixture/www/cli/dev \
  && ssh-keygen -A

COPY install /fixture/www/install
COPY --from=builder /repo/dist/bun-release/openalice-cli-*.tar.gz /fixture/artifacts/
COPY --from=builder /repo/dist/bun-release/openalice-cli-*.tar.gz.sha256 /fixture/artifacts/
COPY scripts/remote-smoke/entrypoint.sh /fixture/entrypoint.sh

RUN archive="$(find /fixture/artifacts -name 'openalice-cli-*-linux-*.tar.gz' -type f -print -quit)" \
  && test -n "$archive" \
  && target_arch="$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')" \
  && cp "$archive" "/fixture/www/cli/dev/openalice-cli-dev-linux-${target_arch}.tar.gz" \
  && cp "$archive.sha256" "/fixture/www/cli/dev/openalice-cli-dev-linux-${target_arch}.tar.gz.sha256" \
  && chmod +x /fixture/entrypoint.sh \
  && chown -R smoke:smoke /fixture /home/smoke

EXPOSE 22
ENTRYPOINT ["/fixture/entrypoint.sh"]
