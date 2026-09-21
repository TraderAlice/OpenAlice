# Longbridge Native Decimal Boundary Fix

## Problem

`Order` values use `decimal.js`, while Longbridge SDK 4.0.5 write APIs require
instances of the SDK's native `Decimal` class. The adapter currently suppresses
the TypeScript mismatch with `as unknown as never`, so `submitOrder()` reaches
the N-API boundary with the wrong runtime class and fails to unwrap
`SubmitOrderOptions.submittedQuantity`.

The same mismatch affects optional submit prices and replace-order quantity and
price fields.

## Design

Import Longbridge's `Decimal` under a distinct name and add one adapter-local
conversion function. The function converts through `value.toString()` before
constructing the SDK value, preserving decimal precision without crossing the
boundary through JavaScript `number`.

Apply that conversion to every Longbridge write field currently populated from
a `decimal.js` value:

- submit quantity;
- submitted limit price;
- trigger price;
- trailing percent;
- replacement quantity;
- replacement limit price;
- replacement trigger price.

Read-side values remain normalized into `decimal.js` as they are today. Order
validation, supported order types, error handling, and the Broker Pack API do
not change.

## Test Strategy

Extend the existing `longbridge` test mock with a minimal `Decimal` class that
retains its string value. Add regression assertions proving that submit and
replace payload Decimal fields are instances of that SDK-exported class and
retain their exact decimal strings.

Follow red-green-refactor:

1. Add class-identity assertions and confirm they fail against the current
   adapter.
2. Add the conversion function and replace all unsafe Decimal casts.
3. Re-run the targeted Longbridge spec, TypeScript checks, and repository test
   suite.

A real Longbridge demo/paper submission is the final venue-level acceptance
because only the native SDK can prove N-API unwrapping end to end. It must not
run unless a configured account is independently confirmed as paper/demo and
post-run orders and positions can be restored to their baseline.

## Delivery

Create the fix from upstream `dev`, push the feature branch to
`fanfpy/OpenAlice`, and open a pull request against `TraderAlice/OpenAlice:dev`.
The PR will call out the trading boundary and any live-paper verification that
could not be performed locally.
