"use client";

import {
  ProductFeatureStage,
  type ProductFeatureItem,
} from "./ProductFeatureStage";

const workflow = [
  {
    id: "session-issue",
    tab: "Session → Issue",
    eyebrow: "Durable handoff",
    status: "Same Codex Session",
    title: "The brief becomes an object.",
    description:
      "Codex leaves one named Issue with its owner, schedule, instructions, and creation provenance on disk.",
    facts: ["Codex creator", "Stable Issue id", "Session ownership"],
    src: "/pic/product-durable-session-issue-260824.mp4",
    poster: "/pic/product-durable-session-issue-260824.jpg",
    width: 1440,
    height: 900,
    alt: "OpenAlice opening a scheduled NVDA research Issue and revealing the same Codex Session that created it",
    href: "/docs/workspaces/issues",
  },
  {
    id: "issue-run",
    tab: "Issue → Run",
    eyebrow: "Scheduled work",
    status: "Healthy · read only",
    title: "The work keeps running.",
    description:
      "The same Issue keeps its schedule and run history, then links the completed result directly to Inbox.",
    facts: ["Monday schedule", "Run history", "Inbox delivery"],
    src: "/pic/product-durable-issue-run-260824.mp4",
    poster: "/pic/product-durable-issue-run-260824.jpg",
    width: 1440,
    height: 900,
    alt: "OpenAlice following the NVDA research Issue from a healthy completed run into its linked Inbox report",
    href: "/docs/workspaces/automation",
  },
  {
    id: "report-evidence",
    tab: "Report → Evidence",
    eyebrow: "Published result",
    status: "Same Issue provenance",
    title: "The result keeps its sources.",
    description:
      "Inbox names the originating Issue, opens the published Markdown attachment, and keeps the report beside its source ledger.",
    facts: ["From Issue", "Published attachment", "Source ledger"],
    src: "/pic/product-durable-report-evidence-260824.mp4",
    poster: "/pic/product-durable-report-evidence-260824.jpg",
    width: 1440,
    height: 900,
    alt: "OpenAlice expanding the NVDA evidence brief from Inbox and scrolling to its source ledger",
    href: "/docs/workspaces/inbox",
  },
] as const satisfies readonly ProductFeatureItem[];

export function DurableWorkflow() {
  return (
    <ProductFeatureStage
      idPrefix="durable-workflow"
      ariaLabel="OpenAlice durable agent workflow"
      items={workflow}
      minVisibleRatio={0.35}
    />
  );
}
