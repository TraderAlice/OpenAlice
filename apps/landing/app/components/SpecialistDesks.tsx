"use client";

import {
  ProductFeatureStage,
  type ProductFeatureItem,
} from "./ProductFeatureStage";

const desks = [
  {
    id: "autoquant",
    tab: "AutoQuant",
    eyebrow: "Quantitative research",
    status: "Governed research workflow",
    title: "Give the agent a laboratory.",
    description:
      "Run projects, studies, and experiments in one inspectable research workspace.",
    facts: ["Project → Study → Run", "Validation gates", "Auditable workspace"],
    src: "/pic/product-autoquant-demo-260824.mp4",
    poster: "/pic/product-autoquant-demo-260824.jpg",
    width: 1440,
    height: 900,
    alt: "OpenAlice opening the AutoQuant Studio to inspect a research project, validation metrics, and its next experiment",
    href: "/docs/workspaces/autoquant",
  },
  {
    id: "prediction",
    tab: "Auto Prediction",
    eyebrow: "Prediction research · pre-alpha",
    status: "Research only · no execution",
    title: "Test the claim before you spend.",
    description:
      "Read exact contracts, test relationships, and collect counterevidence before model spend.",
    facts: ["4,200 markets", "Evidence pipeline", "Preflight before spend"],
    src: "/pic/product-autoprediction-demo-260824.mp4",
    poster: "/pic/product-autoprediction-demo-260824.jpg",
    width: 1440,
    height: 900,
    alt: "OpenAlice opening the Auto Prediction Studio with live market coverage, preflight, and a research evidence pipeline",
    href: "/docs/workspaces/auto-prediction",
  },
] as const satisfies readonly ProductFeatureItem[];

export function SpecialistDesks() {
  return (
    <ProductFeatureStage
      idPrefix="specialist"
      ariaLabel="OpenAlice specialist research environments"
      items={desks}
    />
  );
}
