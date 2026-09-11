FROM debian:bookworm-slim

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates coreutils curl tar \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --home-dir /home/smoke --no-create-home --shell /bin/bash --uid 10001 smoke \
  && mkdir -p /home/smoke \
  && chown smoke:smoke /home/smoke

WORKDIR /fixture
COPY --chown=smoke:smoke install /fixture/install
COPY --chown=smoke:smoke scripts/install-smoke/run.sh /fixture/run.sh
COPY --chown=smoke:smoke scripts/install-smoke/interactive.sh /fixture/interactive.sh

USER smoke
ENV HOME=/home/smoke
ENV SHELL=/bin/bash

ENTRYPOINT ["bash", "/fixture/run.sh"]
