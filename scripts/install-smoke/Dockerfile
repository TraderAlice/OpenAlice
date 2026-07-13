FROM node:22-bookworm-slim

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && useradd --home-dir /home/smoke --no-create-home --shell /bin/bash --uid 10001 smoke \
  && mkdir -p /home/smoke \
  && chown smoke:smoke /home/smoke

WORKDIR /fixture
COPY --chown=smoke:smoke install /fixture/install
COPY --chown=smoke:smoke packages/cli /fixture/packages/cli
COPY --chown=smoke:smoke scripts/install-smoke/interactive.sh /fixture/interactive.sh
COPY --chown=smoke:smoke scripts/install-smoke/run.sh /fixture/run.sh
COPY --chown=smoke:smoke scripts/install-smoke/static-server.mjs /fixture/static-server.mjs

USER smoke
ENV HOME=/home/smoke
ENV SHELL=/bin/bash

ENTRYPOINT ["bash", "/fixture/run.sh"]
