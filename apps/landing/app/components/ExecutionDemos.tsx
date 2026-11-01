"use client";

import {
  ProductFeatureStage,
  type ProductFeatureItem,
} from "./ProductFeatureStage";

const demos = [
  {
    id: "approval",
    tab: "Approval wall",
    eyebrow: "Trading as Git",
    status: "Needs approval · no broker write",
    title: "The broker waits for you.",
    description:
      "The agent prepares the operation. You inspect the exact diff, then a second human confirmation stands between the proposal and the broker.",
    facts: ["Agent proposes", "Operation diff", "Human push"],
    src: "/pic/product-trade-approval-demo-260824.mp4",
    poster: "/pic/product-trade-approval-demo-260824.jpg",
    width: 1440,
    height: 900,
    alt: "OpenAlice Trading as Git showing a staged BTC demo order, its operation diff, and the first approval click stopping at a second confirmation without contacting the broker",
    href: "/docs/core-concepts/trading-as-git",
  },
  {
    id: "account",
    tab: "Account ledger",
    eyebrow: "Unified Trading Account",
    status: "Connected broker state",
    title: "One account state, end to end.",
    description:
      "See connection health, cash, positions, P&L, orders, and history inside one account boundary.",
    facts: ["Connection health", "Positions + P&L", "Orders + history"],
    src: "/pic/product-uta-account-demo-260824.mp4",
    poster: "/pic/product-uta-account-demo-260824.jpg",
    width: 1280,
    height: 720,
    alt: "OpenAlice inspecting a connected Alpaca account from its equity and cash through positions and order history",
    href: "/docs/trading/accounts-and-brokers",
  },
  {
    id: "data",
    tab: "Market data",
    eyebrow: "Source-aware Data Hub",
    status: "Evidence before inference",
    title: "See the board behind the answer.",
    description:
      "Keep source and as-of meaning beside the market data an agent uses.",
    facts: ["Zero-key boards", "Source + as-of", "Agent-callable data"],
    src: "/pic/product-market-demo-260823.mp4",
    poster: "/pic/product-market-demo-260823.jpg",
    width: 1440,
    height: 900,
    alt: "OpenAlice Market showing live source-aware sector rotation from the Data Hub",
    href: "/docs/market-data/data-hub",
  },
] as const satisfies readonly ProductFeatureItem[];

export function ExecutionDemos() {
  return (
    <ProductFeatureStage
      idPrefix="execution"
      ariaLabel="OpenAlice execution foundation demos"
      items={demos}
    />
  );
}
