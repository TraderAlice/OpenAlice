FROM node:22-bookworm-slim

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl openssh-server \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/bash --uid 10001 smoke \
  && passwd --delete smoke \
  && mkdir -p /run/sshd /fixture/OpenAlice/scripts/guardian \
  && ssh-keygen -A

COPY install /fixture/install
COPY packages/cli /fixture/packages/cli
COPY scripts/install-smoke/static-server.mjs /fixture/static-server.mjs
COPY scripts/guardian/control-server.mjs /fixture/OpenAlice/scripts/guardian/control-server.mjs
COPY scripts/remote-smoke/fixture-guardian.mjs /fixture/OpenAlice/scripts/guardian/prod.mjs
COPY scripts/remote-smoke/fixture-package.json /fixture/OpenAlice/package.json
COPY scripts/remote-smoke/entrypoint.sh /fixture/entrypoint.sh

RUN mkdir -p \
    /fixture/OpenAlice/dist \
    /fixture/OpenAlice/ui/dist \
    /fixture/OpenAlice/services/uta/dist \
    /fixture/OpenAlice/services/connector/dist \
    /fixture/OpenAlice/packages/guardian-runtime/dist \
    /fixture/OpenAlice/node_modules \
  && touch \
    /fixture/OpenAlice/dist/main.js \
    /fixture/OpenAlice/ui/dist/index.html \
    /fixture/OpenAlice/services/uta/dist/uta.js \
    /fixture/OpenAlice/services/connector/dist/connector.cjs \
    /fixture/OpenAlice/packages/guardian-runtime/dist/index.js \
  && chmod +x /fixture/entrypoint.sh \
  && chown -R smoke:smoke /fixture/OpenAlice /home/smoke

EXPOSE 22
ENTRYPOINT ["/fixture/entrypoint.sh"]
