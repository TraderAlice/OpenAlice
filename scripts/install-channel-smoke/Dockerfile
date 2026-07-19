FROM node:22-bookworm-slim

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --home-dir /home/smoke --no-create-home --shell /bin/bash --uid 10001 smoke \
  && mkdir -p /home/smoke \
  && chown smoke:smoke /home/smoke

COPY scripts/install-channel-smoke/run.sh /fixture/run.sh
RUN chmod +x /fixture/run.sh

USER smoke
ENV HOME=/home/smoke
ENV SHELL=/bin/bash

ENTRYPOINT ["bash", "/fixture/run.sh"]
