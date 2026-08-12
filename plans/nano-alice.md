# NanoAlice product birth

Status: completed

Owner guides: [[docs/alice-project.md]], [[docs/cli-supervisor.md]]

## Goal

Stamp an immutable `product` on AliceProject create. Nano never starts UTA.
TraderAlice Lite/Pro stay trading intensity, not this identity.

## Checklist

- [x] Home stamp `data/config/alice-project.json`
- [x] Supervisor registry optional `product`
- [x] `openalice create alice-project`
- [x] Guardian skip UTA when product is nano
- [x] AliceProject API projects `product`
- [x] Verification + PR

## Acceptance

- Standalone CLI and Guardian product-stamp suites cover missing, malformed,
  immutable, and concurrent first-writer behavior.
- Registration refuses a requested product that conflicts with an existing
  complete-home birth stamp.
- `npx tsc --noEmit`, `cd ui && npx tsc -b`, `pnpm test`, and `pnpm build` pass.
- Guardian recovery fast checks and `pnpm test:install:docker` pass.
- A real isolated Nano home created through the source CLI starts Alice, Tool
  Gateway, and Vite while Guardian reports `UTA → disabled (NanoAlice)`.

Delivered in PR #1065.
