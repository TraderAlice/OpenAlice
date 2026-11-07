"use client";

import Image from "next/image";
import Link from "next/link";
import { type KeyboardEvent, useState } from "react";
import { useCoordinatedDemoPlayback } from "@/app/hooks/useCoordinatedDemoPlayback";
import { mediaImage, mediaUrl } from "@/lib/media";

export type ProductFeatureItem = {
  id: string;
  tab: string;
  eyebrow: string;
  status?: string;
  title: string;
  description: string;
  facts: readonly string[];
  src: string;
  poster: string;
  width: number;
  height: number;
  alt: string;
  href: string;
};

type ProductFeatureStageProps = {
  idPrefix: string;
  ariaLabel: string;
  items: readonly ProductFeatureItem[];
  minVisibleRatio?: number;
};

export function ProductFeatureStage({
  idPrefix,
  ariaLabel,
  items,
  minVisibleRatio,
}: ProductFeatureStageProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = items[activeIndex];
  const { containerRef, videoRef, shouldRenderVideo } =
    useCoordinatedDemoPlayback<HTMLDivElement>({
      restartKey: active.src,
      minVisibleRatio,
    });

  function selectDemo(nextIndex: number) {
    if (nextIndex === activeIndex) return;
    setActiveIndex(nextIndex);
    window.dispatchEvent(new CustomEvent("openalice:product-demo-select", {
      detail: {
        demoGroup: idPrefix,
        demoId: items[nextIndex].id,
      },
    }));
  }

  function selectFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % items.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    selectDemo(nextIndex);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus();
  }

  return (
    <div className="oa-feature-stage">
      <div
        className="oa-feature-tabs"
        role="tablist"
        aria-label={ariaLabel}
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            id={`${idPrefix}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={activeIndex === index}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={activeIndex === index ? 0 : -1}
            data-demo-select
            data-demo-id={item.id}
            data-demo-location={idPrefix}
            className={activeIndex === index ? "is-active" : undefined}
            onClick={() => selectDemo(index)}
            onKeyDown={(event) => selectFromKeyboard(event, index)}
          >
            <span>0{index + 1}</span>
            {item.tab}
          </button>
        ))}
      </div>

      <div className="oa-feature-caption" key={active.id}>
        <div>
          <p className="oa-feature-meta">
            <span>{active.eyebrow}</span>
            {active.status ? <span>{active.status}</span> : null}
          </p>
          <h3 className="display">{active.title}</h3>
        </div>
        <div className="oa-feature-detail">
          <p>{active.description}</p>
          <div className="oa-feature-facts" aria-label={`${active.tab} highlights`}>
            {active.facts.map((fact) => <span key={fact}>{fact}</span>)}
          </div>
          <Link href={active.href} className="oa-feature-link">
            Read the workflow <span aria-hidden>→</span>
          </Link>
        </div>
      </div>

      <div
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${active.id}`}
        className="oa-feature-media"
        data-demo-stage
        data-demo-id={active.id}
        data-demo-location={idPrefix}
        ref={containerRef}
      >
        <div className="oa-product-shot" key={active.src}>
          {shouldRenderVideo ? (
            <video
              ref={videoRef}
              src={mediaUrl(active.src)}
              poster={mediaUrl(active.poster)}
              muted
              loop
              playsInline
              preload="none"
              aria-label={active.alt}
              data-demo-id={active.id}
              data-demo-location={idPrefix}
            />
          ) : (
            <Image
              {...mediaImage(active.poster)}
              alt={active.alt}
              sizes="(max-width: 767px) calc(100vw - 2rem), 1152px"
            />
          )}
        </div>
      </div>
    </div>
  );
}
