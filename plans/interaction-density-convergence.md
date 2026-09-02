# Interaction and density convergence

- Status — active
- Related issue — #1158
- Owner guide — `docs/ui-interaction-and-motion.md`

## Intent

Converge the current `dev` interface on one compact interaction system. The delivered increment gives form controls a quiet shared focus treatment, makes the compact Alice brand position expose the rail expansion action, flattens Connector setup hierarchy, and tightens repeated market information surfaces. Existing routes, data flow, and page layout remain stable.

## Decisions

- A 14px by 20px body baseline and shared focus tokens establish common field and text metrics. The existing `oa-field-control` seam owns field emphasis. Feature-local blue focus shadows leave the common path.
- The compact brand action follows the existing rail state boundary. Hover and keyboard focus crossfade the Alice mark with the expansion glyph inside one fixed optical box.
- Connector credentials keep one disclosure boundary. Setup guidance uses separators and aligned content inside that boundary.
- Existing market card owners receive shared surface classes after repeated geometry is confirmed in current consumers.

## Checklist

- [x] Add shared focus and dense-surface primitives.
- [x] Add the compact-rail brand expansion action and behavior tests.
- [ ] Flatten Connector setup guidance and align disclosure geometry.
- [ ] Apply the dense-surface hierarchy to current market consumers.
- [ ] Run targeted tests, complete UI checks, and capture representative routes.

## Verification

- `pnpm --dir ui exec vitest run <affected specs>`
- `pnpm --dir ui exec tsc -b`
- `pnpm test`
- `npx tsc --noEmit`
- Browser review at desktop and phone widths with reduced-motion coverage.

## Completion

The shared primitives own the changed behavior, affected routes retain their current functions, screenshots show stable alignment and hierarchy, and the required checks pass.
